"use strict";

// Tests the pure text-safety helpers that live inside index.html between the
// "// BEGIN safe-helpers" and "// END safe-helpers" marker comments.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function loadHelpers() {
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  const start = html.indexOf("// BEGIN safe-helpers");
  const end = html.indexOf("// END safe-helpers");
  assert.ok(start > -1 && end > start, "safe-helpers markers not found in index.html");
  const block = html.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${block}\nreturn { esc, safeId, safeUrl, safePhoto, clip, parseTicketHash, parseChatHash, clampBadge, isAnnouncementsHash, soundFor, mailtoLink };`)();
}

const { esc, safeId, safeUrl, safePhoto, clip, parseTicketHash, parseChatHash, clampBadge, isAnnouncementsHash, soundFor, mailtoLink } = loadHelpers();

const IMG_ONERROR = '"><img src=x onerror=alert(1)>';
const SQ_HANDLER = "' onmouseover='alert(1)";
const SCRIPT_BREAK = "</script><script>alert(1)</script>";
const PHOTO = "https://firebasestorage.googleapis.com/v0/b/gabs2026-4f482.firebasestorage.app/o/photos%2Fabc?alt=media&token=t1&v=1";

test("esc neutralises every HTML-significant character", () => {
  assert.equal(esc(IMG_ONERROR), "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(esc(SQ_HANDLER), "&#39; onmouseover=&#39;alert(1)");
  assert.equal(esc(SCRIPT_BREAK), "&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(esc("a`b"), "a&#96;b");
  assert.equal(esc("Tom & Jerry"), "Tom &amp; Jerry");
  assert.equal(esc("&amp;"), "&amp;amp;", "already-escaped text is escaped again, not passed through");
  for (const out of [esc(IMG_ONERROR), esc(SQ_HANDLER), esc(SCRIPT_BREAK)]) {
    assert.doesNotMatch(out, /[<>"'`]/);
  }
});

test("esc handles null, undefined, non-strings and unicode", () => {
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(0), "0");
  assert.equal(esc(false), "false");
  assert.equal(esc("Kwame Nkrumah – Müller 🇬🇭 漢字"), "Kwame Nkrumah – Müller 🇬🇭 漢字");
  assert.equal(esc("x".repeat(100000)).length, 100000);
});

test("safeId accepts plain ids and rejects everything else", () => {
  assert.equal(safeId("AbC123_-xyz"), "AbC123_-xyz");
  assert.equal(safeId("csv_0"), "csv_0");
  assert.equal(safeId("a".repeat(64)), "a".repeat(64));
  assert.equal(safeId("a".repeat(65)), "");
  for (const bad of [IMG_ONERROR, SQ_HANDLER, SCRIPT_BREAK, "javascript:alert(1)", "", " abc", "abc ", "a.b", "a/b", "ü", "🇬🇭", null, undefined, 123, {}]) {
    assert.equal(safeId(bad), "", `rejects ${String(bad)}`);
  }
});

test("safeUrl allows http(s) and returns the normalised URL", () => {
  assert.equal(safeUrl("https://example.com"), "https://example.com/");
  assert.equal(safeUrl("HTTP://Example.COM/a b"), "http://example.com/a%20b");
  assert.equal(safeUrl("https://example.com/?q=1#x"), "https://example.com/?q=1#x");
  assert.equal(safeUrl("http://example.com", { protocols: ["https:"] }), "");
  assert.equal(safeUrl("https://example.com", { protocols: ["https:"] }), "https://example.com/");
});

test("safeUrl rejects script and data URLs in any spelling", () => {
  for (const bad of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "\tjavascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html,<script>",
    "DATA:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ]) {
    assert.equal(safeUrl(bad), "", `rejects ${JSON.stringify(bad)}`);
  }
  assert.equal(safeUrl("data:text/html,<script>", { protocols: ["https:", "http:"] }), "");
});

test("safeUrl trims a leading space or tab before parsing", () => {
  assert.equal(safeUrl(" https://example.com"), "https://example.com/");
  assert.equal(safeUrl("\thttps://example.com"), "https://example.com/");
  assert.equal(safeUrl("\n https://example.com/x \t"), "https://example.com/x");
});

test("safeUrl rejects relative URLs, credentials, junk, very long input and null", () => {
  for (const bad of ["", "   ", "example.com", "/path", "//example.com", "https://", "https://user:pw@example.com", "https://linkedin.com@evil.example", IMG_ONERROR, SQ_HANDLER, SCRIPT_BREAK, null, undefined]) {
    assert.equal(safeUrl(bad), "", `rejects ${String(bad)}`);
  }
  assert.equal(safeUrl("https://example.com/" + "a".repeat(5000)), "");
  assert.equal(safeUrl("https://example.com/" + "a".repeat(1000)), "https://example.com/" + "a".repeat(1000));
});

test("safeUrl keeps unicode hosts and paths, encoded", () => {
  assert.equal(safeUrl("https://bücher.example/straße"), "https://xn--bcher-kva.example/stra%C3%9Fe");
  const quoted = safeUrl('https://example.com/"><img src=x>');
  assert.ok(quoted.startsWith("https://example.com/"));
  assert.doesNotMatch(quoted, /[<>"]/);
});

test("safePhoto allows only https Firebase Storage photos", () => {
  assert.equal(safePhoto(PHOTO), PHOTO);
  assert.equal(safePhoto("https://gabs2026-4f482.firebasestorage.app/o/x.jpg"), "https://gabs2026-4f482.firebasestorage.app/o/x.jpg");
  assert.equal(safePhoto(" " + PHOTO), PHOTO);
  for (const bad of [
    PHOTO.replace("https:", "http:"),
    "https://evil.example/x.jpg",
    "https://firebasestorage.googleapis.com.evil.example/x.jpg",
    "https://evilfirebasestorage.app/x.jpg",
    "https://firebasestorage.app/x.jpg",
    "https://firebasestorage.googleapis.com:8443/x.jpg",
    "https://user@firebasestorage.googleapis.com/x.jpg",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>",
    "data:image/png;base64,AAAA",
    IMG_ONERROR,
    "",
    null,
    undefined,
  ]) {
    assert.equal(safePhoto(bad), "", `rejects ${String(bad)}`);
  }
});

test("clip cuts by code points and never splits an emoji", () => {
  assert.equal(clip("hello", 3), "hel");
  assert.equal(clip("hello", 10), "hello");
  assert.equal(clip("hello", 0), "");
  assert.equal(clip("😀😀😀", 2), "😀😀");
  const flag = clip("ab🇬🇭", 3); // a flag is two code points: only whole code points are kept
  assert.equal(Array.from(flag).length, 3);
  assert.ok(flag.isWellFormed(), "no lone surrogate");
  assert.ok(clip("😀😀😀", 1).isWellFormed());
  assert.equal(clip("Müller", 2), "Mü");
  assert.equal(clip("x".repeat(100000), 200), "x".repeat(200));
});

test("clip handles null, undefined, non-strings and odd limits", () => {
  assert.equal(clip(null, 5), "");
  assert.equal(clip(undefined, 5), "");
  assert.equal(clip(12345, 3), "123");
  assert.equal(clip("abc", -1), "");
  assert.equal(clip("abcdef", 2.7), "ab");
  assert.equal(clip("abc", undefined), "abc", "no limit given keeps the whole string");
  assert.equal(clip(SCRIPT_BREAK, 9), "</script>", "clip does not escape; esc still has to run");
});

test("parseTicketHash returns a valid reference from a sign-in link, uppercased", () => {
  assert.equal(parseTicketHash("#t=GABS2026-T-ABC123"), "GABS2026-T-ABC123");
  assert.equal(parseTicketHash("#t=GABS-2026-TEST-001"), "GABS-2026-TEST-001");
  assert.equal(parseTicketHash("#t=gabs2026-t-abc123"), "GABS2026-T-ABC123", "lowercase is uppercased");
  assert.equal(parseTicketHash("#T=Gabs2026-t-Abc123"), "GABS2026-T-ABC123", "the match is case-insensitive");
});

test("parseTicketHash returns an empty string for anything that is not a sign-in link", () => {
  for (const h of [
    "#admin",
    "#t=",
    "#t=<script>",
    "#t=GABS<script>alert(1)</script>",
    "#t=GABS2026-T-<img src=x onerror=alert(1)>",
    "#t=GABS2026 T ABC123",
    "#t= GABS2026-T-ABC123",
    "#t=GABS2026-T-ABC123 ",
    "#t=GABS2026-T-ABC123%20",
    "#t=GABS12",               // too short: fewer than 6 characters after GABS
    "#t=XYZ2026-T-ABC123",     // not a GABS reference
    "t=GABS2026-T-ABC123",     // no leading #
    "#x=GABS2026-T-ABC123",
    "#t=GABS2026-T-ABC123&t=GABS2026-T-OTHER1",
    "",
  ]) {
    assert.equal(parseTicketHash(h), "", JSON.stringify(h));
  }
});

test("parseTicketHash refuses a very long value", () => {
  assert.equal(parseTicketHash("#t=GABS" + "A".repeat(60)), "GABS" + "A".repeat(60), "60 characters after GABS is the limit");
  assert.equal(parseTicketHash("#t=GABS" + "A".repeat(61)), "");
  assert.equal(parseTicketHash("#t=GABS" + "A".repeat(10000)), "");
});

test("parseTicketHash handles a missing hash and non-strings", () => {
  for (const h of [undefined, null, 0, 123, {}, [], ["#t=GABS2026-T-ABC123"]]) {
    assert.equal(parseTicketHash(h), "", String(h));
  }
});

test("parseChatHash returns the participant id from an alert link", () => {
  assert.equal(parseChatHash("#chat=abc123"), "abc123");
  assert.equal(parseChatHash("#chat=csv_0"), "csv_0");
  assert.equal(parseChatHash("#chat=Ab-9_x"), "Ab-9_x", "case is kept: ids are case-sensitive");
  assert.equal(parseChatHash("#chat=" + "a".repeat(64)), "a".repeat(64));
});

test("parseChatHash returns an empty string for anything else", () => {
  for (const h of [
    "#admin",
    "#t=GABS2026-T-ABC123",
    "#chat=",
    "#chat=<script>",
    "#chat=abc<script>alert(1)</script>",
    "#chat=a/b",
    "#chat=../x",
    "#chat=a b",
    "#chat=abc%20",
    "#chat=abc&x=1",
    "#CHAT=abc",
    "chat=abc",
    "#chat=" + "a".repeat(65),
    "#chat=" + "a".repeat(10000),
    "",
  ]) {
    assert.equal(parseChatHash(h), "", JSON.stringify(h.slice(0, 80)));
  }
});

test("clampBadge keeps whole numbers from 0 to 99", () => {
  assert.equal(clampBadge(0), 0);
  assert.equal(clampBadge(5), 5);
  assert.equal(clampBadge(99), 99);
});

test("clampBadge caps large counts at 99 and turns everything else into 0", () => {
  assert.equal(clampBadge(150), 99, "more than 99 unread still shows a badge");
  assert.equal(clampBadge(-3), 0);
  assert.equal(clampBadge("7"), 0, "strings are not counts");
  assert.equal(clampBadge(NaN), 0);
  assert.equal(clampBadge(null), 0);
  assert.equal(clampBadge(undefined), 0);
  assert.equal(clampBadge(2.9), 0, "fractions are not counts");
  assert.equal(clampBadge(Infinity), 0);
  assert.equal(clampBadge({}), 0);
});

test("parseChatHash handles a missing hash and non-strings", () => {
  for (const h of [undefined, null, 0, 123, {}, [], ["#chat=abc"]]) {
    assert.equal(parseChatHash(h), "", String(h));
  }
});

test("isAnnouncementsHash is true only for exactly #announcements", () => {
  assert.equal(isAnnouncementsHash("#announcements"), true);
  assert.equal(isAnnouncementsHash("#announcements2"), false);
  assert.equal(isAnnouncementsHash("#admin"), false);
  assert.equal(isAnnouncementsHash("#chat=abc"), false);
  assert.equal(isAnnouncementsHash(""), false);
  assert.equal(isAnnouncementsHash(undefined), false);
});

// A message that should sound: everything set, from someone else, long after the last sound
const SOUND = { soundOn: true, visible: true, isFirstSnapshot: false, fromId: "u2", myId: "u1", chatOpenWithSender: false, nowMs: 100000, lastPlayedMs: 0, minGapMs: 2000 };

test("soundFor: ding outside the chat, tick in the open chat with the sender", () => {
  assert.equal(soundFor(SOUND), "ding");
  assert.equal(soundFor({ ...SOUND, chatOpenWithSender: true }), "tick");
  assert.equal(soundFor({ ...SOUND, chatOpenWithSender: "yes" }), "ding", "only true means the chat is open");
  assert.equal(soundFor({ ...SOUND, chatOpenWithSender: undefined }), "ding");
});

test("soundFor: silent when sound is off or missing", () => {
  assert.equal(soundFor({ ...SOUND, soundOn: false }), null);
  assert.equal(soundFor({ ...SOUND, soundOn: undefined }), null);
  assert.equal(soundFor({ ...SOUND, soundOn: "1" }), null);
});

test("soundFor: silent when the page is not visible or visibility is unknown", () => {
  assert.equal(soundFor({ ...SOUND, visible: false }), null);
  assert.equal(soundFor({ ...SOUND, visible: undefined }), null);
});

test("soundFor: silent for a first snapshot (history) or when that is unknown", () => {
  assert.equal(soundFor({ ...SOUND, isFirstSnapshot: true }), null);
  assert.equal(soundFor({ ...SOUND, isFirstSnapshot: undefined }), null);
});

test("soundFor: silent for my own message", () => {
  assert.equal(soundFor({ ...SOUND, fromId: "u1" }), null);
  assert.equal(soundFor({ ...SOUND, fromId: "u1", chatOpenWithSender: true }), null);
});

test("soundFor: an announcement (no fromId) still sounds; missing myId is not 'own'", () => {
  assert.equal(soundFor({ ...SOUND, fromId: undefined }), "ding");
  assert.equal(soundFor({ ...SOUND, fromId: undefined, myId: undefined }), "ding");
  assert.equal(soundFor({ ...SOUND, fromId: "", myId: "" }), "ding");
  assert.equal(soundFor({ ...SOUND, myId: undefined }), "ding");
});

test("soundFor: at most one sound per minGapMs", () => {
  assert.equal(soundFor({ ...SOUND, lastPlayedMs: 98001 }), null, "1999 ms after the last sound");
  assert.equal(soundFor({ ...SOUND, lastPlayedMs: 98000 }), "ding", "exactly 2000 ms");
  assert.equal(soundFor({ ...SOUND, lastPlayedMs: 99000, minGapMs: 500 }), "ding");
  assert.equal(soundFor({ ...SOUND, lastPlayedMs: 98001, minGapMs: undefined }), null, "default gap is 2000");
});

test("soundFor: a missing last sound means none yet; a missing clock means silence", () => {
  assert.equal(soundFor({ ...SOUND, lastPlayedMs: undefined }), "ding");
  assert.equal(soundFor({ ...SOUND, lastPlayedMs: null }), "ding");
  assert.equal(soundFor({ ...SOUND, nowMs: undefined }), null);
  assert.equal(soundFor({ ...SOUND, nowMs: NaN }), null);
});

test("soundFor: no argument or an empty object is silent", () => {
  assert.equal(soundFor(), null);
  assert.equal(soundFor({}), null);
});

const TO = "help" + "@" + "example.org";

test("mailtoLink: only the address when nothing else is given", () => {
  assert.equal(mailtoLink({ to: TO }), "mailto:help@example.org");
  assert.equal(mailtoLink({ to: TO, cc: "", subject: "", body: "" }), "mailto:help@example.org");
});

test("mailtoLink: present parameters in order cc, subject, body, each encoded", () => {
  assert.equal(mailtoLink({ to: TO, subject: "GABS Connect support" }), "mailto:help@example.org?subject=GABS%20Connect%20support");
  assert.equal(
    mailtoLink({ to: TO, cc: "b" + "@" + "example.org", subject: "A & B?", body: "Line 1\n\nName: Ama & Kofi" }),
    "mailto:help@example.org?cc=b%40example.org&subject=A%20%26%20B%3F&body=Line%201%0A%0AName%3A%20Ama%20%26%20Kofi"
  );
  assert.equal(mailtoLink({ to: TO, body: "x" }), "mailto:help@example.org?body=x");
});

test("mailtoLink: newline injection in subject, cc and to is removed; the body keeps its line breaks", () => {
  const link = mailtoLink({ to: TO, subject: "Hi\r\nBcc: evil" + "@" + "x.com", body: "a\nb" });
  assert.equal(link, "mailto:help@example.org?subject=HiBcc%3A%20evil%40x.com&body=a%0Ab");
  assert.ok(!/[\r\n]/.test(link));
  assert.equal(mailtoLink({ to: TO, cc: "c" + "@" + "x.com\r\n" }), "mailto:help@example.org?cc=c%40x.com");
  assert.equal(mailtoLink({ to: "help\r\n" + "@" + "example.org" }), "mailto:help@example.org");
});

test("mailtoLink: query characters inside the address cannot add parameters", () => {
  const link = mailtoLink({ to: "a?cc=evil" + "@" + "x.com" });
  assert.equal(link, "mailto:a%3Fcc%3Devil@x.com");
});

test("mailtoLink returns '' for an invalid or missing address", () => {
  for (const to of ["", "nobody", "a@b", "@example.org", "a@@example.org", "a b" + "@" + "example.org", "a" + "@" + "exa mple.org", undefined, null, 42, {}]) {
    assert.equal(mailtoLink({ to, subject: "x" }), "", String(to));
  }
  assert.equal(mailtoLink(), "");
  assert.equal(mailtoLink({}), "");
});

test("mailtoLink ignores non-string optional values", () => {
  assert.equal(mailtoLink({ to: TO, cc: 5, subject: null, body: {} }), "mailto:help@example.org");
});

test("isAnnouncementsHash refuses near misses and non-strings", () => {
  for (const h of ["announcements", "#Announcements", "#announcements ", " #announcements", "#announcements/", null, 0, {}, ["#announcements"]]) {
    assert.equal(isAnnouncementsHash(h), false, String(h));
  }
});
