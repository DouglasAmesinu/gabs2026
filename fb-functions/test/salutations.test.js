"use strict";

// The Salutation options (registration and Edit Profile) come from SALUTATIONS in index.html.
// Values are stored without a period; the app shows them as "<value>. <name>" (so "Ing" shows as "Ing.").

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function salutations() {
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  const m = html.match(/const SALUTATIONS=(\[[^\]]*\]);/);
  assert.ok(m, "SALUTATIONS not found in index.html");
  return JSON.parse(m[1]);
}

test("salutation options contain Ing (shown as Ing.) and no longer Eng", () => {
  const list = salutations();
  assert.ok(list.includes("Ing"), "Ing is an option");
  assert.ok(!list.includes("Eng") && !list.includes("Eng."), "Eng is no longer an option");
  assert.ok(!list.some(s => /\bEng\b/.test(s)), "no option mentions Eng");
});

test("Ing keeps Eng's place in the list", () => {
  assert.deepEqual(salutations(), ["Mr", "Mrs", "Ms", "Dr", "Prof", "Prof Dr", "Ing", "Ambassador", "Hon", "Rev", "Other"]);
});
