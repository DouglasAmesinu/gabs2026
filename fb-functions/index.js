"use strict";

const crypto = require("crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");

const { normalizeRef, isValidRef } = require("./lib/ticketRef");
const { applyRateLimit } = require("./lib/rateLimit");
const { getClientIp } = require("./lib/clientIp");
const { buildSlot } = require("./lib/slots");
const { planMigration } = require("./lib/migrate");

const REGION = "europe-west1";
setGlobalOptions({ region: REGION });

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// No default — must be configured per environment. Never hard-code an
// admin email/UID in the repo.
const ADMIN_UID = defineString("ADMIN_UID");

const MAX_REFS_PER_CALL = 2000;
const BATCH_SIZE = 400;

/**
 * Public callable: exchange a ticket reference for a custom auth
 * token. Rate-limited per client IP (hashed, never stored in the
 * clear). Never logs the ref or any issued token.
 */
exports.signInWithTicket = onCall({ region: REGION }, async (request) => {
  const ref = normalizeRef(request.data && request.data.ref);
  if (!isValidRef(ref)) {
    throw new HttpsError("invalid-argument", "Invalid ticket reference.");
  }

  const ip = getClientIp(request.rawRequest);
  const ipHash = crypto.createHash("sha256").update(ip).digest("hex");
  const rateRef = db.collection("rate").doc(ipHash);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rateRef);
    const existing = snap.exists ? snap.data() : null;
    const decision = applyRateLimit(existing, Date.now());
    if (!decision.allowed) {
      throw new HttpsError("resource-exhausted", "Too many attempts. Please try again later.");
    }
    tx.set(rateRef, { count: decision.count, windowStart: decision.windowStart }, { merge: true });
  });

  const ticketRef = db.collection("tickets").doc(ref);
  const ticketSnap = await ticketRef.get();
  if (!ticketSnap.exists) {
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
exports.adminUploadTickets = onCall({ region: REGION }, async (request) => {
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
 * Firestore trigger: keeps each participant's bookedSlots in sync
 * with the meeting response on a thread message, so a slot is only
 * ever recorded server-side (the client no longer writes it).
 */
exports.syncBookedSlots = onDocumentUpdated(
  { document: "threads/{tid}/messages/{mid}", region: REGION },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!after || !after.meeting) return;
    if (before.resp === after.resp) return;

    const ids = String(event.params.tid).split("_");
    if (ids.length !== 2) return;
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
