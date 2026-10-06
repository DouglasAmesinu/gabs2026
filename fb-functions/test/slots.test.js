"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { timeToMins, minsToTime, buildSlot } = require("../lib/slots");

test("timeToMins converts HH:MM to minutes since midnight", () => {
  assert.equal(timeToMins("00:00"), 0);
  assert.equal(timeToMins("09:30"), 570);
  assert.equal(timeToMins("23:59"), 1439);
});

test("minsToTime converts minutes back to zero-padded HH:MM", () => {
  assert.equal(minsToTime(0), "00:00");
  assert.equal(minsToTime(570), "09:30");
  assert.equal(minsToTime(1439), "23:59");
  assert.equal(minsToTime(65), "01:05");
});

test("timeToMins and minsToTime round-trip", () => {
  for (const t of ["00:00", "09:30", "12:00", "23:59"]) {
    assert.equal(minsToTime(timeToMins(t)), t);
  }
});

test("buildSlot computes end from start + dur", () => {
  const slot = buildSlot({ day: "20261124", start: "09:00", dur: 30 }, "other-uid", "msg1");
  assert.deepEqual(slot, { day: "20261124", start: "09:00", end: "09:30", with: "other-uid", meetingId: "msg1" });
});

test("buildSlot defaults dur to 30 when missing", () => {
  const slot = buildSlot({ day: "20261124", start: "10:00" }, "other-uid", "msg1");
  assert.equal(slot.end, "10:30");
});

test("buildSlot handles a dur that crosses into the next hour", () => {
  const slot = buildSlot({ day: "20261124", start: "09:45", dur: 30 }, "other-uid", "msg1");
  assert.equal(slot.end, "10:15");
});

test("buildSlot returns null when meeting is missing", () => {
  assert.equal(buildSlot(null, "other-uid", "msg1"), null);
  assert.equal(buildSlot(undefined, "other-uid", "msg1"), null);
});

test("buildSlot returns null for a malformed day", () => {
  assert.equal(buildSlot({ day: "2026-11-24", start: "09:00" }, "other-uid", "msg1"), null);
  assert.equal(buildSlot({ day: "202611244", start: "09:00" }, "other-uid", "msg1"), null); // 9 digits
  assert.equal(buildSlot({ day: "", start: "09:00" }, "other-uid", "msg1"), null);
  assert.equal(buildSlot({ start: "09:00" }, "other-uid", "msg1"), null); // day missing entirely
});

test("buildSlot returns null for a malformed start time", () => {
  assert.equal(buildSlot({ day: "20261124", start: "9am" }, "other-uid", "msg1"), null);
  assert.equal(buildSlot({ day: "20261124", start: "9:0" }, "other-uid", "msg1"), null);
  assert.equal(buildSlot({ day: "20261124", start: "" }, "other-uid", "msg1"), null);
  assert.equal(buildSlot({ day: "20261124" }, "other-uid", "msg1"), null); // start missing entirely
});

test("buildSlot accepts a single-digit hour start time", () => {
  const slot = buildSlot({ day: "20261124", start: "9:00", dur: 30 }, "other-uid", "msg1");
  assert.equal(slot.start, "9:00");
  assert.equal(slot.end, "09:30");
});
