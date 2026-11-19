"use strict";

// Tests the programme data and its pure helpers, which live inside index.html between the
// "// BEGIN schedule-data" and "// END schedule-data" marker comments.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function loadSchedule() {
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  const start = html.indexOf("// BEGIN schedule-data");
  const end = html.indexOf("// END schedule-data");
  assert.ok(start > -1 && end > start, "schedule-data markers not found in index.html");
  const block = html.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${block}\nreturn { SC, SCHEDULE, sessionGroups, sessionNameLines };`)();
}

const { SC, SCHEDULE, sessionGroups, sessionNameLines } = loadSchedule();

// schedTime12 lives in the safe-helpers block of index.html
function loadTimeHelper() {
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  const start = html.indexOf("// BEGIN safe-helpers");
  const end = html.indexOf("// END safe-helpers");
  assert.ok(start > -1 && end > start, "safe-helpers markers not found in index.html");
  // eslint-disable-next-line no-new-func
  return new Function(`${html.slice(start, end)}\nreturn schedTime12;`)();
}
const schedTime12 = loadTimeHelper();

// Stored 24-hour time -> 12-hour display text. Covers every example in the spec and every time in SCHEDULE.
const TIME_TABLE = [
  ["09:00", "9:00 am"],
  ["14:00", "2:00 pm"],
  ["18:30", "6:30 pm"],
  ["12:00", "12:00 pm"],
  ["21:30", "9:30 pm"],
  ["17:30", "5:30 pm"],
  ["19:00", "7:00 pm"],
  ["00:15", "12:15 am"],
  ["09:00–09:40", "9:00 – 9:40 am"],
  ["12:00–14:00", "12:00 – 2:00 pm"],
  ["18:30–22:00", "6:30 – 10:00 pm"],
  ["11:00–12:00", "11:00 am – 12:00 pm"],
  ["09:40–10:40", "9:40 – 10:40 am"],
  ["10:40–11:00", "10:40 – 11:00 am"],
  ["11:00–11:20", "11:00 – 11:20 am"],
  ["11:20–12:00", "11:20 am – 12:00 pm"],
  ["14:00–15:00", "2:00 – 3:00 pm"],
  ["15:15–16:15", "3:15 – 4:15 pm"],
  ["16:30–17:00", "4:30 – 5:00 pm"],
  ["17:00–18:00", "5:00 – 6:00 pm"],
  ["09:30–10:30", "9:30 – 10:30 am"],
  ["10:45–11:45", "10:45 – 11:45 am"],
];

const KINDS = ["Speaker", "Facilitator", "Master of Ceremony"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d(–([01]\d|2[0-3]):[0-5]\d)?$/; // HH:MM or HH:MM–HH:MM (en dash)
const startMin = (t) => { const [h, m] = t.slice(0, 5).split(":").map(Number); return h * 60 + m; };
const allSessions = () => SCHEDULE.flatMap((d) => d.sessions);
const dayByDate = (date) => {
  const d = SCHEDULE.find((x) => x.date === date);
  assert.ok(d, `day ${date} not found`);
  return d;
};
// Every string anywhere in SCHEDULE, with its path, for the text checks
function allStrings(value, at = "SCHEDULE", out = []) {
  if (typeof value === "string") out.push([at, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => allStrings(v, `${at}[${i}]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) allStrings(v, `${at}.${k}`, out);
  return out;
}

test("schedule has the three days Mon 23, Tue 24 and Wed 25 Nov", () => {
  assert.deepEqual(SCHEDULE.map((d) => d.date), ["Mon 23 Nov", "Tue 24 Nov", "Wed 25 Nov"]);
  for (const d of SCHEDULE) {
    assert.ok(d.day && d.dayShort && Array.isArray(d.sessions) && d.sessions.length, `day ${d.date} is incomplete`);
  }
});

test("a: every session has a title, a valid time, a location and a known type", () => {
  for (const s of allSessions()) {
    const where = `${s.time} ${s.title}`;
    assert.equal(typeof s.title, "string");
    assert.ok(s.title.trim(), `empty title at ${where}`);
    assert.match(s.time, TIME, `bad time at ${where}`);
    assert.equal(typeof s.loc, "string");
    assert.ok(s.loc.trim(), `empty loc at ${where}`);
    assert.ok(Object.prototype.hasOwnProperty.call(SC, s.type), `unknown type "${s.type}" at ${where}`);
    if ("desc" in s) assert.ok(typeof s.desc === "string" && s.desc.trim(), `empty desc at ${where}`);
    if ("people" in s) assert.ok(Array.isArray(s.people) && s.people.length, `empty people at ${where}`);
  }
});

test("b: start times ascend within each day", () => {
  for (const d of SCHEDULE) {
    for (let i = 1; i < d.sessions.length; i++) {
      const prev = d.sessions[i - 1], cur = d.sessions[i];
      assert.ok(startMin(cur.time) > startMin(prev.time), `${d.date}: ${cur.time} comes after ${prev.time}`);
    }
  }
});

test("c: every person has a known kind, a name and a role", () => {
  let count = 0;
  for (const s of allSessions()) {
    for (const p of s.people || []) {
      count++;
      assert.deepEqual(Object.keys(p).sort(), ["kind", "name", "role"], `extra or missing field in ${s.title}`);
      assert.ok(KINDS.includes(p.kind), `bad kind "${p.kind}" in ${s.title}`);
      assert.ok(typeof p.name === "string" && p.name.trim(), `empty name in ${s.title}`);
      assert.ok(typeof p.role === "string" && p.role.trim(), `empty role for ${p.name} in ${s.title}`);
    }
  }
  assert.ok(count > 0, "no people at all");
});

test("d: no string contains <, > or an em dash", () => {
  for (const [at, v] of allStrings(SCHEDULE)) {
    assert.doesNotMatch(v, /[<>—]/, `forbidden character at ${at}`);
  }
});

test("e: removed sessions stay removed and the key facts hold", () => {
  const wed = dayByDate("Wed 25 Nov");
  for (const s of wed.sessions) {
    assert.doesNotMatch(s.title, /Breakfast/, `Wednesday still has: ${s.title}`);
    assert.doesNotMatch(s.title, /AfCFTA/, `Wednesday still has: ${s.title}`);
  }
  for (const s of allSessions()) {
    assert.ok(!s.title.includes("Farewell"), `title still says Farewell: ${s.title}`);
    assert.ok(!s.title.includes("Visit to the Startup Villages"), `title still mentions the Startup Villages: ${s.title}`);
  }
  const tue = dayByDate("Tue 24 Nov");
  const pres = tue.sessions.find((s) => s.time.startsWith("11:00"));
  assert.ok(pres, "no Tuesday session at 11:00");
  assert.equal(pres.title, "Presidential Opening Addresses");
  assert.deepEqual(
    pres.people.filter((p) => p.kind === "Speaker").map((p) => p.name),
    ["Thomas Schäfer", "H.E. Dr. Frank-Walter Steinmeier", "H.E. John Dramani Mahama"],
  );
  const mon = dayByDate("Mon 23 Nov");
  assert.equal(mon.sessions.length, 1);
  assert.ok(mon.sessions[0].people.some((p) => p.name === "Hon. Samuel Okudzeto Ablakwa"), "Monday is missing Hon. Samuel Okudzeto Ablakwa");
});

test("f: no tbc, Sulemani, Residency, Dr Augusto or Mr. names, and the Tuesday 15:15 panel has 3 Speakers and 1 Facilitator", () => {
  for (const [at, v] of allStrings(SCHEDULE)) {
    assert.doesNotMatch(v, /tbc/i, `tbc at ${at}`);
    assert.doesNotMatch(v, /sulemani/i, `Sulemani at ${at}`);
    assert.ok(!v.includes("Residency"), `Residency at ${at}`);
    assert.ok(!v.includes("Dr Augusto"), `Dr Augusto at ${at}`);
  }
  for (const s of allSessions()) {
    for (const p of s.people || []) assert.ok(!p.name.startsWith("Mr."), `name starts with Mr.: ${p.name}`);
  }
  const s = dayByDate("Tue 24 Nov").sessions.find((x) => x.time.startsWith("15:15"));
  assert.ok(s, "no Tuesday session at 15:15");
  assert.equal(s.people.filter((p) => p.kind === "Speaker").length, 3);
  assert.equal(s.people.filter((p) => p.kind === "Facilitator").length, 1);
  assert.equal(s.people.length, 4);
});

test("both lunch sessions are titled exactly Lunch Break", () => {
  const lunches = SCHEDULE.flatMap((d) => d.sessions.filter((s) => s.type === "lunch").map((s) => [d.date, s]));
  assert.deepEqual(lunches.map(([date, s]) => `${date} ${s.time}`), ["Tue 24 Nov 12:00–14:00", "Wed 25 Nov 12:00–14:00"]);
  for (const [date, s] of lunches) assert.equal(s.title, "Lunch Break", `${date} lunch title`);
});

test("schedTime12 converts the conversion table", () => {
  assert.ok(TIME_TABLE.length >= 12);
  for (const [stored, shown] of TIME_TABLE) assert.equal(schedTime12(stored), shown, stored);
});

test("schedTime12 table includes every distinct time in SCHEDULE", () => {
  const inTable = new Set(TIME_TABLE.map(([stored]) => stored));
  for (const t of new Set(allSessions().map((s) => s.time))) assert.ok(inTable.has(t), `${t} is missing from TIME_TABLE`);
});

test("every rendered schedule time is 12-hour and says am or pm", () => {
  for (const s of allSessions()) {
    const shown = schedTime12(s.time);
    assert.doesNotMatch(shown, /1[3-9]:|2[0-3]:|00:/, `${s.time} shown as ${shown}`);
    assert.match(shown, /am|pm/, `${s.time} shown as ${shown}`);
  }
});

test("schedTime12 returns unparseable input unchanged and never throws", () => {
  for (const v of ["", "tbd", "9:00", "09:00-10:00", "24:00", "09:60", "09:00–25:00", "09:00 – 10:00", " 09:00", "09:00–"]) {
    assert.equal(schedTime12(v), v, JSON.stringify(v));
  }
  for (const v of [undefined, null, 900, {}]) assert.doesNotThrow(() => schedTime12(v));
  assert.equal(schedTime12(undefined), undefined);
});

test("g: collapsed lines list names only, grouped, never a role", () => {
  for (const s of allSessions()) {
    const lines = sessionNameLines(s.people);
    const text = lines.join("\n");
    for (const p of s.people || []) {
      assert.ok(text.includes(p.name), `${p.name} missing from the collapsed lines of ${s.title}`);
      assert.ok(!text.includes(p.role), `role of ${p.name} shown collapsed in ${s.title}`);
    }
    if (!s.people) assert.deepEqual(lines, []);
  }
});

test("g: group labels are singular for one person and plural for more, in a fixed order", () => {
  const people = [
    { kind: "Master of Ceremony", name: "M", role: "Role M" },
    { kind: "Facilitator", name: "F1", role: "Role F1" },
    { kind: "Speaker", name: "S1", role: "Role S1" },
    { kind: "Facilitator", name: "F2", role: "Role F2" },
  ];
  assert.deepEqual(sessionNameLines(people), ["Speaker: S1", "Facilitators: F1, F2", "Master of Ceremony: M"]);
  assert.deepEqual(sessionNameLines([{ kind: "Speaker", name: "A", role: "x" }, { kind: "Speaker", name: "B", role: "y" }]), ["Speakers: A, B"]);
  assert.deepEqual(sessionGroups(people).map((g) => g.label), ["Speaker", "Facilitators", "Master of Ceremony"]);
});

test("g: helpers ignore missing, malformed and unknown entries", () => {
  assert.deepEqual(sessionNameLines(undefined), []);
  assert.deepEqual(sessionNameLines("Speaker"), []);
  assert.deepEqual(sessionNameLines([null, {}, { kind: "Speaker", name: "  " }, { kind: "Guest", name: "X", role: "r" }]), []);
});
