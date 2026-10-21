"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validToken,
  addToken,
  removeToken,
  shouldSend,
  cleanName,
  buildAlert,
  recipientOf,
  deadTokens,
  callWindow,
} = require("../lib/push");

// Realistic-looking FCM tokens: "<22 chars>:APA91b<rest>", ~150 characters
const tok = (c) => `f${c}Xyz0-_abcdEFGH1234567:APA91b` + c.repeat(120);
const A = tok("a"), B = tok("b"), C = tok("c"), D = tok("d"), E = tok("e"), F = tok("f");

test("validToken accepts 100-400 characters of the allowed set", () => {
  assert.equal(validToken(A), true);
  assert.equal(validToken("a".repeat(100)), true);
  assert.equal(validToken("a".repeat(400)), true);
  assert.equal(validToken("a:b-c_d".padEnd(150, "x")), true);
});

test("validToken refuses short, long, odd characters and non-strings", () => {
  for (const t of [
    "a".repeat(99),
    "a".repeat(401),
    "a".repeat(10000),
    "",
    A.slice(0, 50) + " " + A.slice(51),
    A.slice(0, 50) + "/" + A.slice(51),
    A.slice(0, 50) + "<" + A.slice(51),
    A.slice(0, 50) + "\n" + A.slice(51),
    A.slice(0, 50) + "é" + A.slice(51),
    "a".repeat(150) + "\u0000",
  ]) {
    assert.equal(validToken(t), false, `${t.length} chars`);
  }
  for (const t of [undefined, null, 123, true, {}, [A], { t: A }]) assert.equal(validToken(t), false, String(t));
});

test("addToken puts the token first, stamps it and keeps no duplicates", () => {
  const list = addToken([{ t: A, at: 1 }, { t: B, at: 2 }], B, 100);
  assert.deepEqual(list, [{ t: B, at: 100 }, { t: A, at: 1 }]);
  assert.deepEqual(addToken([], A, 5), [{ t: A, at: 5 }]);
  assert.deepEqual(addToken(undefined, A, 5), [{ t: A, at: 5 }]);
});

test("addToken caps the list, dropping the oldest at the end", () => {
  let list = [];
  [A, B, C, D, E, F].forEach((t, i) => { list = addToken(list, t, i); });
  assert.deepEqual(list.map((e) => e.t), [F, E, D, C, B]);
  assert.equal(addToken(list, A, 9, 2).length, 2);
  assert.equal(addToken(list, A, 9, 0).length, 5, "a bad max falls back to 5");
  assert.equal(addToken(list, A, 9, -1).length, 5);
});

test("addToken does not mutate its input and refuses an invalid token", () => {
  const list = [{ t: A, at: 1 }];
  const copy = JSON.parse(JSON.stringify(list));
  addToken(list, B, 2);
  assert.deepEqual(list, copy);
  assert.deepEqual(addToken(list, "short", 2), [{ t: A, at: 1 }]);
  assert.deepEqual(addToken(list, null, 2), [{ t: A, at: 1 }]);
});

test("addToken and removeToken drop malformed stored entries", () => {
  const stored = [null, "x", 42, { t: "bad" }, { t: A, at: "soon" }, { t: B, at: 3 }, [C], { x: D }];
  assert.deepEqual(addToken(stored, C, 9), [{ t: C, at: 9 }, { t: A, at: 0 }, { t: B, at: 3 }]);
  assert.deepEqual(removeToken(stored, A), [{ t: B, at: 3 }]);
  assert.deepEqual(addToken("not a list", A, 1), [{ t: A, at: 1 }]);
  assert.deepEqual(addToken({ 0: { t: B } }, A, 1), [{ t: A, at: 1 }]);
});

test("removeToken removes only that token", () => {
  const list = [{ t: A, at: 1 }, { t: B, at: 2 }];
  assert.deepEqual(removeToken(list, A), [{ t: B, at: 2 }]);
  assert.deepEqual(removeToken(list, C), list);
  assert.deepEqual(removeToken(list, undefined), list);
  assert.deepEqual(removeToken(null, A), []);
});

test("shouldSend: first alert from a sender is sent and stamped", () => {
  const r = shouldSend({ muted: false, lastSent: {}, senderId: "u1", nowMs: 1000 });
  assert.deepEqual(r, { send: true, nextLastSent: { u1: 1000 } });
  assert.equal(shouldSend({ senderId: "u1", nowMs: 1 }).send, true, "missing muted and lastSent are fine");
});

test("shouldSend: never when muted", () => {
  const r = shouldSend({ muted: true, lastSent: { u2: 5 }, senderId: "u1", nowMs: 1e9 });
  assert.deepEqual(r, { send: false, nextLastSent: { u2: 5 } });
});

test("shouldSend: same sender inside the gap is suppressed, other senders are not", () => {
  const lastSent = { u1: 100000 };
  assert.equal(shouldSend({ lastSent, senderId: "u1", nowMs: 100000 + 59999 }).send, false);
  assert.deepEqual(shouldSend({ lastSent, senderId: "u1", nowMs: 100000 + 59999 }).nextLastSent, { u1: 100000 });
  assert.deepEqual(shouldSend({ lastSent, senderId: "u1", nowMs: 160000 }), { send: true, nextLastSent: { u1: 160000 } });
  assert.equal(shouldSend({ lastSent, senderId: "u2", nowMs: 100001 }).send, true);
  assert.equal(shouldSend({ lastSent, senderId: "u1", nowMs: 100500, minGapMs: 100 }).send, true);
});

test("shouldSend: a future stamp (clock skew) does not block alerts", () => {
  assert.equal(shouldSend({ lastSent: { u1: 9e12 }, senderId: "u1", nowMs: 1000 }).send, true);
});

test("shouldSend keeps the 50 newest senders", () => {
  const lastSent = {};
  for (let i = 0; i < 80; i++) lastSent["s" + i] = i;
  const r = shouldSend({ lastSent, senderId: "new", nowMs: 1000 });
  assert.equal(r.send, true);
  const keys = Object.keys(r.nextLastSent);
  assert.equal(keys.length, 50);
  assert.ok(keys.includes("new"));
  assert.ok(keys.includes("s79") && !keys.includes("s30"), "the oldest are dropped");
  assert.equal(Object.keys(shouldSend({ muted: true, lastSent, senderId: "x", nowMs: 1 }).nextLastSent).length, 50);
});

test("shouldSend refuses hostile input", () => {
  for (const senderId of ["", "a/b", "a".repeat(65), null, undefined, 42, {}, "<script>"]) {
    assert.equal(shouldSend({ lastSent: {}, senderId, nowMs: 1 }).send, false, String(senderId));
  }
  assert.equal(shouldSend({ senderId: "u1", nowMs: NaN }).send, false);
  assert.equal(shouldSend({ senderId: "u1", nowMs: "1000" }).send, false);
  assert.equal(shouldSend().send, false);
  const bad = shouldSend({ lastSent: { u1: "x", "a/b": 5, ok: 7, arr: [1] }, senderId: "u9", nowMs: 10 });
  assert.deepEqual(bad.nextLastSent, { u9: 10, ok: 7 });
  assert.deepEqual(shouldSend({ lastSent: [1, 2], senderId: "u9", nowMs: 10 }).nextLastSent, { u9: 10 });
});

test("shouldSend treats __proto__ as a plain key and never pollutes Object", () => {
  const lastSent = JSON.parse('{"__proto__": 5, "constructor": 6}');
  const r = shouldSend({ lastSent, senderId: "__proto__", nowMs: 10 });
  assert.equal(r.send, false, "5 is less than a minute before 10");
  const r2 = shouldSend({ lastSent: {}, senderId: "__proto__", nowMs: 100000 });
  assert.equal(r2.send, true);
  assert.equal(Object.getPrototypeOf(r2.nextLastSent), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(r2.nextLastSent, "__proto__"), true);
  assert.equal({}.polluted, undefined);
});

test("cleanName collapses whitespace, strips control characters and clips", () => {
  assert.equal(cleanName("  Ama   Mensah  "), "Ama Mensah");
  assert.equal(cleanName("Ama\nMensah\t\u0000Jr"), "Ama Mensah Jr");
  assert.equal(cleanName("a".repeat(41)), "a".repeat(40));
  assert.equal(cleanName("😀".repeat(50)), "😀".repeat(40), "never splits an emoji");
  assert.equal(cleanName("a".repeat(39) + " b"), "a".repeat(39), "a trailing space left by the clip is trimmed");
  assert.equal(cleanName("<b>Bob</b>"), "<b>Bob</b>", "plain text: the alert is not HTML");
});

test("cleanName falls back to 'a participant'", () => {
  for (const v of ["", "   ", "\u0000\u0007", "\n\t", undefined, null, 42, {}, ["Bob"], true]) {
    assert.equal(cleanName(v), "a participant", JSON.stringify(v));
  }
});

test("buildAlert builds message and meeting alerts", () => {
  assert.deepEqual(buildAlert({ kind: "message", senderName: "Ama", senderId: "u_1-x" }), {
    title: "GABS Connect",
    body: "New message from Ama",
    tag: "msg-u_1-x",
    url: "/#chat=u_1-x",
    kind: "message",
  });
  const m = buildAlert({ kind: "meeting", senderName: "  Kofi\n", senderId: "abc" });
  assert.equal(m.body, "New meeting request from Kofi");
  assert.equal(m.kind, "meeting");
  assert.equal(buildAlert({ kind: "other", senderName: "", senderId: "abc" }).body, "New message from a participant");
  assert.equal(buildAlert({ kind: "other", senderId: "abc" }).kind, "message");
});

test("buildAlert: every value is a string and the name is clipped", () => {
  const a = buildAlert({ kind: "meeting", senderName: "x".repeat(500), senderId: "abc" });
  for (const v of Object.values(a)) assert.equal(typeof v, "string");
  assert.equal(a.body, "New meeting request from " + "x".repeat(40));
});

test("buildAlert returns null for a bad senderId", () => {
  for (const senderId of ["", "a/b", "../x", "a b", "a".repeat(65), "<script>", "a#b", undefined, null, 42, {}, ["abc"]]) {
    assert.equal(buildAlert({ kind: "message", senderName: "Ama", senderId }), null, String(senderId));
  }
  assert.equal(buildAlert(), null);
});

test("recipientOf returns the other participant", () => {
  assert.equal(recipientOf("alice__bob", "alice"), "bob");
  assert.equal(recipientOf("alice__bob", "bob"), "alice");
  assert.equal(recipientOf("csv_0__csv_1", "csv_0"), "csv_1", "single underscores inside ids are kept");
});

test("recipientOf returns null for hostile or unrelated input", () => {
  for (const [tid, from] of [
    ["alice__bob", "carol"],
    ["alice__alice", "alice"],
    ["alice", "alice"],
    ["alice__bob__carol", "alice"],
    ["__bob", "bob"],
    ["alice__", "alice"],
    ["", ""],
    ["alice__b<script>", "alice"],
    ["alice__" + "b".repeat(65), "alice"],
    [null, "alice"],
    ["alice__bob", null],
    [42, "alice"],
    [["alice", "bob"], "alice"],
  ]) {
    assert.equal(recipientOf(tid, from), null, `${String(tid)} / ${String(from)}`);
  }
});

test("deadTokens picks only permanently dead tokens", () => {
  const responses = [
    { success: true },
    { success: false, error: { code: "messaging/registration-token-not-registered" } },
    { success: false, error: { code: "messaging/invalid-registration-token" } },
    { success: false, error: { code: "messaging/internal-error" } },
    { success: false },
    null,
  ];
  assert.deepEqual(deadTokens([A, B, C, D, E, F], responses), [B, C]);
  assert.deepEqual(deadTokens(null, responses), []);
  assert.deepEqual(deadTokens([A], "x"), []);
});

test("callWindow allows `limit` calls per window, then refuses until it resets", () => {
  const H = 3600000;
  let st = null;
  for (let i = 0; i < 3; i++) {
    const d = callWindow(st, 1000 + i, 3);
    assert.equal(d.allowed, true);
    st = d.next;
  }
  assert.deepEqual(st, { count: 3, windowStart: 1000 });
  assert.equal(callWindow(st, 1000 + H - 1, 3).allowed, false);
  assert.deepEqual(callWindow(st, 1000 + H, 3), { allowed: true, next: { count: 1, windowStart: 1000 + H } });
});

test("callWindow starts afresh on malformed or future state", () => {
  for (const st of [undefined, null, {}, { count: "9", windowStart: 1 }, { count: 9 }, { count: 99, windowStart: 9e12 }]) {
    assert.deepEqual(callWindow(st, 5000, 10), { allowed: true, next: { count: 1, windowStart: 5000 } }, JSON.stringify(st));
  }
});
