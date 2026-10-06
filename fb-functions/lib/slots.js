"use strict";

const DAY_RE = /^\d{8}$/;
const START_RE = /^\d{1,2}:\d{2}$/;

/**
 * @param {string} t "HH:MM"
 * @returns {number} minutes since midnight
 */
function timeToMins(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * @param {number} m minutes since midnight
 * @returns {string} "HH:MM", zero-padded (mirrors the client's minsToTime)
 */
function minsToTime(m) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Build the booked-slot record to store on the *other* participant
 * (and on yourself, from their side) once a meeting is accepted.
 * @param {{day?:string, start?:string, dur?:number}} meeting
 * @param {string} otherId the other participant's uid
 * @param {string} meetingId the message id this slot came from
 * @returns {{day:string, start:string, end:string, with:string, meetingId:string}|null}
 *   null if meeting.day/start are missing or malformed
 */
function buildSlot(meeting, otherId, meetingId) {
  if (!meeting) return null;
  const day = String(meeting.day || "");
  const start = String(meeting.start || "");
  if (!DAY_RE.test(day) || !START_RE.test(start)) return null;
  const end = minsToTime(timeToMins(start) + (meeting.dur || 30));
  return { day, start, end, with: otherId, meetingId };
}

module.exports = { timeToMins, minsToTime, buildSlot, DAY_RE, START_RE };
