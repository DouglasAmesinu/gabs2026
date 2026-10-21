"use strict";

const crypto = require("crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentUpdated, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineString, defineSecret, defineInt } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { getMessaging } = require("firebase-admin/messaging");

const { normalizeRef, isValidRef } = require("./lib/ticketRef");
const { isBlocked, recordFailure } = require("./lib/rateLimit");
const { getClientIp } = require("./lib/clientIp");
const { buildSlot, splitThreadId } = require("./lib/slots");
const { planMigration } = require("./lib/migrate");
const { validateResetInput, chunk, RESET_COLLECTIONS } = require("./lib/reset");
const { validateInput, buildPrompt, extractText, parseMatchReply, rateDecision, dayKeyFor } = require("./lib/match");
const { requireAdmin } = require("./lib/adminAuth");
const { pickProfile } = require("./lib/profile");
const { validateAnnouncement, validateAnnouncementId } = require("./lib/announce");
const {
  validToken,
  addToken,
  removeToken,
  shouldSend,
  cleanName,
  buildAlert,
  recipientOf,
  deadTokens,
  callWindow,
} = require("./lib/push");
const {
  validateBlockInput,
  validateUnblockInput,
  isTicketBlocked,
  isAuthUserNotFound,
  MESSAGE_DELETE_BATCH,
  TICKET_LOOKUP_LIMIT,
} = require("./lib/block");

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
// Warm instances for signInWithTicket (e.g. 1 during the summit days); 0 costs nothing when idle.
const SIGNIN_MIN_INSTANCES = defineInt("SIGNIN_MIN_INSTANCES", { default: 0 });
const AI_GLOBAL_DAILY_LIMIT = 1500;

const MAX_REFS_PER_CALL = 2000;
// adminPostAnnouncement refuses new posts once this many announcement documents exist
const MAX_ANNOUNCEMENTS = 100;
const BATCH_SIZE = 400;

/**
 * Public callable: exchange a ticket reference for a custom auth
 * token. Rate-limited per client IP (hashed, never stored in the
 * clear), counting FAILED attempts only, so delegates sharing a venue
 * IP are never locked out by successful sign-ins. Never logs the ref,
 * the IP or any issued token. Returns the participant's profile (or
 * null) so the client can enter the app without a further read.
 */
exports.signInWithTicket = onCall({ region: REGION, maxInstances: 10, minInstances: SIGNIN_MIN_INSTANCES }, async (request) => {
  const ip = getClientIp(request.rawRequest);
  const ipHash = crypto.createHash("sha256").update(ip).digest("hex");
  const rateRef = db.collection("rate").doc(ipHash);

  // The rate and ticket documents are independent: read them together.
  // The checks below still run in the original order.
  const ref = normalizeRef(request.data && request.data.ref);
  const refValid = isValidRef(ref);
  const ticketRef = refValid ? db.collection("tickets").doc(ref) : null;
  const [rateSnap, ticketSnap] = await Promise.all([rateRef.get(), ticketRef ? ticketRef.get() : null]);

  if (isBlocked(rateSnap.exists ? rateSnap.data() : null, Date.now())) {
    throw new HttpsError("resource-exhausted", "Too many attempts. Please try again later.");
  }

  const countFailure = () =>
    db.runTransaction(async (tx) => {
      const snap = await tx.get(rateRef);
      const next = recordFailure(snap.exists ? snap.data() : null, Date.now());
      tx.set(rateRef, next, { merge: true });
    });

  if (!refValid) {
    await countFailure();
    throw new HttpsError("invalid-argument", "Invalid ticket reference.");
  }

  if (!ticketSnap.exists) {
    await countFailure();
    throw new HttpsError("not-found", "Ticket not found");
  }
  // A blocked ticket is a known ticket, so it is not a failed attempt
  if (isTicketBlocked(ticketSnap.data())) {
    throw new HttpsError("permission-denied", "This ticket is not active. Please contact support.");
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

  // A freshly claimed ticket has no participant document yet
  const [token, participantSnap] = await Promise.all([
    admin.auth().createCustomToken(uid, { delegate: true }),
    isNew ? null : db.collection("participants").doc(uid).get(),
  ]);
  const profile = participantSnap && participantSnap.exists ? pickProfile(participantSnap.data()) : null;
  return { token, uid, isNew, profile };
});

/**
 * Admin-only callable: bulk-create ticket placeholder docs
 * ({uid: null}) for a batch of references. Never overwrites an
 * existing ticket doc.
 */
exports.adminUploadTickets = onCall({ region: REGION, maxInstances: 2 }, async (request) => {
  requireAdmin(request, ADMIN_UID.value());

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
  requireAdmin(request, ADMIN_UID.value());
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
 * Admin-only callable: block a delegate. Marks their ticket(s) blocked
 * (signInWithTicket then refuses them), revokes their sessions and
 * deletes their auth user, and unless deleteProfile === false deletes
 * their profile (incl. private contact), photo and every message they
 * are a participant of. Logs counts only, never the uid.
 */
exports.adminBlockDelegate = onCall({ region: REGION, maxInstances: 2 }, async (request) => {
  requireAdmin(request, ADMIN_UID.value());
  const input = validateBlockInput(request.data);
  if (!input) {
    throw new HttpsError("invalid-argument", "Invalid uid.");
  }
  const { uid, deleteProfile } = input;
  const FieldValue = admin.firestore.FieldValue;

  // 1) Tickets
  const ticketsSnap = await db.collection("tickets").where("uid", "==", uid).limit(TICKET_LOOKUP_LIMIT).get();
  if (!ticketsSnap.empty) {
    const batch = db.batch();
    ticketsSnap.docs.forEach((d) => batch.update(d.ref, { blocked: true, blockedAt: FieldValue.serverTimestamp() }));
    await batch.commit();
  }

  // 2) Sessions and auth user
  let authDeleted = 0;
  try {
    await admin.auth().revokeRefreshTokens(uid);
    await admin.auth().deleteUser(uid);
    authDeleted = 1;
  } catch (e) {
    if (!isAuthUserNotFound(e)) throw e;
  }

  // 3) Profile, photo, messages
  let profileDeleted = 0;
  let messagesDeleted = 0;
  if (deleteProfile) {
    const profileRef = db.collection("participants").doc(uid);
    profileDeleted = (await profileRef.get()).exists ? 1 : 0;
    await db.recursiveDelete(profileRef);

    await admin.storage().bucket().file(`photos/${uid}`).delete({ ignoreNotFound: true });

    const messagesQuery = db
      .collectionGroup("messages")
      .where("participants", "array-contains", uid)
      .orderBy("ts", "desc")
      .limit(MESSAGE_DELETE_BATCH);
    for (;;) {
      const snap = await messagesQuery.get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      messagesDeleted += snap.size;
    }
  }

  const result = { ticketsBlocked: ticketsSnap.size, profileDeleted, messagesDeleted, authDeleted };
  logger.info("adminBlockDelegate: done", result);
  return result;
});

/**
 * Admin-only callable: unblock a ticket. It also gets a fresh identity
 * (uid null, claimedAt removed), so the next sign-in creates a new
 * delegate. Never logs the ref.
 */
exports.adminUnblockTicket = onCall({ region: REGION, maxInstances: 2 }, async (request) => {
  requireAdmin(request, ADMIN_UID.value());
  const ref = validateUnblockInput(request.data);
  if (!ref) {
    throw new HttpsError("invalid-argument", "Invalid ticket reference.");
  }
  const ticketRef = db.collection("tickets").doc(ref);
  if (!(await ticketRef.get()).exists) {
    throw new HttpsError("not-found", "Ticket not found");
  }
  const FieldValue = admin.firestore.FieldValue;
  await ticketRef.update({
    blocked: FieldValue.delete(),
    blockedAt: FieldValue.delete(),
    uid: null,
    claimedAt: FieldValue.delete(),
  });
  logger.info("adminUnblockTicket: done");
  return { ok: true };
});

/**
 * Admin-only callable: post an announcement to every participant.
 * Input {title, body, pinned, expiresInMinutes} (see lib/announce).
 * Refused once MAX_ANNOUNCEMENTS documents exist. expiresAt is a
 * Timestamp, or null when the announcement never expires. Never logs
 * the announcement text.
 */
exports.adminPostAnnouncement = onCall({ region: REGION, maxInstances: 2 }, async (request) => {
  requireAdmin(request, ADMIN_UID.value());
  const input = validateAnnouncement(request.data);
  if (!input) {
    throw new HttpsError("invalid-argument", "Invalid announcement.");
  }
  const coll = db.collection("announcements");
  const existing = (await coll.count().get()).data().count;
  if (existing >= MAX_ANNOUNCEMENTS) {
    throw new HttpsError("resource-exhausted", "Too many announcements. Delete some first.");
  }
  const { Timestamp, FieldValue } = admin.firestore;
  const expiresAt = input.expiresInMinutes > 0
    ? Timestamp.fromMillis(Date.now() + input.expiresInMinutes * 60 * 1000)
    : null;
  const ref = await coll.add({
    title: input.title,
    body: input.body,
    pinned: input.pinned,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });
  logger.info("adminPostAnnouncement: done", { pinned: input.pinned, expiresInMinutes: input.expiresInMinutes });
  return { id: ref.id };
});

/**
 * Admin-only callable: delete one announcement. Input {id}: 1-40
 * letters or digits.
 */
exports.adminDeleteAnnouncement = onCall({ region: REGION, maxInstances: 2 }, async (request) => {
  requireAdmin(request, ADMIN_UID.value());
  const id = validateAnnouncementId(request.data);
  if (!id) {
    throw new HttpsError("invalid-argument", "Invalid announcement id.");
  }
  await db.collection("announcements").doc(id).delete();
  logger.info("adminDeleteAnnouncement: done");
  return { ok: true };
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
  requireAdmin(request, ADMIN_UID.value());

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

// ── Push alerts ──────────────────────────────────────────────────────────────
// pushTokens/{uid} is SERVER-ONLY: firestore.rules has no entry for it, so
// the default deny applies and no client can read or write it. Only these
// functions (Admin SDK) touch it: {tokens:[{t, at}], platform, updatedAt,
// muted, lastSent:{senderId: ms}}. Never log tokens, names, message text
// or participant ids here; counts only.
const PUSH_PLATFORMS = ["android", "ios", "desktop"];
const PUSH_OPTS = { region: REGION, maxInstances: 5 };
const PUSH_REGISTER_PER_HOUR = 10;
const PUSH_TEST_PER_HOUR = 3;
const PUSH_MAX_AGE_MS = 120 * 1000;
const PUSH_WEBPUSH = { headers: { TTL: "3600", Urgency: "high" } };

/** The caller's uid when signed in as a delegate; otherwise unauthenticated. */
function requireDelegate(request) {
  if (!request.auth || request.auth.token.delegate !== true) {
    throw new HttpsError("unauthenticated", "Please sign in again.");
  }
  return request.auth.uid;
}

/**
 * Count one call against rate/{docId} (same transaction pattern as the
 * sign-in limiter); refuses with resource-exhausted over the limit.
 */
async function consumePushCall(docId, perHour) {
  const rateRef = db.collection("rate").doc(docId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rateRef);
    const decision = callWindow(snap.exists ? snap.data() : null, Date.now(), perHour);
    if (!decision.allowed) {
      throw new HttpsError("resource-exhausted", "Too many requests. Please try again later.");
    }
    tx.set(rateRef, decision.next, { merge: true });
  });
}

/** The stored token strings (malformed entries dropped). */
const storedTokens = (data) => removeToken(data && data.tokens, null).map((e) => e.t);

/**
 * Send a DATA-ONLY message (no "notification" field; every value a
 * string) to the given tokens, then remove the tokens FCM reports as
 * dead from pushTokens/{uid}. Returns counts only.
 */
async function sendPush(uid, tokens, data) {
  const res = await getMessaging().sendEachForMulticast({ tokens, data, webpush: PUSH_WEBPUSH });
  const dead = deadTokens(tokens, res.responses);
  if (dead.length) {
    const ref = db.collection("pushTokens").doc(uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const tokensLeft = dead.reduce((list, t) => removeToken(list, t), snap.data().tokens);
      tx.update(ref, { tokens: tokensLeft });
    });
  }
  return { sent: res.successCount, failed: res.failureCount, removed: dead.length };
}

/**
 * Delegate callable: register this device's FCM token. Input {token,
 * platform: "android"|"ios"|"desktop"}. Keeps at most 5 tokens, newest
 * first, and the stored muted and lastSent. 10 calls per hour per uid.
 */
exports.registerPushToken = onCall(PUSH_OPTS, async (request) => {
  const uid = requireDelegate(request);
  await consumePushCall(`push_${uid}`, PUSH_REGISTER_PER_HOUR);
  const data = request.data || {};
  if (!validToken(data.token) || !PUSH_PLATFORMS.includes(data.platform)) {
    throw new HttpsError("invalid-argument", "Invalid push registration.");
  }
  const ref = db.collection("pushTokens").doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : {};
    tx.set(ref, {
      tokens: addToken(cur.tokens, data.token, Date.now()),
      platform: data.platform,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      muted: cur.muted === true,
      lastSent: cur.lastSent && typeof cur.lastSent === "object" && !Array.isArray(cur.lastSent) ? cur.lastSent : {},
    });
  });
  logger.info("registerPushToken: done");
  return { ok: true };
});

/** Delegate callable: forget one of the caller's tokens. Input {token}. */
exports.unregisterPushToken = onCall(PUSH_OPTS, async (request) => {
  const uid = requireDelegate(request);
  const token = request.data && request.data.token;
  if (!validToken(token)) {
    throw new HttpsError("invalid-argument", "Invalid push token.");
  }
  const ref = db.collection("pushTokens").doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    tx.update(ref, {
      tokens: removeToken(snap.data().tokens, token),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

/** Delegate callable: mute or unmute alerts. Input {muted: boolean}. */
exports.setPushMuted = onCall(PUSH_OPTS, async (request) => {
  const uid = requireDelegate(request);
  const muted = request.data && request.data.muted;
  if (typeof muted !== "boolean") {
    throw new HttpsError("invalid-argument", "muted must be true or false.");
  }
  await db.collection("pushTokens").doc(uid).set(
    { muted, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  return { ok: true };
});

/**
 * Delegate callable: send a test alert to the caller's own devices (also
 * when muted, since the caller asked for it). 3 calls per hour per uid.
 * Returns {sent}.
 */
exports.sendTestPush = onCall(PUSH_OPTS, async (request) => {
  const uid = requireDelegate(request);
  await consumePushCall(`pushtest_${uid}`, PUSH_TEST_PER_HOUR);
  const snap = await db.collection("pushTokens").doc(uid).get();
  const tokens = snap.exists ? storedTokens(snap.data()) : [];
  if (!tokens.length) return { sent: 0 };
  const result = await sendPush(uid, tokens, {
    title: "GABS Connect",
    body: "Test alert: notifications are working.",
    tag: "test",
    url: "/",
    kind: "test",
  });
  logger.info("sendTestPush: done", result);
  return { sent: result.sent };
});

/**
 * Firestore trigger: alert the recipient of a new chat message or
 * meeting request on their registered devices. Skips messages older
 * than 2 minutes (late or retried events), muted recipients, a repeat
 * alert from the same sender within 10 seconds, and more than 10 alerts
 * from one sender in 10 minutes (shouldSend).
 */
exports.notifyNewMessage = onDocumentCreated(
  { document: "threads/{tid}/messages/{mid}", region: REGION, maxInstances: 10 },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    const recipient = recipientOf(event.params.tid, data.fromId);
    if (!recipient) return;

    const createdMs =
      data.ts && typeof data.ts.toMillis === "function"
        ? data.ts.toMillis()
        : snap.createTime && typeof snap.createTime.toMillis === "function"
          ? snap.createTime.toMillis()
          : Date.now();
    if (Date.now() - createdMs > PUSH_MAX_AGE_MS) return;

    const ref = db.collection("pushTokens").doc(recipient);
    const first = await ref.get();
    if (!first.exists || first.data().muted === true || !storedTokens(first.data()).length) return;

    // Decide and stamp lastSent in one transaction so near-simultaneous
    // messages from the same sender raise one alert
    const tokens = await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      if (!cur.exists) return null;
      const d = cur.data();
      const list = storedTokens(d);
      if (!list.length) return null;
      const decision = shouldSend({ muted: d.muted, lastSent: d.lastSent, senderId: data.fromId, nowMs: Date.now() });
      if (!decision.send) return null;
      tx.update(ref, { lastSent: decision.nextLastSent });
      return list;
    });
    if (!tokens) return;

    const alert = buildAlert({
      kind: data.hasMeeting === true ? "meeting" : "message",
      senderName: cleanName(data.fromName),
      senderId: data.fromId,
    });
    if (!alert) return;
    const result = await sendPush(recipient, tokens, alert);
    logger.info("notifyNewMessage: done", result);
  }
);
