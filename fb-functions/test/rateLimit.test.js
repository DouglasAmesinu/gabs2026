"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isBlocked, recordFailure, WINDOW_MS, LIMIT } = require("../lib/rateLimit");

/**
 * Mirrors signInWithTicket: check first, then only a failed attempt
 * (not-found / invalid format) writes to the rate document.
 * Returns "blocked", "ok" or "failed" and the new stored state.
 */
function attempt(state, now, succeeds) {
  if (isBlocked(state, now)) return { outcome: "blocked", state };
  if (succeeds) return { outcome: "ok", state };
  return { outcome: "failed", state: recordFailure(state, now) };
}

test("constants match spec: 100 failures per 15-minute window", () => {
  assert.equal(LIMIT, 100);
  assert.equal(WINDOW_MS, 15 * 60 * 1000);
});

test("no record (null or undefined) is never blocked", () => {
  assert.equal(isBlocked(null, 1_000_000), false);
  assert.equal(isBlocked(undefined, 1_000_000), false);
});

test("first failure starts a fresh window at count 1", () => {
  const now = 1_000_000;
  assert.deepEqual(recordFailure(null, now), { count: 1, windowStart: now });
  assert.deepEqual(recordFailure(undefined, now), { count: 1, windowStart: now });
});

test("a failure within the window increments count and keeps windowStart", () => {
  const windowStart = 1_000_000;
  assert.deepEqual(recordFailure({ count: 5, windowStart }, windowStart + 1000), { count: 6, windowStart });
});

test("successful sign-ins never consume the allowance", () => {
  let state = null;
  let now = 1_000_000;
  for (let i = 0; i < 1000; i++) {
    const r = attempt(state, now++, true);
    assert.equal(r.outcome, "ok");
    state = r.state;
  }
  assert.equal(state, null, "successes must not create or change the rate record");

  // 99 failures interleaved with successes still leave room for one more try
  for (let i = 0; i < LIMIT - 1; i++) {
    state = attempt(state, now++, false).state;
    assert.equal(attempt(state, now++, true).outcome, "ok");
  }
  assert.equal(state.count, LIMIT - 1);
  assert.equal(isBlocked(state, now), false);
});

test("100 failures then block, including would-be successes", () => {
  let state = null;
  const start = 1_000_000;
  for (let i = 0; i < LIMIT; i++) {
    const r = attempt(state, start + i, false);
    assert.equal(r.outcome, "failed", `attempt ${i + 1} should be allowed`);
    state = r.state;
  }
  assert.deepEqual(state, { count: LIMIT, windowStart: start });
  assert.equal(attempt(state, start + LIMIT, false).outcome, "blocked");
  assert.equal(attempt(state, start + LIMIT, true).outcome, "blocked");
  assert.deepEqual(attempt(state, start + LIMIT, false).state, state, "a blocked attempt writes nothing");
});

test("just before the window elapses, the block still applies", () => {
  const windowStart = 1_000_000;
  assert.equal(isBlocked({ count: LIMIT, windowStart }, windowStart + WINDOW_MS - 1), true);
});

test("window resets after 15 minutes", () => {
  const windowStart = 1_000_000;
  const blocked = { count: LIMIT, windowStart };
  const later = windowStart + WINDOW_MS; // exactly at the boundary
  assert.equal(isBlocked(blocked, later), false);
  assert.deepEqual(recordFailure(blocked, later), { count: 1, windowStart: later });
  assert.equal(isBlocked(blocked, windowStart + WINDOW_MS * 10), false);
});

test("malformed record (non-numeric fields) is treated as no record", () => {
  const now = 1_000_000;
  assert.equal(isBlocked({ count: "oops", windowStart: 500 }, now), false);
  assert.equal(isBlocked({ count: LIMIT, windowStart: "oops" }, now), false);
  assert.deepEqual(recordFailure({ count: "oops", windowStart: 500 }, now), { count: 1, windowStart: now });
});
