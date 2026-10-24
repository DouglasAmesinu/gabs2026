"use strict";

// The notification badge (the small monochrome icon in the Android status bar) is badge-96.png;
// sw.js passes it as the "badge" option of every notification. The Badging API counter is separate.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const read = f => fs.readFileSync(path.join(ROOT, f));
const BADGE = "/badge-96.png";

test("badge-96.png is a 96x96 RGBA PNG under 20 KB", () => {
  const png = read("badge-96.png");
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "PNG signature");
  assert.equal(png.toString("ascii", 12, 16), "IHDR", "IHDR is the first chunk");
  assert.equal(png.readUInt32BE(16), 96, "width");
  assert.equal(png.readUInt32BE(20), 96, "height");
  assert.equal(png[25], 6, "colour type 6 (RGBA)");
  assert.ok(png.length < 20 * 1024, `under 20 KB (is ${png.length} bytes)`);
});

test("every showNotification call uses /badge-96.png as its badge", () => {
  const sw = read("sw.js").toString("utf8");
  const calls = [...sw.matchAll(/showNotification\(([^,]+),([^)]*\)?)\)/g)].map(m => m[2].trim());
  assert.ok(calls.length >= 2, "the alert and its generic fallback");
  // Each call passes either opts or genericAlert(); both are built from the object literals checked below
  for (const arg of calls) assert.ok(arg === "opts" || arg === "genericAlert()", `showNotification options: ${arg}`);
  const literals = [
    sw.match(/const genericAlert=\(\)=>\((\{[^\n]*\})\);/),
    ...sw.matchAll(/opts=(\{[^\n;]*\});/g),
  ].filter(Boolean).map(m => m[1]);
  assert.ok(literals.length >= 2, "the generic fallback and the payload alert");
  assert.ok(literals.some(l => l.includes("You have a new message")), "the generic fallback is checked");
  for (const l of literals) {
    const badges = [...l.matchAll(/\bbadge:('[^']*'|"[^"]*"|[\w.]+)/g)].map(m => m[1]);
    assert.deepEqual(badges, [`'${BADGE}'`], `badge option in ${l}`);
  }
  // No other badge option anywhere in sw.js
  const all = [...sw.matchAll(/\bbadge:('[^']*'|"[^"]*"|[\w.]+)/g)].map(m => m[1]);
  assert.ok(all.length > 0 && all.every(v => v === `'${BADGE}'`), `all badge options: ${all.join(", ")}`);
});

test("CACHE_NAME is gabs2026-v24 and APP_VERSION is 24", () => {
  const sw = read("sw.js").toString("utf8");
  const html = read("index.html").toString("utf8");
  assert.match(sw, /^const CACHE_NAME='gabs2026-v24';/m);
  const v = html.match(/const APP_VERSION=(\d+);/);
  assert.ok(v, "APP_VERSION not found in index.html");
  assert.equal(Number(v[1]), 24);
});
