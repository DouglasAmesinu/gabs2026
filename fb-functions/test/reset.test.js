"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateResetInput, chunk, RESET_COLLECTIONS, RESET_BATCH_SIZE } = require("../lib/reset");

test("confirm must be exactly RESET", () => {
  assert.equal(validateResetInput(undefined), null);
  assert.equal(validateResetInput(null), null);
  assert.equal(validateResetInput("RESET"), null);
  assert.equal(validateResetInput({}), null);
  assert.equal(validateResetInput({ confirm: "reset" }), null);
  assert.equal(validateResetInput({ confirm: " RESET" }), null);
  assert.equal(validateResetInput({ confirm: true }), null);
  assert.deepEqual(validateResetInput({ confirm: "RESET" }), { unlinkTickets: false });
});

test("unlinkTickets is only true for a literal boolean true", () => {
  assert.deepEqual(validateResetInput({ confirm: "RESET", unlinkTickets: true }), { unlinkTickets: true });
  assert.deepEqual(validateResetInput({ confirm: "RESET", unlinkTickets: false }), { unlinkTickets: false });
  assert.deepEqual(validateResetInput({ confirm: "RESET", unlinkTickets: "true" }), { unlinkTickets: false });
  assert.deepEqual(validateResetInput({ confirm: "RESET", unlinkTickets: 1 }), { unlinkTickets: false });
});

test("tickets are never in the deleted collections", () => {
  assert.deepEqual(RESET_COLLECTIONS, ["participants", "threads", "aiUsage", "rate"]);
  assert.ok(!RESET_COLLECTIONS.includes("tickets"));
});

test("chunk defaults to batches of at most 400", () => {
  assert.equal(RESET_BATCH_SIZE, 400);
  const items = Array.from({ length: 1001 }, (_, i) => i);
  const parts = chunk(items);
  assert.deepEqual(parts.map((p) => p.length), [400, 400, 201]);
  assert.deepEqual(parts.flat(), items, "order is kept and nothing is lost or duplicated");
});

test("chunk handles exact multiples, small and empty input", () => {
  assert.deepEqual(chunk(Array(800).fill(0)).map((p) => p.length), [400, 400]);
  assert.deepEqual(chunk([1, 2, 3]), [[1, 2, 3]]);
  assert.deepEqual(chunk([]), []);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("chunk rejects a non-positive size", () => {
  assert.throws(() => chunk([1], 0), RangeError);
  assert.throws(() => chunk([1], -1), RangeError);
  assert.throws(() => chunk([1], 1.5), RangeError);
});
