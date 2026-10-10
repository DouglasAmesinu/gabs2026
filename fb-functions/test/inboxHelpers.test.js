"use strict";

// Tests the pure inbox helpers that live inside index.html between the
// "// BEGIN inbox-helpers" and "// END inbox-helpers" marker comments.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function loadHelpers() {
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  const start = html.indexOf("// BEGIN inbox-helpers");
  const end = html.indexOf("// END inbox-helpers");
  assert.ok(start > -1 && end > start, "inbox-helpers markers not found in index.html");
  const block = html.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${block}\nreturn { threadParticipants, buildInbox, applyMeetingChange };`)();
}

const { threadParticipants, buildInbox, applyMeetingChange } = loadHelpers();
const ts = (seconds, nanoseconds = 0) => ({ seconds, nanoseconds });
const ME = "m_me";
const A = "a_alice";
const Z = "z_zoe";

test("threadParticipants returns the pair sorted like tid()", () => {
  assert.deepEqual(threadParticipants("b", "a"), ["a", "b"]);
  assert.deepEqual(threadParticipants("a", "b"), ["a", "b"]);
  assert.equal(threadParticipants(Z, ME).join("__"), [Z, ME].sort().join("__"));
});

test("buildInbox keeps the newest message per other person", () => {
  const inbox = buildInbox(
    [
      { participants: [A, ME], fromId: A, text: "old", ts: ts(100) },
      { participants: [A, ME], fromId: A, text: "newest", ts: ts(300) },
      { participants: [A, ME], fromId: ME, text: "middle", ts: ts(200) },
      { participants: [ME, Z], fromId: Z, text: "zoe", ts: ts(150) },
    ],
    ME
  );
  assert.deepEqual(Object.keys(inbox).sort(), [A, Z]);
  assert.equal(inbox[A].text, "newest");
  assert.equal(inbox[Z].text, "zoe");
});

test("buildInbox handles messages from me and from them", () => {
  const fromMe = buildInbox([{ participants: [A, ME], fromId: ME, text: "hi", ts: ts(5) }], ME);
  assert.deepEqual(fromMe, { [A]: { text: "hi", ts: ts(5), fromId: ME } });
  const fromThem = buildInbox([{ participants: [A, ME], fromId: A, text: "hey", ts: ts(6) }], ME);
  assert.deepEqual(fromThem, { [A]: { text: "hey", ts: ts(6), fromId: A } });
});

test("buildInbox breaks ties within a second by nanoseconds and treats a pending ts as newest", () => {
  const inbox = buildInbox(
    [
      { participants: [A, ME], fromId: A, text: "first", ts: ts(10, 1) },
      { participants: [A, ME], fromId: A, text: "second", ts: ts(10, 2) },
    ],
    ME
  );
  assert.equal(inbox[A].text, "second");
  const pending = buildInbox(
    [
      { participants: [A, ME], fromId: ME, text: "sending", ts: null },
      { participants: [A, ME], fromId: A, text: "earlier", ts: ts(99) },
    ],
    ME
  );
  assert.equal(pending[A].text, "sending");
});

test("buildInbox ignores messages without a usable participants list", () => {
  const inbox = buildInbox(
    [
      { fromId: A, text: "legacy, no participants", ts: ts(1) },
      { participants: [A], fromId: A, text: "one id", ts: ts(2) },
      { participants: [A, Z], fromId: A, text: "not mine", ts: ts(3) },
      null,
    ],
    ME
  );
  assert.deepEqual(inbox, {});
});

const meeting = { day: "20261124", start: "10:00", dur: 30, loc: "Garden", dayLabel: "Tue" };
const threadId = [A, ME].sort().join("__");
const change = (type, data, id = "msg1") => ({ type, id, threadId, data });

test("applyMeetingChange adds, modifies and removes a meeting", () => {
  let list = [];
  list = applyMeetingChange(list, change("added", { participants: [A, ME], fromId: A, meeting, ts: ts(1) }), ME);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { id: "msg1", threadId, otherId: A, meeting, fromId: A, resp: null, ts: ts(1) });

  list = applyMeetingChange(list, change("modified", { participants: [A, ME], fromId: A, meeting, resp: "accepted", ts: ts(1) }), ME);
  assert.equal(list.length, 1);
  assert.equal(list[0].resp, "accepted");

  list = applyMeetingChange(list, change("removed", { participants: [A, ME], fromId: A, meeting, ts: ts(1) }), ME);
  assert.deepEqual(list, []);
});

test("applyMeetingChange never duplicates when the same change repeats", () => {
  const add = change("added", { participants: [A, ME], fromId: ME, meeting, ts: ts(1) });
  let list = [];
  list = applyMeetingChange(list, add, ME);
  list = applyMeetingChange(list, add, ME);
  list = applyMeetingChange(list, change("modified", add.data), ME);
  assert.equal(list.length, 1);
  assert.equal(list[0].otherId, A);
  const second = applyMeetingChange(list, change("added", add.data, "msg2"), ME);
  assert.equal(second.length, 2);
});

test("applyMeetingChange does not mutate its input and ignores non-meetings", () => {
  const list = [];
  const out = applyMeetingChange(list, change("added", { participants: [A, ME], fromId: A, meeting, ts: ts(1) }), ME);
  assert.deepEqual(list, []);
  assert.equal(out.length, 1);
  assert.deepEqual(applyMeetingChange([], change("added", { participants: [A, ME], fromId: A, text: "hi" }), ME), []);
  assert.deepEqual(applyMeetingChange([], change("added", { fromId: A, meeting }), ME), []);
  assert.deepEqual(applyMeetingChange([], change("removed", {}), ME), []);
});
