"use strict";

// Calls the Cloudflare Pages Function in functions/ics.js (an ES module) and checks
// the 15-minute reminder (VALARM) in the calendar file it returns.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");

const ICS_PATH = path.join(__dirname, "..", "..", "functions", "ics.js");
const loadIcs = () => import(pathToFileURL(ICS_PATH).href);

const LINK =
  "https://gabsconnect.com/ics?d=20261124&s=10:30&u=30&l=Cabana%20First%20Floor&a=Ama%20Mensah&b=Hans%20Mueller&t=Tue%2024%20Nov";

async function get(url) {
  const { onRequestGet } = await loadIcs();
  return onRequestGet({ request: new Request(url) });
}

const ALARM = [
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "DESCRIPTION:GABS 2026 meeting in 15 minutes",
  "TRIGGER:-PT15M",
  "END:VALARM",
].join("\r\n");

test("/ics returns one event with a 15-minute reminder", async () => {
  const res = await get(LINK);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type"), /^text\/calendar/);
  const body = await res.text();

  assert.ok(body.includes(ALARM), "the VALARM block, lines joined with \\r\\n");
  assert.ok(body.includes(ALARM + "\r\nEND:VEVENT"), "the alarm sits just before END:VEVENT");
  assert.equal(body.split("BEGIN:VEVENT").length - 1, 1, "a single BEGIN:VEVENT");
  assert.equal(body.split("BEGIN:VALARM").length - 1, 1, "a single alarm");
  assert.match(body, /\r\nDTSTART:20261124T103000Z\r\n/);
  assert.match(body, /\r\nDTEND:20261124T110000Z\r\n/);
  // The alarm is inside the event, the event inside the calendar
  const iEvent = body.indexOf("BEGIN:VEVENT");
  const iAlarm = body.indexOf("BEGIN:VALARM");
  const iEnd = body.indexOf("END:VEVENT");
  assert.ok(iEvent < iAlarm && iAlarm < iEnd && iEnd < body.indexOf("END:VCALENDAR"));
  // Every line ends with CRLF: no bare LF anywhere
  assert.equal(body.replace(/\r\n/g, "").includes("\n"), false);
});

test("/ics still refuses a malformed link", async () => {
  const res = await get("https://gabsconnect.com/ics?d=2026&s=xx");
  assert.equal(res.status, 400);
});
