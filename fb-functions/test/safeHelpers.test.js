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
  return new Function(`${block}\nreturn { esc, safeId, safeUrl, safePhoto, clip, parseTicketHash, parseChatHash, clampBadge, isAnnouncementsHash, soundFor, mailtoLink, notifLine, profileLine, gapFor, lowerBarFor, shouldRegisterAtSignIn, shouldRefreshPush, LIMITS, fieldErrors, counterFor, tidyLinkedIn, classifySaveError, lightboxPhoto, orderMixed, pageSlice, newSessionSeed, shouldReshuffle, canEditMessage, messageView, previewText, validateEdit };`)();
}

const { esc, safeId, safeUrl, safePhoto, clip, parseTicketHash, parseChatHash, clampBadge, isAnnouncementsHash, soundFor, mailtoLink, notifLine,
  profileLine, gapFor, lowerBarFor, shouldRegisterAtSignIn, shouldRefreshPush, LIMITS, fieldErrors, counterFor, tidyLinkedIn,
  classifySaveError, lightboxPhoto, orderMixed, pageSlice, newSessionSeed, shouldReshuffle, canEditMessage, messageView,
  previewText, validateEdit } = loadHelpers();

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

// A push-capable browser with the switch on
const NOTIF = { permission: "default", supported: true, iosNotInstalled: false, registered: false, on: true };
const line = (line, showAllow = false, showTest = false) => ({ line, showAllow, showTest });

test("notifLine: off means no sound and no alerts, whatever else is true", () => {
  const off = line("Off. No sound and no alerts.");
  assert.deepEqual(notifLine({ ...NOTIF, on: false }), off);
  assert.deepEqual(notifLine({ ...NOTIF, on: false, permission: "granted", registered: true }), off);
  assert.deepEqual(notifLine({ ...NOTIF, on: undefined }), off, "missing on is off");
  assert.deepEqual(notifLine(), off);
  assert.deepEqual(notifLine({}), off);
});

test("notifLine: granted and registered shows the test button", () => {
  assert.deepEqual(notifLine({ ...NOTIF, permission: "granted", registered: true }),
    line("Sound in the app and alerts on this device", false, true));
});

test("notifLine: never asked offers Allow alerts", () => {
  assert.deepEqual(notifLine(NOTIF), line("Sound in the app. Turn on alerts for when the app is closed.", true, false));
});

test("notifLine: granted without a registration (setup failed) offers Allow alerts again", () => {
  assert.deepEqual(notifLine({ ...NOTIF, permission: "granted", registered: false }),
    line("Sound in the app. Turn on alerts for when the app is closed.", true, false));
  assert.deepEqual(notifLine({ ...NOTIF, permission: "granted", registered: undefined }).showAllow, true);
});

test("notifLine: denied says blocked, with no buttons", () => {
  assert.deepEqual(notifLine({ ...NOTIF, permission: "denied" }),
    line("Sound in the app. Alerts outside the app are blocked in this browser."));
  assert.deepEqual(notifLine({ ...NOTIF, permission: "denied", registered: true }).showTest, false);
});

test("notifLine: an iPhone that is not installed needs the Home Screen", () => {
  const ios = line("Sound in the app. Alerts outside the app need the app on your Home Screen.");
  assert.deepEqual(notifLine({ ...NOTIF, iosNotInstalled: true, supported: false, permission: "unsupported" }), ios);
  assert.deepEqual(notifLine({ ...NOTIF, iosNotInstalled: true }), ios, "never offers Allow on an uninstalled iPhone");
});

test("notifLine: unsupported or missing details mean sound only", () => {
  assert.deepEqual(notifLine({ ...NOTIF, supported: false, permission: "unsupported" }), line("Sound in the app."));
  assert.deepEqual(notifLine({ ...NOTIF, supported: false }), line("Sound in the app."), "default without support");
  assert.deepEqual(notifLine({ on: true }), line("Sound in the app."));
  assert.deepEqual(notifLine({ ...NOTIF, permission: undefined }), line("Sound in the app."));
});

test("notifLine: no line mentions battery, power saving, phone settings or background restrictions", () => {
  const inputs = [NOTIF, { ...NOTIF, on: false }, { ...NOTIF, permission: "granted", registered: true }, { ...NOTIF, permission: "denied" },
    { ...NOTIF, iosNotInstalled: true }, { on: true }];
  for (const i of inputs) assert.doesNotMatch(notifLine(i).line, /battery|power|setting|optimi|background/i);
});

test("profileLine joins company and country with a middle dot", () => {
  assert.equal(profileLine({ company: "AHK Ghana", country: "Ghana" }), "AHK Ghana · Ghana");
});

test("profileLine leaves out an empty part", () => {
  assert.equal(profileLine({ company: "AHK Ghana" }), "AHK Ghana");
  assert.equal(profileLine({ company: "AHK Ghana", country: "" }), "AHK Ghana");
  assert.equal(profileLine({ country: "Germany" }), "Germany");
  assert.equal(profileLine({ company: "", country: "Germany" }), "Germany");
});

test("profileLine is empty when neither part is there", () => {
  assert.equal(profileLine({}), "");
  assert.equal(profileLine(), "");
  assert.equal(profileLine({ company: "", country: "" }), "");
  assert.equal(profileLine({ company: "   ", country: "\t\n" }), "");
});

test("profileLine trims and collapses extra spaces", () => {
  assert.equal(profileLine({ company: "  AHK   Ghana ", country: " Ghana  " }), "AHK Ghana · Ghana");
  assert.equal(profileLine({ company: "AHK\n\tGhana" }), "AHK Ghana");
});

test("profileLine ignores non-string parts", () => {
  for (const v of [null, undefined, 42, true, {}, ["Ghana"]]) {
    assert.equal(profileLine({ company: v, country: "Ghana" }), "Ghana", String(v));
    assert.equal(profileLine({ company: "AHK", country: v }), "AHK", String(v));
  }
});

test("profileLine returns hostile text unchanged (esc is applied when rendering)", () => {
  const evil = '<img src=x onerror="alert(1)">';
  assert.equal(profileLine({ company: evil, country: "<b>GH</b>" }), evil + " · <b>GH</b>");
  assert.equal(esc(profileLine({ company: evil })), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

// An iPhone running the app from the Home Screen
const HOME = { isIPhone: true, isStandalone: true, stored: null, defaultPx: 40 };

test("gapFor: iPhone Home Screen app with nothing stored gives the default 40", () => {
  assert.equal(gapFor(HOME), 40);
  assert.equal(gapFor({ ...HOME, stored: undefined }), 40);
});

test("gapFor: a stored whole number is used", () => {
  assert.equal(gapFor({ ...HOME, stored: "60" }), 60);
  assert.equal(gapFor({ ...HOME, stored: "0" }), 0);
});

test("gapFor: a stored value that does not parse gives the default", () => {
  assert.equal(gapFor({ ...HOME, stored: "abc" }), 40);
  assert.equal(gapFor({ ...HOME, stored: "" }), 40);
});

test("gapFor: stored values are clamped to 0..120", () => {
  assert.equal(gapFor({ ...HOME, stored: "-5" }), 0);
  assert.equal(gapFor({ ...HOME, stored: "500" }), 120);
});

test("gapFor: not an iPhone gives 0", () => {
  assert.equal(gapFor({ ...HOME, isIPhone: false }), 0);
  assert.equal(gapFor({ ...HOME, isIPhone: false, stored: "60" }), 0);
});

test("gapFor: an iPhone in a browser tab (not standalone) gives 0", () => {
  assert.equal(gapFor({ ...HOME, isStandalone: false }), 0);
  assert.equal(gapFor({ ...HOME, isStandalone: false, stored: "60" }), 0);
});

test("gapFor: missing values give 0", () => {
  assert.equal(gapFor(), 0);
  assert.equal(gapFor({}), 0);
  assert.equal(gapFor({ isIPhone: true }), 0);
  assert.equal(gapFor({ isIPhone: true, isStandalone: true }), 0, "no stored value and no default");
});

// A Home Screen app on an 844pt tall iPhone
const BAR = { isHome: true, screenH: 844, innerH: 797 };

test("lowerBarFor: a Home Screen app whose page is 47px shorter than the screen gives true", () => {
  assert.equal(lowerBarFor(BAR), true);
  assert.equal(lowerBarFor({ ...BAR, innerH: 824 }), true, "a gap of exactly 20 counts");
});

test("lowerBarFor: a page covering the whole screen gives false", () => {
  assert.equal(lowerBarFor({ ...BAR, innerH: 844 }), false);
});

test("lowerBarFor: a gap under 20 (innerH 830) gives false", () => {
  assert.equal(lowerBarFor({ ...BAR, innerH: 830 }), false);
});

test("lowerBarFor: not a Home Screen app gives false", () => {
  assert.equal(lowerBarFor({ ...BAR, isHome: false }), false);
  assert.equal(lowerBarFor({ ...BAR, isHome: "yes" }), false);
});

test("lowerBarFor: missing values give false", () => {
  assert.equal(lowerBarFor(), false);
  assert.equal(lowerBarFor({}), false);
  assert.equal(lowerBarFor({ isHome: true }), false);
  assert.equal(lowerBarFor({ ...BAR, screenH: undefined }), false);
  assert.equal(lowerBarFor({ ...BAR, innerH: NaN }), false);
});

// A participant who just signed in on a device that can receive alerts, with permission and sound on
const SIGNIN = { supported: true, permission: "granted", soundOn: true, iosNotInstalled: false, alreadyDone: false };

test("shouldRegisterAtSignIn: everything in place gives true", () => {
  assert.equal(shouldRegisterAtSignIn(SIGNIN), true);
});

test("shouldRegisterAtSignIn: no push support gives false", () => {
  assert.equal(shouldRegisterAtSignIn({ ...SIGNIN, supported: false }), false);
  assert.equal(shouldRegisterAtSignIn({ ...SIGNIN, supported: "yes" }), false);
});

test("shouldRegisterAtSignIn: permission not granted gives false", () => {
  for (const permission of ["default", "denied", "unsupported", "GRANTED", ""]) {
    assert.equal(shouldRegisterAtSignIn({ ...SIGNIN, permission }), false, permission);
  }
});

test("shouldRegisterAtSignIn: sound (the Notifications switch) off gives false", () => {
  assert.equal(shouldRegisterAtSignIn({ ...SIGNIN, soundOn: false }), false);
});

test("shouldRegisterAtSignIn: an iPhone/iPad not installed on the Home Screen gives false", () => {
  assert.equal(shouldRegisterAtSignIn({ ...SIGNIN, iosNotInstalled: true }), false);
});

test("shouldRegisterAtSignIn: already done for this session gives false", () => {
  assert.equal(shouldRegisterAtSignIn({ ...SIGNIN, alreadyDone: true }), false);
});

test("shouldRegisterAtSignIn: missing values give false", () => {
  assert.equal(shouldRegisterAtSignIn(), false);
  assert.equal(shouldRegisterAtSignIn({}), false);
  for (const k of Object.keys(SIGNIN)) {
    const o = { ...SIGNIN };
    delete o[k];
    assert.equal(shouldRegisterAtSignIn(o), false, `without ${k}`);
  }
  assert.equal(shouldRegisterAtSignIn({ ...SIGNIN, iosNotInstalled: null }), false, "iosNotInstalled null");
});

// Last successful registration 1 hour before now
const NOW = 1_800_000_000_000;
const REFRESH = { supported: true, permission: "granted", soundOn: true, iosNotInstalled: false, lastAtMs: NOW - 3_600_000, nowMs: NOW };

test("shouldRefreshPush: everything in place and registered long enough ago gives true", () => {
  assert.equal(shouldRefreshPush(REFRESH), true);
});

test("shouldRefreshPush: never registered (no lastAtMs) gives true", () => {
  const { lastAtMs, ...rest } = REFRESH;
  assert.equal(shouldRefreshPush(rest), true);
  assert.equal(shouldRefreshPush({ ...REFRESH, lastAtMs: undefined }), true);
  assert.equal(shouldRefreshPush({ ...REFRESH, lastAtMs: null }), true);
  assert.equal(shouldRefreshPush({ ...REFRESH, lastAtMs: NaN }), true, "an unreadable stored time counts as never");
});

test("shouldRefreshPush: the 10 minute default gap, exactly and 1 ms short", () => {
  assert.equal(shouldRefreshPush({ ...REFRESH, lastAtMs: NOW - 600000 }), true, "exactly 10 minutes");
  assert.equal(shouldRefreshPush({ ...REFRESH, lastAtMs: NOW - 599999 }), false, "1 ms less");
  assert.equal(shouldRefreshPush({ ...REFRESH, lastAtMs: NOW }), false, "just registered");
});

test("shouldRefreshPush: a given minGapMs, exactly and 1 ms short", () => {
  assert.equal(shouldRefreshPush({ ...REFRESH, lastAtMs: NOW - 5000, minGapMs: 5000 }), true);
  assert.equal(shouldRefreshPush({ ...REFRESH, lastAtMs: NOW - 4999, minGapMs: 5000 }), false);
});

test("shouldRefreshPush: no push support gives false", () => {
  assert.equal(shouldRefreshPush({ ...REFRESH, supported: false }), false);
  assert.equal(shouldRefreshPush({ ...REFRESH, supported: "yes" }), false);
});

test("shouldRefreshPush: permission not granted gives false", () => {
  for (const permission of ["default", "denied", "unsupported", ""]) {
    assert.equal(shouldRefreshPush({ ...REFRESH, permission }), false, permission);
  }
});

test("shouldRefreshPush: sound (the Notifications switch) off gives false", () => {
  assert.equal(shouldRefreshPush({ ...REFRESH, soundOn: false }), false);
});

test("shouldRefreshPush: an iPhone/iPad not installed on the Home Screen gives false", () => {
  assert.equal(shouldRefreshPush({ ...REFRESH, iosNotInstalled: true }), false);
});

test("shouldRefreshPush: missing values give false (except lastAtMs)", () => {
  assert.equal(shouldRefreshPush(), false);
  assert.equal(shouldRefreshPush({}), false);
  for (const k of ["supported", "permission", "soundOn", "iosNotInstalled", "nowMs"]) {
    const o = { ...REFRESH };
    delete o[k];
    assert.equal(shouldRefreshPush(o), false, `without ${k}`);
  }
  assert.equal(shouldRefreshPush({ ...REFRESH, nowMs: NaN }), false, "nowMs NaN");
  assert.equal(shouldRefreshPush({ ...REFRESH, minGapMs: "600000" }), false, "minGapMs not a number");
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

const TOO_LONG = "Too long: please shorten to N characters or fewer.";
const LINK_LONG = "This link is too long. Please use a shorter address.";
const EMAIL_LONG = "This email address is too long.";

test("LIMITS match firestore.rules", () => {
  assert.deepEqual({ ...LIMITS }, { name: 120, company: 120, title: 120, website: 200, linkedin: 200, sectorOther: 60, ptypeOther: 40, bio: 600, email: 200 });
});

test("fieldErrors: exactly at the limit is fine, one over gives the field's message", () => {
  for (const [k, n] of Object.entries(LIMITS)) {
    assert.deepEqual(fieldErrors({ [k]: "a".repeat(n) }), {}, `${k} at ${n}`);
    const msg = k === "website" || k === "linkedin" ? LINK_LONG : k === "email" ? EMAIL_LONG : TOO_LONG.replace("N", String(n));
    assert.deepEqual(fieldErrors({ [k]: "a".repeat(n + 1) }), { [k]: msg }, `${k} at ${n + 1}`);
  }
});

test("fieldErrors measures the trimmed value with .length and reports every wrong field", () => {
  assert.deepEqual(fieldErrors({ name: "  " + "a".repeat(120) + "\n\t " }), {});
  assert.deepEqual(fieldErrors({ ptypeOther: "🇬🇭".repeat(10) + "a" }), { ptypeOther: TOO_LONG.replace("N", "40") }, "emoji count as UTF-16 units");
  const out = fieldErrors({ name: "x".repeat(121), website: "x".repeat(201), email: "x".repeat(201), bio: "ok", title: "" });
  assert.deepEqual(Object.keys(out).sort(), ["email", "name", "website"]);
});

test("fieldErrors: empty, missing, hostile and non-string values give no error", () => {
  for (const v of [undefined, null, 0, "x", [], {}]) assert.deepEqual(fieldErrors(v), {}, String(v));
  assert.deepEqual(fieldErrors({ name: "", company: "   ", title: null, website: undefined }), {});
  assert.deepEqual(fieldErrors({ name: 12345, company: ["a".repeat(500)], title: { length: 999 }, bio: true, email: Symbol("e") }), {});
  assert.deepEqual(fieldErrors({ name: IMG_ONERROR, bio: SCRIPT_BREAK }), {});
  assert.deepEqual(fieldErrors({ unknown: "a".repeat(10000) }), {});
  const proto = JSON.parse('{"__proto__":{"name":"' + "a".repeat(500) + '"}}');
  assert.deepEqual(fieldErrors(proto), {}, "inherited values are not read as own fields");
});

test("counterFor shows N / LIMIT from 80 percent of the limit", () => {
  assert.equal(counterFor(0, 120), "");
  assert.equal(counterFor(95, 120), "");
  assert.equal(counterFor(96, 120), "96 / 120");
  assert.equal(counterFor(120, 120), "120 / 120");
  assert.equal(counterFor(121, 120), "121 / 120");
  assert.equal(counterFor(47, 60), "");
  assert.equal(counterFor(48, 60), "48 / 60");
  for (const [l, m] of [[NaN, 120], [100, NaN], ["100", 120], [100, "120"], [null, 120], [100, 0], [100, -5], [Infinity, 120]]) {
    assert.equal(counterFor(l, m), "", `${String(l)}, ${String(m)}`);
  }
});

test("tidyLinkedIn removes a query or fragment from LinkedIn links only", () => {
  assert.deepEqual(tidyLinkedIn("https://www.linkedin.com/in/jane?utm_source=share&utm_medium=app"), { value: "https://www.linkedin.com/in/jane", changed: true });
  assert.deepEqual(tidyLinkedIn("linkedin.com/in/jane/#experience"), { value: "linkedin.com/in/jane/", changed: true });
  assert.deepEqual(tidyLinkedIn("  https://LinkedIn.com/in/jane#a?b  "), { value: "https://LinkedIn.com/in/jane", changed: true }, "the first ? or # wins");
  assert.deepEqual(tidyLinkedIn("https://www.linkedin.com/in/jane"), { value: "https://www.linkedin.com/in/jane", changed: false });
  assert.deepEqual(tidyLinkedIn("  linkedin.com/in/jane  "), { value: "linkedin.com/in/jane", changed: false }, "trimmed but not a tidy");
});

test("tidyLinkedIn leaves other links and values unchanged", () => {
  assert.deepEqual(tidyLinkedIn("https://example.com/me?ref=x#top"), { value: "https://example.com/me?ref=x#top", changed: false });
  assert.deepEqual(tidyLinkedIn(""), { value: "", changed: false });
  assert.deepEqual(tidyLinkedIn(IMG_ONERROR), { value: IMG_ONERROR, changed: false });
  for (const v of [null, undefined, 42, true]) assert.deepEqual(tidyLinkedIn(v), { value: v, changed: false }, String(v));
  const obj = { toString: () => "linkedin.com/in/x?y" };
  assert.equal(tidyLinkedIn(obj).changed, false);
  assert.equal(tidyLinkedIn(obj).value, obj);
});

test("classifySaveError: network, check and other", () => {
  for (const c of ["unavailable", "deadline-exceeded", "network-request-failed", "auth/network-request-failed", "firestore/unavailable"]) {
    assert.equal(classifySaveError(c, true), "network", c);
  }
  for (const c of ["permission-denied", "invalid-argument", "firestore/permission-denied"]) {
    assert.equal(classifySaveError(c, true), "check", c);
  }
  for (const c of ["internal", "unknown", "resource-exhausted", "already-exists", "", "Unavailable", "permission-denied ", undefined, null, 503, {}]) {
    assert.equal(classifySaveError(c, true), "other", String(c));
  }
});

test("classifySaveError: offline is always network; only online === false counts as offline", () => {
  for (const c of ["permission-denied", "invalid-argument", "internal", undefined, null]) assert.equal(classifySaveError(c, false), "network", String(c));
  assert.equal(classifySaveError("permission-denied", undefined), "check");
  assert.equal(classifySaveError("internal", "false"), "other");
  assert.equal(classifySaveError("internal", 0), "other");
});

test("lightboxPhoto returns a Firebase Storage photo URL", () => {
  assert.equal(lightboxPhoto({ photoURL: PHOTO }), PHOTO);
  assert.equal(lightboxPhoto({ name: "x", photoURL: "https://gabs2026-4f482.firebasestorage.app/o/p.jpg" }), "https://gabs2026-4f482.firebasestorage.app/o/p.jpg");
});

test("lightboxPhoto refuses everything safePhoto refuses, and missing or odd values", () => {
  for (const u of ["https://example.com/me.jpg", "http://firebasestorage.googleapis.com/x", "javascript:alert(1)",
    "data:image/png;base64,iVBORw0KGgo=", "", "   ", IMG_ONERROR]) {
    assert.equal(lightboxPhoto({ photoURL: u }), "", u);
  }
  for (const p of [{ photoURL: null }, { photoURL: undefined }, {}, { photoURL: 42 }, { photoURL: ["x"] }, { photoURL: { toString: () => PHOTO } }]) {
    assert.equal(lightboxPhoto(p), "", JSON.stringify(p));
  }
  for (const p of [null, undefined, "", PHOTO, 0, true]) assert.equal(lightboxPhoto(p), "", String(p));
});

const people = n => Array.from({ length: n }, (_, i) => ({ id: "p" + String(i).padStart(4, "0") + "x" + ((i * 7919) % 1000) }));
const ids = list => list.map(p => (p && typeof p === "object" ? p.id : p));

test("orderMixed: the same seed always gives the same order, input untouched", () => {
  const list = people(40);
  const before = JSON.stringify(list);
  const a = orderMixed(list, "seed-a");
  assert.deepEqual(ids(orderMixed(list, "seed-a")), ids(a));
  assert.deepEqual(ids(orderMixed(list.slice().reverse(), "seed-a")), ids(a), "input order does not matter");
  assert.equal(JSON.stringify(list), before);
  assert.notEqual(a, list);
  assert.equal(a.length, 40);
  assert.deepEqual(ids(a).slice().sort(), ids(list).slice().sort());
});

test("orderMixed: two different seeds give different orders", () => {
  const list = people(40);
  const a = ids(orderMixed(list, "seed-a"));
  assert.notDeepEqual(ids(orderMixed(list, "seed-b")), a);
  assert.notDeepEqual(ids(orderMixed(list, newSessionSeed())), ids(orderMixed(list, newSessionSeed())));
  assert.notDeepEqual(a, ids(list), "not simply the input order");
});

test("orderMixed: the viewer is not part of the order, only the seed", () => {
  const list = people(20);
  assert.deepEqual(ids(orderMixed(list, "seed-a", "viewerX")), ids(orderMixed(list, "seed-a", "viewerY")));
});

test("orderMixed: adding one participant keeps the relative order of the others", () => {
  const list = people(60);
  const a = ids(orderMixed(list, "seed-a"));
  const b = ids(orderMixed([...list, { id: "newcomer" }], "seed-a")).filter(id => id !== "newcomer");
  assert.deepEqual(b, a);
  const c = ids(orderMixed(list.slice(1), "seed-a"));
  assert.deepEqual(c, a.filter(id => id !== list[0].id), "removing one keeps the rest too");
});

test("orderMixed: 50 seeds over 200 participants put at least 15 different people first", () => {
  const list = people(200);
  const firsts = new Set();
  for (let v = 0; v < 50; v++) firsts.add(orderMixed(list, "seed-" + v)[0].id);
  assert.ok(firsts.size >= 15, `only ${firsts.size} distinct first participants`);
});

test("orderMixed: ties by id, missing ids last, hostile and missing values", () => {
  const dup = [{ id: "b", n: 1 }, { id: "a" }, { id: "b", n: 2 }];
  const out = orderMixed(dup, "s");
  assert.deepEqual(out.filter(p => p.id === "b").map(p => p.n), [1, 2], "equal ids keep their input order");
  const odd = [{ id: 5 }, null, { id: "x" }, "y", undefined, { name: "no id" }, { id: "w" }];
  const r = orderMixed(odd, "s");
  assert.equal(r.length, odd.length);
  assert.deepEqual(ids(r.slice(0, 2)).sort(), ["w", "x"]);
  assert.deepEqual(r.slice(2), [odd[0], null, "y", undefined, odd[5]], "entries without a string id go last, in order");
  for (const bad of [null, undefined, "abc", 42, {}, { length: 3 }]) assert.deepEqual(orderMixed(bad, "s"), [], String(bad));
  const list = people(10);
  for (const seed of [null, undefined, 42, {}, IMG_ONERROR, SCRIPT_BREAK, "x".repeat(10000)]) {
    const o = orderMixed(list, seed);
    assert.equal(o.length, 10);
    assert.deepEqual(ids(orderMixed(list, seed)), ids(o));
  }
  assert.deepEqual(ids(orderMixed(list, null)), ids(orderMixed(list, "")), "a non-string seed counts as empty");
  assert.deepEqual(orderMixed([], "s"), []);
});

test("newSessionSeed: at least 16 hex characters, different on consecutive calls", () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const s = newSessionSeed();
    assert.match(s, /^[0-9a-f]{16,}$/);
    seen.add(s);
  }
  assert.equal(seen.size, 20);
});

test("newSessionSeed uses an injected source", () => {
  let calls = 0;
  const fake = { getRandomValues(a) { calls++; for (let i = 0; i < a.length; i++) a[i] = 0x01020304 * (i + 1); return a; } };
  assert.equal(newSessionSeed(fake), "01020304020406080306090c04080c10");
  assert.equal(calls, 1);
  let n = 0;
  const counter = { getRandomValues(a) { a.fill(++n); return a; } };
  assert.notEqual(newSessionSeed(counter), newSessionSeed(counter));
});

test("newSessionSeed falls back to Math.random and Date.now without a usable source", () => {
  for (const src of [null, {}, { getRandomValues: "no" }, { getRandomValues() { throw new Error("blocked"); } }]) {
    const a = newSessionSeed(src), b = newSessionSeed(src);
    assert.match(a, /^[0-9a-f]{16,}$/, String(src));
    assert.notEqual(a, b);
  }
});

test("shouldReshuffle: only after at least minGapMs hidden", () => {
  const t = 1762560000000;
  assert.equal(shouldReshuffle(t, t + 1800000), true, "exactly the default 30 minutes");
  assert.equal(shouldReshuffle(t, t + 1799999), false, "one millisecond less");
  assert.equal(shouldReshuffle(t, t + 5000, 5000), true, "exactly minGapMs");
  assert.equal(shouldReshuffle(t, t + 4999, 5000), false, "one millisecond less than minGapMs");
  assert.equal(shouldReshuffle(t, t + 86400000), true);
  assert.equal(shouldReshuffle(t, t), false);
  assert.equal(shouldReshuffle(t, t, 0), true, "a gap of 0 reshuffles at once");
  assert.equal(shouldReshuffle(t, t - 1), false, "now before hidden");
  assert.equal(shouldReshuffle(t, t - 1, 0), false);
  assert.equal(shouldReshuffle(t, t + 1800000, "5000"), true, "an unusable gap uses the default");
  assert.equal(shouldReshuffle(t, t + 1799999, NaN), false);
});

test("shouldReshuffle: missing and non-number times give false", () => {
  const t = 1762560000000;
  for (const [h, n] of [[undefined, t], [t, undefined], [null, t], [t, null], ["1", t + 1e7], [t, String(t + 1e7)],
    [NaN, t], [t, NaN], [Infinity, Infinity], [-Infinity, t], [{}, t], [[t], t + 1e7]]) {
    assert.equal(shouldReshuffle(h, n), false, `${String(h)}, ${String(n)}`);
  }
  assert.equal(shouldReshuffle(), false);
});

test("pageSlice returns the first count items, clamped", () => {
  const l = [1, 2, 3, 4, 5];
  assert.deepEqual(pageSlice(l, 3), [1, 2, 3]);
  assert.deepEqual(pageSlice(l, 0), []);
  assert.deepEqual(pageSlice(l, 5), l);
  assert.deepEqual(pageSlice(l, 6), l);
  assert.deepEqual(pageSlice(l, Infinity), l);
  assert.deepEqual(pageSlice(l, -2), []);
  assert.deepEqual(pageSlice(l, -Infinity), []);
  assert.deepEqual(pageSlice(l, 2.9), [1, 2]);
  assert.notEqual(pageSlice(l, 5), l, "always a new array");
  for (const c of [NaN, "3", null, undefined, {}, [3], true]) assert.deepEqual(pageSlice(l, c), [], String(c));
  for (const bad of [null, undefined, "abc", { length: 2 }]) assert.deepEqual(pageSlice(bad, 2), [], String(bad));
});

const MY = "uidMe";
const myText = (extra = {}) => ({ fromId: MY, text: "hello", ts: { seconds: 1 }, hasMeeting: false, ...extra });

test("canEditMessage: your own plain text message", () => {
  assert.equal(canEditMessage(myText(), MY), true);
  assert.equal(canEditMessage(myText({ text: "" }), MY), true, "an empty text is still a string");
  assert.equal(canEditMessage(myText({ editedAt: { seconds: 2 } }), MY), true, "an edited message can be edited again");
  assert.equal(canEditMessage({ fromId: MY, text: "no hasMeeting field" }, MY), true);
  assert.equal(canEditMessage(myText({ meeting: null }), MY), true);
  assert.equal(canEditMessage(myText({ deleted: false }), MY), true);
});

test("canEditMessage refuses other people, deleted messages, meeting requests and odd values", () => {
  assert.equal(canEditMessage(myText({ fromId: "someoneElse" }), MY), false);
  assert.equal(canEditMessage(myText({ deleted: true, text: "" }), MY), false);
  assert.equal(canEditMessage(myText({ hasMeeting: true }), MY), false);
  assert.equal(canEditMessage(myText({ meeting: { loc: "Hall" } }), MY), false);
  assert.equal(canEditMessage(myText({ meeting: {} }), MY), false);
  assert.equal(canEditMessage(myText({ meeting: "x" }), MY), false);
  for (const t of [null, undefined, 5, {}, ["x"]]) assert.equal(canEditMessage(myText({ text: t }), MY), false, String(t));
  assert.equal(canEditMessage({ text: "x" }, MY), false, "no fromId");
  for (const uid of [undefined, null, "", 5, {}]) {
    assert.equal(canEditMessage(myText({ fromId: uid }), uid), false, `uid ${String(uid)}`);
  }
  for (const m of [null, undefined, "hello", 5, [], true]) assert.equal(canEditMessage(m, MY), false, String(m));
  assert.equal(canEditMessage(myText(), MY + " "), false);
  assert.equal(canEditMessage(myText({ text: IMG_ONERROR }), MY), true, "content does not matter, only ownership");
});

test("messageView: deleted, plain and edited messages", () => {
  assert.deepEqual(messageView({ deleted: true, text: "" }), { kind: "deleted" });
  assert.deepEqual(messageView({ deleted: true, text: "left over" }), { kind: "deleted" });
  assert.deepEqual(messageView({ text: "hi" }), { kind: "text", text: "hi", edited: false });
  assert.deepEqual(messageView({ text: "hi", editedAt: { seconds: 5 } }), { kind: "text", text: "hi", edited: true });
  assert.deepEqual(messageView({ text: "hi", editedAt: null }), { kind: "text", text: "hi", edited: false });
  assert.deepEqual(messageView({ text: "hi", deleted: "true" }), { kind: "text", text: "hi", edited: false }, "only deleted === true counts");
  assert.deepEqual(messageView({ text: SCRIPT_BREAK }), { kind: "text", text: SCRIPT_BREAK, edited: false }, "text is returned raw, escaped where drawn");
  for (const m of [null, undefined, "str", 5, []]) assert.deepEqual(messageView(m), { kind: "text", text: "", edited: false }, String(m));
  for (const t of [null, 5, {}, ["x"]]) assert.deepEqual(messageView({ text: t }), { kind: "text", text: "", edited: false }, String(t));
});

test("previewText: Message deleted or the text", () => {
  assert.equal(previewText({ deleted: true, text: "" }), "Message deleted");
  assert.equal(previewText({ text: "See you at 10" }), "See you at 10");
  assert.equal(previewText({ text: "edited", editedAt: { seconds: 1 } }), "edited");
  for (const m of [null, undefined, {}, { text: 5 }, "x"]) assert.equal(previewText(m), "", String(m));
});

test("validateEdit: every outcome", () => {
  assert.equal(validateEdit("new", "old", 2000), "ok");
  assert.equal(validateEdit("  new  ", "old", 2000), "ok");
  assert.equal(validateEdit("", "old", 2000), "empty");
  assert.equal(validateEdit("  \n\t ", "old", 2000), "empty");
  for (const v of [null, undefined, 5, {}, ["x"], true]) assert.equal(validateEdit(v, "old", 2000), "empty", String(v));
  assert.equal(validateEdit("old", "old", 2000), "unchanged");
  assert.equal(validateEdit("  old\n", "old", 2000), "unchanged");
  assert.equal(validateEdit("old", "  old  ", 2000), "unchanged");
  assert.equal(validateEdit("x".repeat(2000), "old", 2000), "ok", "exactly maxLen");
  assert.equal(validateEdit("x".repeat(2001), "old", 2000), "toolong");
  assert.equal(validateEdit("  " + "x".repeat(2000) + "  ", "old", 2000), "ok", "measured after trimming");
  assert.equal(validateEdit("", "x".repeat(5000), 2000), "empty", "empty wins over everything");
  assert.equal(validateEdit("x".repeat(3000), "x".repeat(3000), 2000), "unchanged", "unchanged is checked before length");
  for (const old of [null, undefined, 5, {}]) assert.equal(validateEdit("new", old, 2000), "ok", `old ${String(old)}`);
  for (const max of [undefined, null, NaN, "10", Infinity]) assert.equal(validateEdit("x".repeat(50), "old", max), "ok", `max ${String(max)}`);
  assert.equal(validateEdit(IMG_ONERROR, "old", 2000), "ok");
});
