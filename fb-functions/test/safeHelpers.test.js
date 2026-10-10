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
  return new Function(`${block}\nreturn { esc, safeId, safeUrl, safePhoto, clip, csvCell };`)();
}

const { esc, safeId, safeUrl, safePhoto, clip, csvCell } = loadHelpers();

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

test("csvCell prefixes formula-like values with a single quote", () => {
  assert.equal(csvCell("=1+1"), `"'=1+1"`);
  assert.equal(csvCell("+cmd"), `"'+cmd"`);
  assert.equal(csvCell("-2"), `"'-2"`);
  assert.equal(csvCell("@SUM(A1)"), `"'@SUM(A1)"`);
  assert.equal(csvCell("\t=x"), `"'\t=x"`);
  assert.equal(csvCell("\rx"), `"'\rx"`);
  assert.equal(csvCell("  =HYPERLINK(\"x\")"), `"'  =HYPERLINK(""x"")"`, "leading spaces don't hide a formula");
});

test("csvCell leaves normal text alone and keeps the existing quoting", () => {
  assert.equal(csvCell("Hans Mueller"), `"Hans Mueller"`);
  assert.equal(csvCell("a=b"), `"a=b"`, "only a leading sign counts");
  assert.equal(csvCell("Müller 🇬🇭"), `"Müller 🇬🇭"`);
  assert.equal(csvCell('Say "hi"'), `"Say ""hi"""`);
  assert.equal(csvCell("Berlin, Germany"), `"Berlin, Germany"`);
  assert.equal(csvCell('"=1",x'), `"""=1"",x"`, "a quote first is not a formula");
});

test("csvCell turns null and undefined into an empty cell", () => {
  assert.equal(csvCell(null), `""`);
  assert.equal(csvCell(undefined), `""`);
  assert.equal(csvCell(""), `""`);
});
