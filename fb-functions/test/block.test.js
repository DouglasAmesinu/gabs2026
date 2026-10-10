"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateBlockInput,
  validateUnblockInput,
  isTicketBlocked,
  isAuthUserNotFound,
  MESSAGE_DELETE_BATCH,
} = require("../lib/block");

test("validateBlockInput accepts a plain uid and defaults deleteProfile to true", () => {
  assert.deepEqual(validateBlockInput({ uid: "AbC123_-x" }), { uid: "AbC123_-x", deleteProfile: true });
  assert.deepEqual(validateBlockInput({ uid: "a".repeat(64) }), { uid: "a".repeat(64), deleteProfile: true });
});

test("validateBlockInput only turns deleteProfile off for a literal false", () => {
  assert.equal(validateBlockInput({ uid: "u1", deleteProfile: false }).deleteProfile, false);
  assert.equal(validateBlockInput({ uid: "u1", deleteProfile: true }).deleteProfile, true);
  assert.equal(validateBlockInput({ uid: "u1", deleteProfile: "false" }).deleteProfile, true);
  assert.equal(validateBlockInput({ uid: "u1", deleteProfile: 0 }).deleteProfile, true);
  assert.equal(validateBlockInput({ uid: "u1", deleteProfile: null }).deleteProfile, true);
});

test("validateBlockInput rejects missing or malformed uids", () => {
  for (const data of [
    undefined,
    null,
    "u1",
    {},
    { uid: "" },
    { uid: "a".repeat(65) },
    { uid: "a/b" },
    { uid: "../participants" },
    { uid: "a b" },
    { uid: "a.b" },
    { uid: "ü" },
    { uid: 123 },
    { uid: ["u1"] },
  ]) {
    assert.equal(validateBlockInput(data), null, `rejects ${JSON.stringify(data)}`);
  }
});

test("validateUnblockInput normalises like signInWithTicket", () => {
  assert.equal(validateUnblockInput({ ref: " gabs2026-t-abc123 " }), "GABS2026-T-ABC123");
  assert.equal(validateUnblockInput({ ref: "GABS2026–T–ABC123" }), "GABS2026-T-ABC123", "en dashes are folded");
  assert.equal(validateUnblockInput({ ref: "GABS 2026-T-ABC 123" }), "GABS2026-T-ABC123");
});

test("validateUnblockInput rejects invalid refs", () => {
  for (const data of [undefined, null, {}, { ref: "" }, { ref: "ABC123" }, { ref: "GABS12" }, { ref: "GABS2026/T/1" }, { ref: "GABS" + "A".repeat(41) }]) {
    assert.equal(validateUnblockInput(data), null, `rejects ${JSON.stringify(data)}`);
  }
});

test("isTicketBlocked is true only for blocked === true", () => {
  assert.equal(isTicketBlocked({ blocked: true }), true);
  for (const t of [null, undefined, {}, { blocked: false }, { blocked: "true" }, { blocked: 1 }]) {
    assert.equal(isTicketBlocked(t), false);
  }
});

test("isAuthUserNotFound recognises the Admin SDK error shapes", () => {
  assert.equal(isAuthUserNotFound({ code: "auth/user-not-found" }), true);
  assert.equal(isAuthUserNotFound({ errorInfo: { code: "auth/user-not-found" } }), true);
  assert.equal(isAuthUserNotFound({ code: "auth/internal-error" }), false);
  assert.equal(isAuthUserNotFound(null), false);
});

test("messages are deleted in batches of 400", () => {
  assert.equal(MESSAGE_DELETE_BATCH, 400);
});
