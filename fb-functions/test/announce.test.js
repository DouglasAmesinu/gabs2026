"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanText, validateAnnouncement, validateAnnouncementId } = require("../lib/announce");

const HTML = '<img src=x onerror="alert(1)">';
const ok = (over = {}) => validateAnnouncement({ title: "Lunch moved", body: "Lunch is now at 13:00.", ...over });

test("cleanText accepts strings only", () => {
  for (const v of [undefined, null, 0, 42, NaN, true, {}, [], ["a"], () => "x"]) {
    assert.equal(cleanText(v, 60), "", String(v));
  }
});

test("cleanText strips control characters but keeps newlines", () => {
  assert.equal(cleanText("a\u0000b\u0007c\u001Bd\u007Fe\u0085f", 60), "abcdef");
  assert.equal(cleanText("line one\nline two", 60), "line one\nline two");
  assert.equal(cleanText("windows\r\nline\rold mac", 60), "windows\nline\nold mac");
  assert.equal(cleanText("tab\there", 60), "tab here");
});

test("cleanText collapses spaces, blank lines and trims", () => {
  assert.equal(cleanText("   hello     world   ", 60), "hello world");
  assert.equal(cleanText("a   \n   b", 60), "a\nb");
  assert.equal(cleanText("a\n\n\n\n\nb", 60), "a\n\nb");
  assert.equal(cleanText("\n\n  \n", 60), "");
});

test("cleanText clips by code points and never splits an emoji", () => {
  assert.equal(cleanText("abcdef", 3), "abc");
  assert.equal(cleanText("📢📢📢", 2), "📢📢");
  assert.equal(cleanText("abc def", 4), "abc", "a trailing space left by the clip is trimmed");
  assert.equal(cleanText("abc", 0), "");
  assert.equal(cleanText("abc", Infinity), "abc");
});

test("cleanText does not escape HTML (the page renders with esc())", () => {
  assert.equal(cleanText(HTML, 100), HTML);
});

test("validateAnnouncement returns a clean object with defaults", () => {
  assert.deepEqual(ok(), { title: "Lunch moved", body: "Lunch is now at 13:00.", pinned: false, expiresInMinutes: 0, alert: false });
  assert.deepEqual(validateAnnouncement({ title: "  Hi  " }), { title: "Hi", body: "", pinned: false, expiresInMinutes: 0, alert: false });
  assert.deepEqual(validateAnnouncement({ title: "Hi", body: null, pinned: null, expiresInMinutes: null }),
    { title: "Hi", body: "", pinned: false, expiresInMinutes: 0, alert: false });
  assert.deepEqual(ok({ pinned: true, expiresInMinutes: 60 }).pinned, true);
  assert.equal(ok({ expiresInMinutes: 1440 }).expiresInMinutes, 1440);
  assert.equal(ok({ expiresInMinutes: 0 }).expiresInMinutes, 0);
});

test("validateAnnouncement: alert is true only for the boolean true, never a refusal", () => {
  assert.equal(ok({ alert: true }).alert, true);
  assert.equal(ok({ alert: false }).alert, false);
  for (const alert of [undefined, null, "true", 1, "yes", {}, [true]]) {
    const r = ok({ alert });
    assert.notEqual(r, null, JSON.stringify(alert));
    assert.equal(r.alert, false, JSON.stringify(alert));
  }
});

test("validateAnnouncement puts the title on one line and keeps body line breaks", () => {
  assert.equal(ok({ title: "Room\nchange" }).title, "Room change");
  assert.equal(ok({ body: "Hall A\nHall B" }).body, "Hall A\nHall B");
});

test("validateAnnouncement enforces the title length (1-60)", () => {
  assert.equal(ok({ title: "" }), null);
  assert.equal(ok({ title: "   \n\t " }), null);
  assert.equal(ok({ title: "\u0000\u0001" }), null);
  assert.equal(ok({ title: "a".repeat(60) }).title.length, 60);
  assert.equal(ok({ title: "a".repeat(61) }), null);
  assert.equal(ok({ title: "📢".repeat(60) }).title, "📢".repeat(60), "counted in characters, not UTF-16 units");
  assert.equal(ok({ title: "a".repeat(1_000_000) }), null);
});

test("validateAnnouncement enforces the body length (0-300)", () => {
  assert.equal(ok({ body: "" }).body, "");
  assert.equal(ok({ body: "b".repeat(300) }).body.length, 300);
  assert.equal(ok({ body: "b".repeat(301) }), null);
  assert.equal(ok({ body: "b".repeat(1_000_000) }), null);
});

test("validateAnnouncement keeps HTML as plain text", () => {
  assert.equal(ok({ title: "<b>x</b>" }).title, "<b>x</b>");
  assert.equal(ok({ body: HTML }).body, HTML);
});

test("validateAnnouncement refuses wrong types", () => {
  for (const data of [undefined, null, "x", 42, [], [{ title: "Hi" }]]) {
    assert.equal(validateAnnouncement(data), null, JSON.stringify(data));
  }
  for (const title of [undefined, null, 42, true, {}, ["Hi"]]) assert.equal(ok({ title }), null, `title ${String(title)}`);
  for (const body of [42, true, {}, ["x"]]) assert.equal(ok({ body }), null, `body ${String(body)}`);
  for (const pinned of ["true", 1, 0, "yes", {}]) assert.equal(ok({ pinned }), null, `pinned ${String(pinned)}`);
});

test("validateAnnouncement refuses a bad expiry", () => {
  for (const e of [-1, 1441, 1.5, NaN, Infinity, "60", true, {}, 1e9]) {
    assert.equal(ok({ expiresInMinutes: e }), null, `expires ${String(e)}`);
  }
});

test("validateAnnouncementId accepts 1-40 letters or digits only", () => {
  assert.equal(validateAnnouncementId({ id: "aB3xYz09" }), "aB3xYz09");
  assert.equal(validateAnnouncementId({ id: "a".repeat(40) }), "a".repeat(40));
  for (const id of ["", "a".repeat(41), "a/b", "../x", "a b", "a-b", "a_b", "é", 42, null, undefined, ["a"]]) {
    assert.equal(validateAnnouncementId({ id }), null, String(id));
  }
  for (const data of [undefined, null, "abc"]) assert.equal(validateAnnouncementId(data), null);
});
