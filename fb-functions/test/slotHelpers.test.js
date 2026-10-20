"use strict";

// Tests the pure meeting-slot helpers that live inside index.html between the
// "// BEGIN slot-helpers" and "// END slot-helpers" marker comments.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");

function loadHelpers() {
  const start = html.indexOf("// BEGIN slot-helpers");
  const end = html.indexOf("// END slot-helpers");
  assert.ok(start > -1 && end > start, "slot-helpers markers not found in index.html");
  const block = html.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${block}\nreturn { MAX_MEETING_END, allSlots, slotAllowed };`)();
}

// The durations the meeting form offers, read from the page so the test follows it
function formDurations() {
  const m = /const DURATIONS=\[([\d,\s]+)\];/.exec(html);
  assert.ok(m, "DURATIONS not found in index.html");
  return m[1].split(",").map((s) => Number(s.trim()));
}

const { MAX_MEETING_END, allSlots, slotAllowed } = loadHelpers();
const mins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const END = mins("16:30");

test("the latest meeting end is 16:30", () => {
  assert.equal(MAX_MEETING_END, "16:30");
});

test("the slot grid keeps its earliest start and 30-minute interval", () => {
  const slots = allSlots();
  assert.equal(slots[0], "08:00");
  for (let i = 1; i < slots.length; i++) assert.equal(mins(slots[i]) - mins(slots[i - 1]), 30);
});

for (const dur of formDurations()) {
  test(`${dur} min: the last offered start ends by 16:30 and the next start is refused`, () => {
    const slots = allSlots();
    const offered = slots.filter((s) => slotAllowed(s, dur));
    assert.ok(offered.length > 0);
    const last = offered[offered.length - 1];
    assert.ok(mins(last) + dur <= END, `${last}+${dur} ends after 16:30`);
    const next = slots[slots.indexOf(last) + 1];
    assert.ok(next, "there is a later slot on the grid");
    assert.equal(slotAllowed(next, dur), false, `${next}+${dur} should be refused`);
    // Every offered start is a prefix of the grid: nothing later sneaks back in
    assert.deepEqual(offered, slots.slice(0, offered.length));
  });
}

test("boundary cases around 16:30", () => {
  assert.equal(slotAllowed("16:00", 30), true);
  assert.equal(slotAllowed("16:15", 15), true);
  assert.equal(slotAllowed("16:15", 30), false);
  assert.equal(slotAllowed("16:30", 15), false);
});

test("slotAllowed refuses malformed input", () => {
  for (const [start, dur] of [["", 30], [null, 30], ["9", 30], ["09:00", 0], ["09:00", -15], ["09:00", "abc"], ["09:00", 1.5], [{}, 30]]) {
    assert.equal(slotAllowed(start, dur), false, `${String(start)}+${String(dur)}`);
  }
  assert.equal(slotAllowed("9:00", 30), true);
});
