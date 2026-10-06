"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { applyRateLimit, WINDOW_MS, LIMIT } = require("../lib/rateLimit");

test("constants match spec: 30 attempts per 15-minute window", () => {
  assert.equal(LIMIT, 30);
  assert.equal(WINDOW_MS, 15 * 60 * 1000);
});

test("no existing record starts a fresh window at count 1", () => {
  const now = 1_000_000;
  const result = applyRateLimit(null, now);
  assert.deepEqual(result, { allowed: true, count: 1, windowStart: now });
});

test("undefined existing record is treated the same as null", () => {
  const now = 1_000_000;
  const result = applyRateLimit(undefined, now);
  assert.deepEqual(result, { allowed: true, count: 1, windowStart: now });
});

test("within the window, under the limit, increments count and keeps windowStart", () => {
  const windowStart = 1_000_000;
  const now = windowStart + 1000; // well within the 15-minute window
  const result = applyRateLimit({ count: 5, windowStart }, now);
  assert.deepEqual(result, { allowed: true, count: 6, windowStart });
});

test("within the window, right at the limit (count === LIMIT), is blocked", () => {
  const windowStart = 1_000_000;
  const now = windowStart + 1000;
  const result = applyRateLimit({ count: LIMIT, windowStart }, now);
  assert.deepEqual(result, { allowed: false, count: LIMIT, windowStart });
});

test("within the window, one below the limit (count === LIMIT - 1), is allowed up to LIMIT", () => {
  const windowStart = 1_000_000;
  const now = windowStart + 1000;
  const result = applyRateLimit({ count: LIMIT - 1, windowStart }, now);
  assert.deepEqual(result, { allowed: true, count: LIMIT, windowStart });
});

test("beyond the limit, stays blocked and does not increment further", () => {
  const windowStart = 1_000_000;
  const now = windowStart + 1000;
  const result = applyRateLimit({ count: LIMIT + 5, windowStart }, now);
  assert.deepEqual(result, { allowed: false, count: LIMIT + 5, windowStart });
});

test("once the window has fully elapsed, resets to count 1 at the new time", () => {
  const windowStart = 1_000_000;
  const now = windowStart + WINDOW_MS; // exactly at the boundary (>=)
  const result = applyRateLimit({ count: LIMIT, windowStart }, now);
  assert.deepEqual(result, { allowed: true, count: 1, windowStart: now });
});

test("just before the window elapses, the old window still applies", () => {
  const windowStart = 1_000_000;
  const now = windowStart + WINDOW_MS - 1; // one ms before the boundary
  const result = applyRateLimit({ count: LIMIT, windowStart }, now);
  assert.deepEqual(result, { allowed: false, count: LIMIT, windowStart });
});

test("long after the window has elapsed, still resets to count 1", () => {
  const windowStart = 1_000_000;
  const now = windowStart + WINDOW_MS * 10;
  const result = applyRateLimit({ count: LIMIT, windowStart }, now);
  assert.deepEqual(result, { allowed: true, count: 1, windowStart: now });
});

test("malformed existing record (non-numeric fields) is treated as no record", () => {
  const now = 1_000_000;
  assert.deepEqual(applyRateLimit({ count: "oops", windowStart: 500 }, now), {
    allowed: true,
    count: 1,
    windowStart: now,
  });
  assert.deepEqual(applyRateLimit({ count: 5, windowStart: "oops" }, now), {
    allowed: true,
    count: 1,
    windowStart: now,
  });
});
