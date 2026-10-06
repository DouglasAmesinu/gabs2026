"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRef, isValidRef } = require("../lib/ticketRef");

test("normalizeRef trims leading/trailing whitespace", () => {
  assert.equal(normalizeRef("  gabs-123456  "), "GABS-123456");
});

test("normalizeRef removes all internal whitespace", () => {
  assert.equal(normalizeRef("GABS 1234 5678"), "GABS12345678");
});

test("normalizeRef folds unicode dash variants to a plain hyphen", () => {
  // U+2010 HYPHEN, U+2013 EN DASH, U+2014 EM DASH, U+2015 HORIZONTAL BAR, U+2212 MINUS SIGN
  const variants = ["‐", "–", "—", "―", "−"];
  for (const dash of variants) {
    assert.equal(normalizeRef(`gabs${dash}123456`), "GABS-123456", `dash U+${dash.codePointAt(0).toString(16)}`);
  }
});

test("normalizeRef uppercases the result", () => {
  assert.equal(normalizeRef("gabs-abcdef"), "GABS-ABCDEF");
});

test("normalizeRef handles null/undefined/non-string input without throwing", () => {
  assert.equal(normalizeRef(null), "");
  assert.equal(normalizeRef(undefined), "");
  assert.equal(normalizeRef(12345), "12345");
});

test("isValidRef accepts a well-formed reference", () => {
  assert.equal(isValidRef("GABS123456"), true);
  assert.equal(isValidRef("GABS-ABCD-1234"), true);
});

test("isValidRef accepts the minimum length (6 chars after GABS)", () => {
  assert.equal(isValidRef("GABS123456"), true); // "123456" is exactly 6 chars
});

test("isValidRef accepts the maximum length (40 chars after GABS)", () => {
  const ref = "GABS" + "A".repeat(40);
  assert.equal(isValidRef(ref), true);
});

test("isValidRef rejects too few characters after GABS", () => {
  assert.equal(isValidRef("GABS123"), false); // only 3 chars after GABS
});

test("isValidRef rejects too many characters after GABS", () => {
  const ref = "GABS" + "A".repeat(41);
  assert.equal(isValidRef(ref), false);
});

test("isValidRef rejects a missing GABS prefix", () => {
  assert.equal(isValidRef("123456789012"), false);
});

test("isValidRef rejects lowercase input (it expects already-normalised refs)", () => {
  assert.equal(isValidRef("gabs123456"), false);
});

test("isValidRef rejects disallowed characters", () => {
  assert.equal(isValidRef("GABS123_456"), false);
  assert.equal(isValidRef("GABS123 456"), false);
});

test("normalizeRef then isValidRef accepts a messy real-world input", () => {
  const ref = normalizeRef("  gabs–12‐ab  cd  ");
  assert.equal(ref, "GABS-12-ABCD");
  assert.equal(isValidRef(ref), true);
});
