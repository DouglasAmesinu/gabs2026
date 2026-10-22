"use strict";

// Limits for admin announcements (adminPostAnnouncement).
const TITLE_MAX = 60;
const BODY_MAX = 300;
const EXPIRES_MAX_MINUTES = 1440;
// Raw strings longer than this are refused before any cleaning work
const RAW_MAX = 2000;

/**
 * Clean free text for an announcement: strings only (anything else
 * becomes ""), control characters removed except newline (tabs become
 * spaces), runs of spaces collapsed, spaces around newlines and more
 * than one blank line dropped, trimmed, then clipped to `max` code
 * points so emoji are never split.
 * @param {*} v
 * @param {number} max
 * @returns {string}
 */
function cleanText(v, max) {
  if (typeof v !== "string") return "";
  let s = v
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (Number.isFinite(max)) {
    const n = Math.max(0, Math.floor(max));
    const cps = Array.from(s);
    if (cps.length > n) s = cps.slice(0, n).join("").trim();
  }
  return s;
}

const length = (s) => Array.from(s).length;

/**
 * Validate adminPostAnnouncement input. Returns the clean announcement,
 * or null when the request must be refused. Title: 1-60 characters on
 * one line. Body: 0-300 characters. pinned: boolean, default false.
 * expiresInMinutes: integer 0-1440, 0 (the default) means never.
 * alert: true only for the boolean true; anything else is false (never
 * a reason to refuse). Text that is too long is refused, not clipped.
 * @param {*} data request.data
 * @returns {{title:string, body:string, pinned:boolean, expiresInMinutes:number, alert:boolean}|null}
 */
function validateAnnouncement(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const { title, body, pinned, expiresInMinutes } = data;

  if (typeof title !== "string" || title.length > RAW_MAX) return null;
  const t = cleanText(title.replace(/[\r\n]+/g, " "), Infinity);
  if (length(t) < 1 || length(t) > TITLE_MAX) return null;

  let b = "";
  if (body !== undefined && body !== null) {
    if (typeof body !== "string" || body.length > RAW_MAX) return null;
    b = cleanText(body, Infinity);
    if (length(b) > BODY_MAX) return null;
  }

  let pin = false;
  if (pinned !== undefined && pinned !== null) {
    if (typeof pinned !== "boolean") return null;
    pin = pinned;
  }

  let exp = 0;
  if (expiresInMinutes !== undefined && expiresInMinutes !== null) {
    if (!Number.isInteger(expiresInMinutes) || expiresInMinutes < 0 || expiresInMinutes > EXPIRES_MAX_MINUTES) return null;
    exp = expiresInMinutes;
  }

  return { title: t, body: b, pinned: pin, expiresInMinutes: exp, alert: data.alert === true };
}

const ANNOUNCEMENT_ID_RE = /^[A-Za-z0-9]{1,40}$/;

/**
 * Validate adminDeleteAnnouncement input: {id} with 1-40 letters or digits.
 * @param {*} data request.data
 * @returns {string|null} the id, or null
 */
function validateAnnouncementId(data) {
  if (!data || typeof data !== "object") return null;
  const id = data.id;
  return typeof id === "string" && ANNOUNCEMENT_ID_RE.test(id) ? id : null;
}

module.exports = {
  cleanText,
  validateAnnouncement,
  validateAnnouncementId,
  TITLE_MAX,
  BODY_MAX,
  EXPIRES_MAX_MINUTES,
};
