"use strict";

const crypto = require("crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineString, defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

const { normalizeRef, isValidRef } = require("./lib/ticketRef");
const { isBlocked, recordFailure } = require("./lib/rateLimit");
const { getClientIp } = require("./lib/clientIp");
const { buildSlot, splitThreadId } = require("./lib/slots");
const { planMigration } = require("./lib/migrate");
const { validateResetInput, chunk, RESET_COLLECTIONS } = require("./lib/reset");
const { validateInput, buildPrompt, extractText, parseMatchReply, rateDecision, dayKeyFor } = require("./lib/match");

const REGION = "europe-west1";
setGlobalOptions({ region: REGION });

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// No default — must be configured per environment. Never hard-code an
// admin email/UID in the repo.
const ADMIN_UID = defineString("ADMIN_UID");

// Secret already exists in the live project under this name.
const ANTHROPIC_KEY = defineSecret("ANTHROPIC_KEY");
const AI_MODEL = defineString("AI_MODEL", { default: "claude-haiku-4-5-20251001" });
const AI_GLOBAL_DAILY_LIMIT = 1500;

const MAX_REFS_PER_CALL = 2000;
const BATCH_SIZE = 400;

/**
 * Public callable: exchange a ticket reference for a custom auth
 * token. Rate-limited per client IP (hashed, never stored in the
 * clear), counting FAILED attempts only, so delegates sharing a venue
 * IP are never locked out by successful sign-ins. Never logs the ref,
 * the IP or any issued token.
 */
exports.signInWithTicket = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const ip = getClientIp(request.rawRequest);
  const ipHash = crypto.createHash("sha256").update(ip).digest("hex");
  const rateRef = db.collection("rate").doc(ipHash);

  const rateSnap = await rateRef.get();
  if (isBlocked(rateSnap.exists ? rateSnap.data() : null, Date.now())) {
    throw new HttpsError("resource-exhausted", "Too many attempts. Please try again later.");
  }

  const countFailure = () =>
    db.runTransaction(async (tx) => {
      const snap = await tx.get(rateRef);
      const next = recordFailure(snap.exists ? snap.data() : null, Date.now());
      tx.set(rateRef, next, { merge: true });
    });

  const ref = normalizeRef(request.data && request.data.ref);
  if (!isValidRef(ref)) {
    await countFailure();
    throw new HttpsError("invalid-argument", "Invalid ticket reference.");
  }

  const ticketRef = db.collection("tickets").doc(ref);
  const ticketSnap = await ticketRef.get();
  if (!ticketSnap.exists) {
    await countFailure();
    throw new HttpsError("not-found", "Ticket not found");
  }

  const existingUid = (ticketSnap.data() || {}).uid;
  let uid;
  let isNew;

  if (existingUid == null) {
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ticketRef);
      const data = snap.exists ? snap.data() : null;
      if (data && data.uid != null) {
        return { uid: data.uid, isNew: false };
      }
      const newUid = db.collection("participants").doc().id;
      tx.set(
        ticketRef,
        { uid: newUid, claimedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      return { uid: newUid, isNew: true };
    });
    uid = claimed.uid;
    isNew = claimed.isNew;
  } else {
    uid = existingUid;
    isNew = false;
  }

  const token = await admin.auth().createCustomToken(uid, { delegate: true });
  return { token, uid, isNew };
});

/**
 * Admin-only callable: bulk-create ticket placeholder docs
 * ({uid: null}) for a batch of references. Never overwrites an
 * existing ticket doc.
 */
exports.adminUploadTickets = onCall({ region: REGION, maxInstances: 2 }, async (request) => {
  if (!request.auth || request.auth.uid !== ADMIN_UID.value()) {
    throw new HttpsError("permission-denied", "Admin only.");
  }

  const refsInput = Array.isArray(request.data && request.data.refs) ? request.data.refs : null;
  if (!refsInput) {
    throw new HttpsError("invalid-argument", "refs must be an array of strings.");
  }
  if (refsInput.length > MAX_REFS_PER_CALL) {
    throw new HttpsError("invalid-argument", `Too many refs (max ${MAX_REFS_PER_CALL} per call).`);
  }

  let invalid = 0;
  const validSet = new Set();
  for (const raw of refsInput) {
    const ref = normalizeRef(raw);
    if (isValidRef(ref)) {
      validSet.add(ref);
    } else {
      invalid++;
    }
  }
  const validRefs = Array.from(validSet);

  let added = 0;
  let alreadyExisted = 0;

  for (let i = 0; i < validRefs.length; i += BATCH_SIZE) {
    const chunk = validRefs.slice(i, i + BATCH_SIZE);
    const chunkRefs = chunk.map((ref) => db.collection("tickets").doc(ref));
    const snaps = await db.getAll(...chunkRefs);
    const batch = db.batch();
    let hasWrites = false;
    snaps.forEach((snap) => {
      if (snap.exists) {
        alreadyExisted++;
      } else {
        batch.set(snap.ref, { uid: null, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        added++;
        hasWrites = true;
      }
    });
    if (hasWrites) {
      await batch.commit();
    }
  }

  return { added, alreadyExisted, invalid };
});

/**
 * Admin-only callable: wipe event data. Recursively deletes
 * participants (incl. private contact records), threads (incl.
 * messages), aiUsage and rate. Ticket documents are NEVER deleted;
 * with unlinkTickets === true their uid is reset to null and
 * claimedAt removed so every ticket can be claimed again. Logs counts
 * only — never names or refs.
 */
exports.adminReset = onCall({ region: REGION, timeoutSeconds: 540, memory: "512MiB", maxInstances: 1 }, async (request) => {
  if (!request.auth || request.auth.uid !== ADMIN_UID.value()) {
    throw new HttpsError("permission-denied", "Admin only.");
  }
  const opts = validateResetInput(request.data);
  if (!opts) {
    throw new HttpsError("invalid-argument", 'confirm must be "RESET".');
  }

  const counts = {};
  for (const name of RESET_COLLECTIONS) {
    const coll = db.collection(name);
    // Thread docs usually don't exist (only their messages do), so count
    // by listDocuments, which includes such parent paths.
    counts[name] =
      name === "threads"
        ? (await coll.listDocuments()).length
        : (await coll.count().get()).data().count;
    await db.recursiveDelete(coll);
  }

  let ticketsUnlinked = 0;
  if (opts.unlinkTickets) {
    const ticketsSnap = await db.collection("tickets").select().get();
    for (const docs of chunk(ticketsSnap.docs)) {
      const batch = db.batch();
      docs.forEach((d) => batch.update(d.ref, { uid: null, claimedAt: admin.firestore.FieldValue.delete() }));
      await batch.commit();
      ticketsUnlinked += docs.length;
    }
  }

  const result = {
    participants: counts.participants,
    threads: counts.threads,
    aiUsage: counts.aiUsage,
    rate: counts.rate,
    ticketsUnlinked,
  };
  logger.info("adminReset: done", result);
  return result;
});

/**
 * Admin-only callable: one-time legacy-data migration. Plans (pure,
 * via planMigration) what needs to happen to move legacy tickets and
 * participant email/ticket fields into their new homes, then — only
 * when dryRun is false — applies it with batched writes (<=400 ops
 * per batch). Idempotent: a second run plans (and so applies)
 * nothing further for anything already migrated. Never logs names,
 * emails, or refs.
 */
exports.migrateLegacy = onCall({ region: REGION }, async (request) => {
  if (!request.auth || request.auth.uid !== ADMIN_UID.value()) {
    throw new HttpsError("permission-denied", "Admin only.");
  }

  const dryRun = !(request.data && request.data.dryRun === false);

  const [configSnap, participantsSnap, ticketsSnap] = await Promise.all([
    db.collection("config").doc("tickets").get(),
    db.collection("participants").get(),
    db.collection("tickets").get(),
  ]);

  const legacyRefs = (configSnap.exists && configSnap.data().refs) || [];
  const participants = participantsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const existingTickets = {};
  ticketsSnap.docs.forEach((d) => {
    existingTickets[d.id] = d.data();
  });

  const plan = planMigration({ legacyRefs, participants, existingTickets });

  if (!dryRun) {
    const ops = [];
    plan.ticketCreates.forEach(({ ref, uid }) => {
      ops.push({
        type: "set",
        ref: db.collection("tickets").doc(ref),
        data: { uid, createdAt: admin.firestore.FieldValue.serverTimestamp() },
      });
    });
    plan.ticketLinks.forEach(({ ref, uid }) => {
      ops.push({ type: "update", ref: db.collection("tickets").doc(ref), data: { uid } });
    });
    plan.emailMoves.forEach(({ id, email }) => {
      ops.push({
        type: "set",
        merge: true,
        ref: db.doc(`participants/${id}/private/contact`),
        data: { email, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      });
    });
    plan.publicCleanups.forEach(({ id, deleteEmail, deleteTicket }) => {
      const data = {};
      if (deleteEmail) data.email = admin.firestore.FieldValue.delete();
      if (deleteTicket) data.ticket = admin.firestore.FieldValue.delete();
      ops.push({ type: "update", ref: db.collection("participants").doc(id), data });
    });

    for (let i = 0; i < ops.length; i += BATCH_SIZE) {
      const chunk = ops.slice(i, i + BATCH_SIZE);
      const batch = db.batch();
      chunk.forEach((op) => {
        if (op.type === "update") batch.update(op.ref, op.data);
        else batch.set(op.ref, op.data, op.merge ? { merge: true } : undefined);
      });
      await batch.commit();
    }
  }

  return {
    refsTotal: plan.refsTotal,
    ticketsToCreate: plan.ticketsToCreate,
    ticketsToLink: plan.ticketsToLink,
    emailsToMove: plan.emailsToMove,
    participantsToClean: plan.participantsToClean,
    conflicts: plan.conflicts,
    invalidRefs: plan.invalidRefs,
    csvSkipped: plan.csvSkipped,
    dryRun,
  };
});

/**
 * Authenticated callable: AI-assisted best-match suggestion. Only a
 * signed-in delegate may call it; the server controls everything
 * that costs money (model, max_tokens, prompt contents, timeout) —
 * the client only ever supplies a candidateId shortlist. Never logs
 * prompts, profile data, names, bios, or the key — status codes and
 * counts only.
 */
exports.aiMatch = onCall(
  {
    region: REGION,
    secrets: [ANTHROPIC_KEY],
    timeoutSeconds: 30,
    memory: "256MiB",
    maxInstances: 5,
  },
  async (request) => {
    if (!request.auth || request.auth.token.delegate !== true) {
      throw new HttpsError("unauthenticated", "Please sign in again.");
    }

    const candidateIds = validateInput(request.data);
    if (!candidateIds) {
      throw new HttpsError("invalid-argument", "Invalid candidate list.");
    }

    const uid = request.auth.uid;
    const now = Date.now();
    const userRef = db.collection("aiUsage").doc(uid);
    const globalRef = db.collection("aiUsage").doc(`global_${dayKeyFor(now)}`);

    await db.runTransaction(async (tx) => {
      const [userSnap, globalSnap] = await Promise.all([tx.get(userRef), tx.get(globalRef)]);
      const decision = rateDecision(userSnap.exists ? userSnap.data() : null, now);
      if (!decision.allowed) {
        throw new HttpsError("resource-exhausted", "The matchmaker is busy. Please try again later.");
      }
      const globalCount = globalSnap.exists ? globalSnap.data().count || 0 : 0;
      if (globalCount >= AI_GLOBAL_DAILY_LIMIT) {
        throw new HttpsError("resource-exhausted", "The matchmaker is busy. Please try again later.");
      }
      tx.set(userRef, decision.nextState, { merge: true });
      tx.set(globalRef, { count: globalCount + 1 }, { merge: true });
    });

    const refs = [
      db.collection("participants").doc(uid),
      ...candidateIds.map((id) => db.collection("participants").doc(id)),
    ];
    const snaps = await db.getAll(...refs);
    const me = { id: uid, ...(snaps[0].exists ? snaps[0].data() : {}) };
    const candidates = snaps
      .slice(1)
      .map((snap, i) => (snap.exists ? { id: candidateIds[i], ...snap.data() } : null))
      .filter((p) => p && p.status === "approved" && p.ptype !== "Organiser" && p.id !== uid);

    if (!candidates.length) {
      throw new HttpsError("failed-precondition", "No candidates");
    }
    logger.info("aiMatch: candidates", candidates.length);

    const prompt = buildPrompt(me, candidates);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let text;
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_KEY.value(),
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: AI_MODEL.value(),
          max_tokens: 200,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });
      logger.info("aiMatch: upstream status", resp.status);
      if (!resp.ok) {
        throw new HttpsError("unavailable", "Matchmaker unavailable.");
      }
      const data = await resp.json();
      logger.info("aiMatch: stop_reason", data && data.stop_reason);
      text = extractText(data && data.content);
      if (!text) {
        // Covers both "no text block at all" and "stop_reason was
        // max_tokens before any text block was produced" — either way
        // there's nothing usable to parse, and we never retry.
        throw new HttpsError("unavailable", "Matchmaker unavailable.");
      }
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      throw new HttpsError("unavailable", "Matchmaker unavailable.");
    } finally {
      clearTimeout(timeout);
    }

    const result = parseMatchReply(text, candidateIds);
    if (!result) {
      throw new HttpsError("unavailable", "Matchmaker unavailable.");
    }
    return result;
  }
);

/**
 * Firestore trigger: keeps each participant's bookedSlots in sync
 * with the meeting response on a thread message, so a slot is only
 * ever recorded server-side (the client no longer writes it).
 */
exports.syncBookedSlots = onDocumentUpdated(
  { document: "threads/{tid}/messages/{mid}", region: REGION, maxInstances: 10 },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!after || !after.meeting) return;
    if (before.resp === after.resp) return;

    const ids = splitThreadId(event.params.tid);
    if (!ids) return;
    const [a, b] = ids;
    const mid = event.params.mid;

    const FieldValue = admin.firestore.FieldValue;

    if (after.resp === "accepted") {
      const slotForA = buildSlot(after.meeting, b, mid);
      const slotForB = buildSlot(after.meeting, a, mid);
      if (!slotForA || !slotForB) return;
      await Promise.all([
        db.collection("participants").doc(a).set({ bookedSlots: FieldValue.arrayUnion(slotForA) }, { merge: true }),
        db.collection("participants").doc(b).set({ bookedSlots: FieldValue.arrayUnion(slotForB) }, { merge: true }),
      ]);
    } else if (before.resp === "accepted") {
      const slotForA = buildSlot(before.meeting, b, mid);
      const slotForB = buildSlot(before.meeting, a, mid);
      if (!slotForA || !slotForB) return;
      await Promise.all([
        db.collection("participants").doc(a).set({ bookedSlots: FieldValue.arrayRemove(slotForA) }, { merge: true }),
        db.collection("participants").doc(b).set({ bookedSlots: FieldValue.arrayRemove(slotForB) }, { merge: true }),
      ]);
    }
  }
);
