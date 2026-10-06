"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateInput,
  cleanField,
  buildPrompt,
  parseMatchReply,
  rateDecision,
} = require("../lib/match");

// ── validateInput ────────────────────────────────────────────────────────

test("validateInput accepts a single valid id", () => {
  assert.deepEqual(validateInput({ candidateIds: ["abc123"] }), ["abc123"]);
});

test("validateInput accepts exactly 40 ids", () => {
  const ids = Array.from({ length: 40 }, (_, i) => `id_${i}`);
  assert.deepEqual(validateInput({ candidateIds: ids }), ids);
});

test("validateInput rejects 0 ids", () => {
  assert.equal(validateInput({ candidateIds: [] }), null);
});

test("validateInput rejects 41 ids", () => {
  const ids = Array.from({ length: 41 }, (_, i) => `id_${i}`);
  assert.equal(validateInput({ candidateIds: ids }), null);
});

test("validateInput rejects a non-array candidateIds", () => {
  assert.equal(validateInput({ candidateIds: "not-an-array" }), null);
  assert.equal(validateInput({}), null);
  assert.equal(validateInput(null), null);
});

test("validateInput rejects ids with disallowed characters", () => {
  assert.equal(validateInput({ candidateIds: ["has a space"] }), null);
  assert.equal(validateInput({ candidateIds: ["has/slash"] }), null);
  assert.equal(validateInput({ candidateIds: ["has.dot"] }), null);
  assert.equal(validateInput({ candidateIds: ["emoji🙂"] }), null);
});

test("validateInput rejects an id longer than 40 characters", () => {
  assert.equal(validateInput({ candidateIds: ["a".repeat(41)] }), null);
  assert.deepEqual(validateInput({ candidateIds: ["a".repeat(40)] }), ["a".repeat(40)]);
});

test("validateInput rejects non-string entries", () => {
  assert.equal(validateInput({ candidateIds: [123] }), null);
  assert.equal(validateInput({ candidateIds: [null] }), null);
});

test("validateInput rejects duplicate ids", () => {
  assert.equal(validateInput({ candidateIds: ["a", "b", "a"] }), null);
});

// ── cleanField ───────────────────────────────────────────────────────────

test("cleanField coerces non-string input to a string", () => {
  assert.equal(cleanField(123, 10), "123");
  assert.equal(cleanField(null, 10), "");
  assert.equal(cleanField(undefined, 10), "");
});

test("cleanField collapses internal whitespace and newlines to single spaces", () => {
  assert.equal(cleanField("Hans\nMueller", 80), "Hans Mueller");
  assert.equal(cleanField("a\n\n\nb", 80), "a b");
  assert.equal(cleanField("a\tb   c", 80), "a b c");
});

test("cleanField trims leading/trailing whitespace", () => {
  assert.equal(cleanField("  hello  ", 80), "hello");
  assert.equal(cleanField("\n  hello\n", 80), "hello");
});

test("cleanField truncates to max length", () => {
  assert.equal(cleanField("a".repeat(100), 10), "a".repeat(10));
  assert.equal(cleanField("short", 10), "short");
});

// ── buildPrompt ──────────────────────────────────────────────────────────

test("buildPrompt embeds the ME line and a numbered OTHER PARTICIPANTS list", () => {
  const me = { name: "Hans Mueller", title: "CEO", company: "Berlin Tech", sector: "Technology", country: "Germany", interests: ["Funding & Finance"], bio: "A bio.", ptype: "Business" };
  const candidates = [
    { id: "p1", name: "Ama Boateng", title: "Founder", company: "Accra Solar", sector: "Energy", country: "Ghana", interests: ["Investment Opportunities"], bio: "Another bio.", ptype: "Business" },
  ];
  const prompt = buildPrompt(me, candidates);
  assert.match(prompt, /^You are a B2B matchmaker for GABS 2026/);
  assert.match(prompt, /ME: Hans Mueller\|CEO\|Berlin Tech\|Technology\|Germany\|Funding & Finance\|A bio\.\|Business/);
  assert.match(prompt, /OTHER PARTICIPANTS:\n1: ID=p1\|Ama Boateng\|Founder\|Accra Solar\|Energy\|Ghana\|Investment Opportunities\|Another bio\.\|Business/);
  assert.match(prompt, /\{"matchId":"<exact id>","matchName":"<name>","reason":/);
});

test("buildPrompt contains no raw newlines inside profile fields (only the template's own structural newlines)", () => {
  const me = { name: "Line1\nLine2", title: "T\n\n\n", company: "C", sector: "S", country: "Co", interests: ["x"], bio: "bio\nwith\nnewlines", ptype: "P" };
  const candidates = [
    { id: "p1", name: "Also\nmultiline", title: "T2", company: "C2", sector: "S2", country: "Co2", interests: ["y\nz"], bio: "b2", ptype: "P2" },
  ];
  const prompt = buildPrompt(me, candidates);
  const lines = prompt.split("\n");
  // Every structural line is one of: the intro, blank separators, the ME
  // line, "OTHER PARTICIPANTS:", one line per candidate, the "Find the
  // single..." line, "Respond ONLY..." line, and the JSON format line.
  // None of those lines should contain an embedded field newline — i.e.
  // the total line count must match exactly what the fixed template
  // produces for one candidate (11 lines).
  assert.equal(lines.length, 11);
  assert.equal(lines[2], "ME: Line1 Line2|T|C|S|Co|x|bio with newlines|P");
  assert.equal(lines[5], "1: ID=p1|Also multiline|T2|C2|S2|Co2|y z|b2|P2");
});

test("buildPrompt caps interests at 8 and truncates long fields", () => {
  const me = { name: "Me", title: "T", company: "C", sector: "S", country: "Co", interests: Array.from({ length: 12 }, (_, i) => `interest${i}`), bio: "b", ptype: "P" };
  const candidates = [{ id: "p1", name: "a".repeat(200), title: "T", company: "C", sector: "S", country: "Co", interests: [], bio: "b".repeat(500), ptype: "P" }];
  const prompt = buildPrompt(me, candidates);
  const meLine = prompt.split("\n")[2];
  const meInterestsField = meLine.split("|")[5];
  assert.equal(meInterestsField.split(",").length, 8);
  const candidateLine = prompt.split("\n")[5];
  const candidateName = candidateLine.split("|")[1];
  assert.equal(candidateName.length, 80);
});

// ── parseMatchReply ──────────────────────────────────────────────────────

test("parseMatchReply parses a clean JSON reply", () => {
  const text = `{"matchId":"p1","matchName":"Ama Boateng","reason":"Great fit."}`;
  assert.deepEqual(parseMatchReply(text, ["p1", "p2"]), {
    matchId: "p1",
    matchName: "Ama Boateng",
    reason: "Great fit.",
  });
});

test("parseMatchReply finds the first {...} even with surrounding prose/markdown fences", () => {
  const text = "Sure, here you go:\n```json\n{\"matchId\":\"p1\",\"matchName\":\"Ama\",\"reason\":\"ok\"}\n```\nHope that helps!";
  assert.deepEqual(parseMatchReply(text, ["p1"]), { matchId: "p1", matchName: "Ama", reason: "ok" });
});

test("parseMatchReply rejects a matchId not present in candidateIds", () => {
  const text = `{"matchId":"not-offered","matchName":"Someone","reason":"..."}`;
  assert.equal(parseMatchReply(text, ["p1", "p2"]), null);
});

test("parseMatchReply rejects malformed JSON", () => {
  assert.equal(parseMatchReply("not json at all", ["p1"]), null);
  assert.equal(parseMatchReply("", ["p1"]), null);
});

test("parseMatchReply rejects an overlong matchName or reason", () => {
  const tooLongName = JSON.stringify({ matchId: "p1", matchName: "a".repeat(101), reason: "ok" });
  assert.equal(parseMatchReply(tooLongName, ["p1"]), null);
  const tooLongReason = JSON.stringify({ matchId: "p1", matchName: "ok", reason: "a".repeat(401) });
  assert.equal(parseMatchReply(tooLongReason, ["p1"]), null);
});

test("parseMatchReply rejects non-string matchName/reason", () => {
  const text = JSON.stringify({ matchId: "p1", matchName: 123, reason: "ok" });
  assert.equal(parseMatchReply(text, ["p1"]), null);
});

// ── rateDecision ─────────────────────────────────────────────────────────

test("rateDecision: minute window allows up to perMinute then blocks", () => {
  const limits = { perMinute: 3, minuteMs: 60000, perDay: 15 };
  let state = null;
  const base = Date.UTC(2026, 10, 24, 10, 0, 0);
  for (let i = 0; i < 3; i++) {
    const d = rateDecision(state, base + i * 1000, limits);
    assert.equal(d.allowed, true, `attempt ${i + 1} should be allowed`);
    state = d.nextState;
  }
  const blocked = rateDecision(state, base + 3000, limits);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "minute");
});

test("rateDecision: minute window resets once minuteMs has elapsed", () => {
  const limits = { perMinute: 3, minuteMs: 60000, perDay: 15 };
  const base = Date.UTC(2026, 10, 24, 10, 0, 0);
  let state = null;
  for (let i = 0; i < 3; i++) {
    state = rateDecision(state, base + i * 1000, limits).nextState;
  }
  assert.equal(rateDecision(state, base + 3000, limits).allowed, false);
  const afterWindow = rateDecision(state, base + 60000, limits);
  assert.equal(afterWindow.allowed, true);
  assert.equal(afterWindow.nextState.minCount, 1);
});

test("rateDecision: day window allows up to perDay across many minute windows then blocks", () => {
  const limits = { perMinute: 100, minuteMs: 60000, perDay: 15 };
  const base = Date.UTC(2026, 10, 24, 0, 0, 0);
  let state = null;
  for (let i = 0; i < 15; i++) {
    const d = rateDecision(state, base + i * 70000, limits); // spaced > a minute apart
    assert.equal(d.allowed, true, `attempt ${i + 1} should be allowed`);
    state = d.nextState;
  }
  const blocked = rateDecision(state, base + 15 * 70000, limits);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "day");
});

test("rateDecision: day window resets on a new UTC day", () => {
  const limits = { perMinute: 100, minuteMs: 60000, perDay: 2 };
  const day1 = Date.UTC(2026, 10, 24, 23, 59, 0);
  let state = rateDecision(null, day1, limits).nextState;
  state = rateDecision(state, day1 + 1000, limits).nextState;
  assert.equal(rateDecision(state, day1 + 2000, limits).allowed, false);
  const day2 = Date.UTC(2026, 10, 25, 0, 0, 1);
  const next = rateDecision(state, day2, limits);
  assert.equal(next.allowed, true);
  assert.equal(next.nextState.dayCount, 1);
});

test("rateDecision: a blocked attempt does not increment either counter", () => {
  const limits = { perMinute: 1, minuteMs: 60000, perDay: 15 };
  const base = Date.UTC(2026, 10, 24, 10, 0, 0);
  const first = rateDecision(null, base, limits);
  assert.equal(first.allowed, true);
  const blocked = rateDecision(first.nextState, base + 1000, limits);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.nextState.minCount, first.nextState.minCount);
  assert.equal(blocked.nextState.dayCount, first.nextState.dayCount);
});
