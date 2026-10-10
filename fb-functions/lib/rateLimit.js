"use strict";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LIMIT = 100; // failed attempts per window

/**
 * True when `existing` is a usable record whose window is still open.
 * @param {{count:number, windowStart:number}|null|undefined} existing
 * @param {number} now
 */
function windowActive(existing, now) {
  return (
    !!existing &&
    typeof existing.windowStart === "number" &&
    typeof existing.count === "number" &&
    now - existing.windowStart < WINDOW_MS
  );
}

/**
 * Pure check for a fixed-window limiter that only counts FAILED
 * sign-in attempts. Call it before doing any work; successful sign-ins
 * never write to the rate document, so they never consume the allowance.
 *
 * @param {{count:number, windowStart:number}|null|undefined} existing
 *   Current state of the rate document, or null/undefined if none.
 * @param {number} now Current time in ms (e.g. Date.now()).
 * @returns {boolean} true when the caller must be refused.
 */
function isBlocked(existing, now) {
  return windowActive(existing, now) && existing.count >= LIMIT;
}

/**
 * Pure state transition for one failed attempt. The caller reads
 * `existing` and writes the result back inside a transaction.
 *
 * @param {{count:number, windowStart:number}|null|undefined} existing
 * @param {number} now
 * @returns {{count:number, windowStart:number}} the state to persist.
 */
function recordFailure(existing, now) {
  if (!windowActive(existing, now)) {
    return { count: 1, windowStart: now };
  }
  return { count: existing.count + 1, windowStart: existing.windowStart };
}

module.exports = { isBlocked, recordFailure, WINDOW_MS, LIMIT };
