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
  pushLogEntry,
  pushStatusOf,
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

const SEC = 1000, MIN = 60 * SEC;

test("shouldSend: first alert from a sender is sent and stamped", () => {
  const r = shouldSend({ muted: false, lastSent: {}, senderId: "u1", nowMs: 1000 });
  assert.deepEqual(r, { send: true, nextLastSent: { u1: [1000] } });
  assert.equal(shouldSend({ senderId: "u1", nowMs: 1 }).send, true, "missing muted and lastSent are fine");
});

test("shouldSend: two messages 5 seconds apart give one alert", () => {
  const t0 = 10 * MIN;
  const first = shouldSend({ lastSent: {}, senderId: "u1", nowMs: t0 });
  const second = shouldSend({ lastSent: first.nextLastSent, senderId: "u1", nowMs: t0 + 5 * SEC });
  assert.equal(first.send, true);
  assert.equal(second.send, false);
  assert.deepEqual(second.nextLastSent, { u1: [t0] });
});

test("shouldSend: messages 11 seconds apart each alert", () => {
  let lastSent = {};
  const t0 = 10 * MIN;
  for (let i = 0; i < 3; i++) {
    const r = shouldSend({ lastSent, senderId: "u1", nowMs: t0 + i * 11 * SEC });
    assert.equal(r.send, true, `message ${i + 1}`);
    lastSent = r.nextLastSent;
  }
  assert.deepEqual(lastSent, { u1: [t0 + 22 * SEC, t0 + 11 * SEC, t0] });
});

test("shouldSend: a burst of 20 gives at most 10 alerts in the window", () => {
  let lastSent = {};
  let sent = 0;
  const t0 = 10 * MIN;
  for (let i = 0; i < 20; i++) {
    const r = shouldSend({ lastSent, senderId: "u1", nowMs: t0 + i * 11 * SEC });
    if (r.send) sent++;
    lastSent = r.nextLastSent;
  }
  assert.equal(sent, 10);
  assert.equal(lastSent.u1.length, 10);
  // Once the oldest alert leaves the 10-minute window, the sender can alert again
  assert.equal(shouldSend({ lastSent, senderId: "u1", nowMs: t0 + 10 * MIN }).send, true);
  // A rapid burst (one per second) gives far fewer: the 10-second gap applies first
  let rapid = {}, rapidSent = 0;
  for (let i = 0; i < 20; i++) {
    const r = shouldSend({ lastSent: rapid, senderId: "u2", nowMs: t0 + i * SEC });
    if (r.send) rapidSent++;
    rapid = r.nextLastSent;
  }
  assert.equal(rapidSent, 2);
});

test("shouldSend: other senders are counted separately", () => {
  const t0 = 10 * MIN;
  const lastSent = { u1: [t0] };
  assert.equal(shouldSend({ lastSent, senderId: "u2", nowMs: t0 + SEC }).send, true);
  assert.equal(shouldSend({ lastSent, senderId: "u1", nowMs: t0 + SEC, minGapMs: 500 }).send, true);
});

test("shouldSend: never when muted", () => {
  const t0 = 10 * MIN;
  const r = shouldSend({ muted: true, lastSent: { u2: [t0 - SEC] }, senderId: "u1", nowMs: t0 });
  assert.deepEqual(r, { send: false, nextLastSent: { u2: [t0 - SEC] } });
  for (let i = 0; i < 5; i++) assert.equal(shouldSend({ muted: true, senderId: "u" + i, nowMs: t0 + i * MIN }).send, false);
});

test("shouldSend prunes old entries", () => {
  const now = 100 * MIN;
  const lastSent = { old: [now - 11 * MIN], mixed: [now - 2 * MIN, now - 20 * MIN], fresh: [now - MIN] };
  const r = shouldSend({ lastSent, senderId: "new", nowMs: now });
  assert.deepEqual(r.nextLastSent, { new: [now], fresh: [now - MIN], mixed: [now - 2 * MIN] });
  assert.equal(Object.prototype.hasOwnProperty.call(r.nextLastSent, "old"), false);
});

test("shouldSend accepts the old format (one number per sender) and converts it", () => {
  const now = 100 * MIN;
  const blocked = shouldSend({ lastSent: { u1: now - 5 * SEC, u2: now - 2 * MIN }, senderId: "u1", nowMs: now });
  assert.equal(blocked.send, false);
  assert.deepEqual(blocked.nextLastSent, { u1: [now - 5 * SEC], u2: [now - 2 * MIN] });
  const ok = shouldSend({ lastSent: { u1: now - MIN, u3: now - 60 * MIN }, senderId: "u1", nowMs: now });
  assert.equal(ok.send, true);
  assert.deepEqual(ok.nextLastSent, { u1: [now, now - MIN] }, "the expired u3 is dropped");
});

test("shouldSend: a future stamp (clock skew) does not block alerts", () => {
  assert.equal(shouldSend({ lastSent: { u1: [9e12] }, senderId: "u1", nowMs: 1000 }).send, true);
  assert.equal(shouldSend({ lastSent: { u1: 9e12 }, senderId: "u1", nowMs: 1000 }).send, true);
});

test("shouldSend keeps the 50 most recently alerted senders", () => {
  const now = 100 * MIN;
  const lastSent = {};
  for (let i = 0; i < 80; i++) lastSent["s" + i] = [now - (80 - i) * SEC];
  const r = shouldSend({ lastSent, senderId: "new", nowMs: now });
  assert.equal(r.send, true);
  const keys = Object.keys(r.nextLastSent);
  assert.equal(keys.length, 50);
  assert.ok(keys.includes("new"));
  assert.ok(keys.includes("s79") && !keys.includes("s30"), "the least recent are dropped");
  assert.equal(Object.keys(shouldSend({ muted: true, lastSent, senderId: "x", nowMs: now }).nextLastSent).length, 50);
});

test("shouldSend refuses hostile input", () => {
  const now = 100 * MIN;
  for (const senderId of ["", "a/b", "a".repeat(65), null, undefined, 42, {}, "<script>"]) {
    assert.equal(shouldSend({ lastSent: {}, senderId, nowMs: now }).send, false, String(senderId));
  }
  assert.equal(shouldSend({ senderId: "u1", nowMs: NaN }).send, false);
  assert.equal(shouldSend({ senderId: "u1", nowMs: "1000" }).send, false);
  assert.equal(shouldSend().send, false);
  const bad = shouldSend({
    lastSent: { u1: "x", "a/b": [now - SEC], ok: [now - 7, "y", null], arr: [[1]], obj: { t: 1 }, n: null },
    senderId: "u9",
    nowMs: now,
  });
  assert.deepEqual(bad.nextLastSent, { u9: [now], ok: [now - 7] });
  assert.deepEqual(shouldSend({ lastSent: [1, 2], senderId: "u9", nowMs: now }).nextLastSent, { u9: [now] });
  assert.deepEqual(shouldSend({ lastSent: "x", senderId: "u9", nowMs: now }).nextLastSent, { u9: [now] });
});

test("shouldSend: a huge stored list is cut to the per-window maximum", () => {
  const now = 100 * MIN;
  const many = Array.from({ length: 5000 }, (_, i) => now - 20 * SEC - i);
  const r = shouldSend({ lastSent: { u1: many }, senderId: "u1", nowMs: now });
  assert.equal(r.send, false, "already 10 alerts inside the window");
  assert.equal(r.nextLastSent.u1.length, 10);
});

test("shouldSend treats __proto__ as a plain key and never pollutes Object", () => {
  const now = 100 * MIN;
  const lastSent = JSON.parse(`{"__proto__": [${now - 5000}], "constructor": [${now - 6000}]}`);
  const r = shouldSend({ lastSent, senderId: "__proto__", nowMs: now });
  assert.equal(r.send, false, "5 seconds is inside the gap");
  const r2 = shouldSend({ lastSent: {}, senderId: "__proto__", nowMs: now });
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
    renotify: "1",
  });
  const m = buildAlert({ kind: "meeting", senderName: "  Kofi\n", senderId: "abc" });
  assert.equal(m.body, "New meeting request from Kofi");
  assert.equal(m.kind, "meeting");
  assert.equal(m.renotify, "1");
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

test("pushLogEntry counts successes, failures and error codes", () => {
  const responses = [
    { success: true, messageId: "projects/x/messages/1" },
    { success: true },
    { success: false, error: { code: "messaging/registration-token-not-registered", message: "Requested entity was not found." } },
    { success: false, error: { code: "messaging/registration-token-not-registered" } },
    { success: false, error: { code: "messaging/internal-error" } },
  ];
  assert.deepEqual(pushLogEntry({ kind: "meeting", tokenCount: 5, responses, pruned: 2, nowMs: 10500, sentAtMs: 10000 }), {
    event: "push",
    kind: "meeting",
    tokens: 5,
    success: 2,
    failure: 3,
    pruned: 2,
    latencyMs: 500,
    errors: { "messaging/registration-token-not-registered": 2, "messaging/internal-error": 1 },
  });
});

test("pushLogEntry leaves out latencyMs when the message has no ts", () => {
  const e = pushLogEntry({ kind: "message", tokenCount: 1, responses: [{ success: true }], pruned: 0, nowMs: 5, sentAtMs: null });
  assert.equal("latencyMs" in e, false);
  assert.deepEqual(Object.keys(e), ["event", "kind", "tokens", "success", "failure", "pruned", "errors"]);
});

test("pushLogEntry never carries ids, tokens, names or text", () => {
  const token = "fAbc:APA91b" + "x".repeat(140);
  const e = pushLogEntry({
    kind: "message",
    tokenCount: 1,
    responses: [{ success: false, error: { code: `messaging/${token} Ama sent "hello"`, message: token } }, { success: false, error: { code: "__proto__" } }],
    pruned: 0,
    nowMs: 1,
    sentAtMs: 2,
  });
  const json = JSON.stringify(e);
  assert.ok(!json.includes("APA91b") && !json.includes("Ama") && !json.includes("hello"), json);
  assert.equal(e.errors.unknown, 1, "a code that is not a plain code is counted as unknown");
  assert.equal(e.latencyMs, 0, "a ts in the future gives 0, never a negative latency");
  assert.equal(Object.getPrototypeOf(e.errors), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test("pushLogEntry handles missing or hostile input", () => {
  assert.deepEqual(pushLogEntry(), { event: "push", kind: "message", tokens: 0, success: 0, failure: 0, pruned: 0, errors: {} });
  const e = pushLogEntry({ kind: "<b>", tokenCount: -1, responses: [null, "x", {}], pruned: 1.5 });
  assert.equal(e.kind, "message");
  assert.equal(e.tokens, 0);
  assert.equal(e.pruned, 0);
  assert.equal(e.failure, 3);
  assert.deepEqual(e.errors, { unknown: 3 });
});

test("pushStatusOf reports count, muted, platform and age, never a token", () => {
  const H = 3600000;
  const now = 100 * H;
  const s = pushStatusOf({ tokens: [{ t: A, at: now - 3 * H }, { t: B, at: now - 30 * H }], muted: true, platform: "android", lastSent: { u1: [1] } }, now);
  assert.deepEqual(s, { tokens: 2, muted: true, platform: "android", ageHours: 3 });
  assert.ok(!JSON.stringify(s).includes("APA91b"));
  assert.equal(pushStatusOf({ tokens: [{ t: A, at: now - 90 * 60000 }] }, now).ageHours, 1.5);
});

test("pushStatusOf for a missing document", () => {
  for (const d of [null, undefined, {}, "x", 42]) {
    assert.deepEqual(pushStatusOf(d, 1000), { tokens: 0, muted: false, platform: null, ageHours: null }, String(d));
  }
});

test("pushStatusOf ignores malformed stored values", () => {
  const now = 100 * 3600000;
  const s = pushStatusOf({ tokens: [null, { t: "short" }, { t: A }, "x"], muted: "yes", platform: "<b>windows</b>" }, now);
  assert.deepEqual(s, { tokens: 1, muted: false, platform: null, ageHours: null }, "a token without a time has no age");
  const many = [A, B, C, D, E, F].map((t, i) => ({ t, at: now - i }));
  assert.equal(pushStatusOf({ tokens: many }, now).tokens, 5, "at most 5");
  assert.equal(pushStatusOf({ tokens: [{ t: A, at: now + 5000 }] }, now).ageHours, 0, "a future time counts as just now");
  assert.equal(pushStatusOf({ tokens: [{ t: A, at: now }] }, NaN).ageHours, null);
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
