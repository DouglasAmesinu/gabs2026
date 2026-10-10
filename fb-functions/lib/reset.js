"use strict";

// Collections wiped by adminReset. recursiveDelete also removes every
// subcollection (participants/*/private, threads/*/messages). The
// tickets collection is deliberately NOT in this list.
const RESET_COLLECTIONS = ["participants", "threads", "aiUsage", "rate"];
const RESET_BATCH_SIZE = 400;

/**
 * Validate adminReset input. Returns the normalised options, or null
 * when the request must be refused (confirm must be exactly "RESET").
 * @param {*} data request.data
 * @returns {{unlinkTickets:boolean}|null}
 */
function validateResetInput(data) {
  if (!data || typeof data !== "object" || data.confirm !== "RESET") return null;
  return { unlinkTickets: data.unlinkTickets === true };
}

/**
 * Split items into consecutive chunks of at most `size` (Firestore
 * batches allow 500 writes; we stay at 400).
 * @template T
 * @param {T[]} items
 * @param {number} [size]
 * @returns {T[][]}
 */
function chunk(items, size = RESET_BATCH_SIZE) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("size must be a positive integer");
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

module.exports = { validateResetInput, chunk, RESET_COLLECTIONS, RESET_BATCH_SIZE };
