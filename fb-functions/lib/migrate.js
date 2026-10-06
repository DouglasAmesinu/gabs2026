"use strict";

const { normalizeRef, isValidRef } = require("./ticketRef");

/**
 * Pure planning function — no I/O, never logs. Computes what the
 * one-time legacy-data migration needs to do:
 *   - every valid ref (from legacyRefs, or held by a participant's
 *     `ticket` field) ends up with a tickets/{ref} doc
 *   - a participant holding a ref gets that ticket's uid linked to
 *     them, unless the ref is contested or already linked elsewhere
 *   - each participant's email moves to participants/{id}/private/
 *     contact and is deleted from the public doc
 *   - each participant's legacy `ticket` field is deleted from the
 *     public doc once linked
 *
 * @param {object} input
 * @param {string[]} [input.legacyRefs] raw refs from config/tickets.refs
 * @param {Array<{id:string, ticket?:string, email?:string}>} [input.participants]
 * @param {Object<string,{uid:string|null}>} [input.existingTickets] current tickets/{ref} docs, keyed by ref
 * @returns {object} counts (refsTotal, ticketsToCreate, ticketsToLink,
 *   emailsToMove, participantsToClean, conflicts, invalidRefs,
 *   csvSkipped) plus the execution lists (ticketCreates, ticketLinks,
 *   emailMoves, publicCleanups) a caller can apply.
 */
function planMigration({ legacyRefs = [], participants = [], existingTickets = {} } = {}) {
  let invalidRefs = 0;
  let csvSkipped = 0;

  const allValidRefs = new Set();
  const refClaimants = new Map(); // normalised ref -> [participant ids]

  for (const raw of legacyRefs) {
    const ref = normalizeRef(raw);
    if (isValidRef(ref)) {
      allValidRefs.add(ref);
    } else {
      invalidRefs++;
    }
  }

  for (const p of participants || []) {
    const id = p && p.id;
    if (!id) continue;
    if (p.ticket) {
      const ref = normalizeRef(p.ticket);
      if (isValidRef(ref)) {
        allValidRefs.add(ref);
        if (!refClaimants.has(ref)) refClaimants.set(ref, []);
        refClaimants.get(ref).push(id);
      } else {
        invalidRefs++;
      }
    } else if (String(id).startsWith("csv_")) {
      csvSkipped++;
    }
  }

  // Conflicts: two-or-more participants claiming the same ref, or a
  // single claimant whose ref already belongs to a different uid.
  // Conflicted participants are fully excluded below — nothing of
  // theirs (ticket link, ticket cleanup, or email move) is touched.
  const conflictIds = new Set();
  for (const ids of refClaimants.values()) {
    if (ids.length > 1) {
      ids.forEach((id) => conflictIds.add(id));
    }
  }
  for (const [ref, ids] of refClaimants) {
    if (ids.length === 1) {
      const id = ids[0];
      const existing = existingTickets[ref];
      if (existing && existing.uid != null && existing.uid !== id) {
        conflictIds.add(id);
      }
    }
  }

  const ticketCreates = [];
  const ticketLinks = [];

  for (const ref of allValidRefs) {
    const claimantIds = (refClaimants.get(ref) || []).filter((id) => !conflictIds.has(id));
    const claimantId = claimantIds.length === 1 ? claimantIds[0] : null;
    const existing = existingTickets[ref];

    if (!existing) {
      ticketCreates.push({ ref, uid: claimantId || null });
    } else if (existing.uid == null && claimantId) {
      ticketLinks.push({ ref, uid: claimantId });
    }
    // Otherwise: already correctly linked (no-op), or belongs to
    // someone else with no surviving claimant — nothing to do.
  }

  const emailMoves = [];
  const cleanupMap = new Map(); // id -> {deleteEmail, deleteTicket}

  for (const p of participants || []) {
    const id = p && p.id;
    if (!id || conflictIds.has(id)) continue;
    const entry = { deleteEmail: false, deleteTicket: false };
    if (p.email) {
      emailMoves.push({ id, email: p.email });
      entry.deleteEmail = true;
    }
    if (p.ticket) {
      entry.deleteTicket = true;
    }
    if (entry.deleteEmail || entry.deleteTicket) {
      cleanupMap.set(id, entry);
    }
  }

  const publicCleanups = Array.from(cleanupMap, ([id, v]) => ({ id, ...v }));

  return {
    refsTotal: allValidRefs.size,
    ticketsToCreate: ticketCreates.length,
    ticketsToLink: ticketLinks.length,
    emailsToMove: emailMoves.length,
    participantsToClean: publicCleanups.filter((c) => c.deleteTicket).length,
    conflicts: Array.from(conflictIds),
    invalidRefs,
    csvSkipped,
    ticketCreates,
    ticketLinks,
    emailMoves,
    publicCleanups,
  };
}

module.exports = { planMigration };
