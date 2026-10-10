"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { HttpsError } = require("firebase-functions/v2/https");
const { requireAdmin } = require("../lib/adminAuth");

const ADMIN = "adminUid123";
const denied = (fn) =>
  assert.throws(fn, (e) => e instanceof HttpsError && e.code === "permission-denied");

test("requireAdmin lets the configured admin through", () => {
  assert.doesNotThrow(() => requireAdmin({ auth: { uid: ADMIN } }, ADMIN));
});

test("requireAdmin refuses anonymous callers and other users", () => {
  denied(() => requireAdmin({}, ADMIN));
  denied(() => requireAdmin({ auth: null }, ADMIN));
  denied(() => requireAdmin({ auth: {} }, ADMIN));
  denied(() => requireAdmin({ auth: { uid: "someoneElse" } }, ADMIN));
  denied(() => requireAdmin({ auth: { uid: ADMIN.toUpperCase() } }, ADMIN));
  denied(() => requireAdmin(undefined, ADMIN));
});

test("requireAdmin refuses everyone when ADMIN_UID is not configured", () => {
  denied(() => requireAdmin({ auth: { uid: "" } }, ""));
  denied(() => requireAdmin({ auth: { uid: "x" } }, ""));
  denied(() => requireAdmin({ auth: {} }, undefined));
  denied(() => requireAdmin({ auth: { uid: "undefined" } }, undefined));
});

test("requireAdmin ignores delegate claims", () => {
  denied(() => requireAdmin({ auth: { uid: "d1", token: { delegate: true, admin: true } } }, ADMIN));
});
