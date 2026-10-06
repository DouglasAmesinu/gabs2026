"use strict";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LIMIT = 30; // attempts per window

/**
 * Pure decision function for a fixed-window rate limiter. Does not
 * touch Firestore or any I/O — the caller is responsible for reading
 * `existing` from (and writing the result back into) the rate-limit
 * document inside a transaction.
 *
 * @param {{count:number, windowStart:number}|null|undefined} existing
 *   Current state, or null/undefined if no document exists yet.
 * @param {number} now Current time in ms (e.g. Date.now()).
 * @returns {{allowed:boolean, count:number, windowStart:number}}
 *   The state to persist. When `allowed` is false, `count` and
 *   `windowStart` are unchanged from `existing` (nothing should be
 *   written, or it may be written back as-is — it's a no-op either way).
 */
function applyRateLimit(existing, now) {
  const windowExpired =
    !existing ||
    typeof existing.windowStart !== "number" ||
    typeof existing.count !== "number" ||
    now - existing.windowStart >= WINDOW_MS;

  if (windowExpired) {
    return { allowed: true, count: 1, windowStart: now };
  }
  if (existing.count < LIMIT) {
    return { allowed: true, count: existing.count + 1, windowStart: existing.windowStart };
  }
  return { allowed: false, count: existing.count, windowStart: existing.windowStart };
}

module.exports = { applyRateLimit, WINDOW_MS, LIMIT };
