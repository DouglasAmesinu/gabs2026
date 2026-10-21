"use strict";

const { splitThreadId } = require("./slots");

// Pure helpers for push alerts (registerPushToken, notifyNewMessage and
// friends). No I/O here: index.js reads and writes Firestore and FCM.

const TOKEN_RE = /^[A-Za-z0-9_:\-]+$/;
const TOKEN_MIN = 100;
const TOKEN_MAX = 400;
const SENDER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LAST_SENT_MAX = 50;
const NAME_MAX = 40;
const NAME_FALLBACK = "a participant";
const ALERT_TITLE = "GABS Connect";
// FCM error codes that mean the token will never work again
const DEAD_TOKEN_CODES = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);

/**
 * An FCM registration token: 100-400 characters of letters, digits,
 * "_", ":" or "-".
 * @param {*} t
 * @returns {boolean}
 */
function validToken(t) {
  return typeof t === "string" && t.length >= TOKEN_MIN && t.length <= TOKEN_MAX && TOKEN_RE.test(t);
}

/**
 * The stored list with anything malformed dropped (Firestore data is
 * not trusted blindly).
 * @param {*} list
 * @returns {{t:string, at:number}[]}
 */
function cleanList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e === "object" && validToken(e.t))
    .map((e) => ({ t: e.t, at: Number.isFinite(e.at) ? e.at : 0 }));
}

/**
 * A new token list with `token` at the front (stamped nowMs), no
 * duplicates, at most `max` entries. An invalid token leaves the
 * (cleaned) list as it was.
 * @param {*} list stored [{t, at}]
 * @param {*} token
 * @param {number} nowMs
 * @param {number} [max]
 * @returns {{t:string, at:number}[]}
 */
function addToken(list, token, nowMs, max = 5) {
  const cur = cleanList(list);
  const cap = Number.isInteger(max) && max > 0 ? max : 5;
  if (!validToken(token)) return cur.slice(0, cap);
  const seen = new Set([token]);
  const rest = cur.filter((e) => (seen.has(e.t) ? false : (seen.add(e.t), true)));
  return [{ t: token, at: Number.isFinite(nowMs) ? nowMs : 0 }, ...rest].slice(0, cap);
}

/**
 * A new token list without `token`.
 * @param {*} list
 * @param {*} token
 * @returns {{t:string, at:number}[]}
 */
function removeToken(list, token) {
  return cleanList(list).filter((e) => e.t !== token);
}

/**
 * The stored lastSent map ({senderId: ms}) with malformed entries
 * dropped, keeping the `max` newest.
 * @param {*} lastSent
 * @param {number} [max]
 * @returns {Object<string, number>}
 */
function pruneLastSent(lastSent, max = LAST_SENT_MAX) {
  if (!lastSent || typeof lastSent !== "object" || Array.isArray(lastSent)) return {};
  const entries = Object.entries(lastSent)
    .filter(([k, v]) => SENDER_ID_RE.test(k) && Number.isFinite(v))
    .sort((a, b) => b[1] - a[1])
    .slice(0, max);
  // fromEntries defines own properties, so an id such as "__proto__" stays a plain key
  return Object.fromEntries(entries);
}

/**
 * Whether to alert the recipient about a message from senderId: never
 * when muted, and at most once per minGapMs per sender. nextLastSent is
 * what to store back (pruned to the 50 newest senders).
 * @param {{muted?:boolean, lastSent?:Object<string,number>, senderId:string, nowMs:number, minGapMs?:number}} p
 * @returns {{send:boolean, nextLastSent:Object<string,number>}}
 */
function shouldSend({ muted, lastSent, senderId, nowMs, minGapMs = 60000 } = {}) {
  const prev = pruneLastSent(lastSent, Infinity);
  const keep = () => pruneLastSent(prev);
  if (muted === true || !SENDER_ID_RE.test(String(senderId)) || typeof senderId !== "string" || !Number.isFinite(nowMs)) {
    return { send: false, nextLastSent: keep() };
  }
  const last = Object.prototype.hasOwnProperty.call(prev, senderId) ? prev[senderId] : null;
  // A stamp in the future (clock skew) does not suppress alerts
  if (last !== null && last <= nowMs && nowMs - last < minGapMs) {
    return { send: false, nextLastSent: keep() };
  }
  const next = Object.entries(prev).filter(([k]) => k !== senderId);
  next.push([senderId, nowMs]);
  return { send: true, nextLastSent: pruneLastSent(Object.fromEntries(next)) };
}

/**
 * A display name safe for an alert: strings only, control characters
 * removed, whitespace collapsed, at most 40 characters (never splitting
 * an emoji), "a participant" when nothing is left.
 * @param {*} s
 * @returns {string}
 */
function cleanName(s) {
  if (typeof s !== "string") return NAME_FALLBACK;
  const str = s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cps = Array.from(str);
  const out = (cps.length > NAME_MAX ? cps.slice(0, NAME_MAX).join("") : str).trim();
  return out || NAME_FALLBACK;
}

/**
 * The data payload for one alert. kind "meeting" announces a meeting
 * request; anything else is a message.
 * @param {{kind?:string, senderName?:*, senderId:*}} p
 * @returns {{title:string, body:string, tag:string, url:string, kind:string}|null}
 *   null when senderId is not a plain id
 */
function buildAlert({ kind, senderName, senderId } = {}) {
  if (typeof senderId !== "string" || !SENDER_ID_RE.test(senderId)) return null;
  const k = kind === "meeting" ? "meeting" : "message";
  const name = cleanName(senderName);
  return {
    title: ALERT_TITLE,
    body: k === "meeting" ? `New meeting request from ${name}` : `New message from ${name}`,
    tag: "msg-" + senderId,
    url: "/#chat=" + senderId,
    kind: k,
  };
}

/**
 * The participant in thread `threadId` who is not `fromId`, or null when
 * the thread id is malformed, fromId is not one of its two ids, or the
 * other id is not a plain id.
 * @param {*} threadId
 * @param {*} fromId
 * @returns {string|null}
 */
function recipientOf(threadId, fromId) {
  if (typeof threadId !== "string" || typeof fromId !== "string") return null;
  const ids = splitThreadId(threadId);
  if (!ids) return null;
  const [a, b] = ids;
  if (a === b) return null;
  const other = fromId === a ? b : fromId === b ? a : null;
  return other && SENDER_ID_RE.test(other) ? other : null;
}

/**
 * Tokens FCM reported as permanently dead, from sendEachForMulticast's
 * responses (same order as the tokens sent).
 * @param {string[]} tokens
 * @param {*} responses
 * @returns {string[]}
 */
function deadTokens(tokens, responses) {
  if (!Array.isArray(tokens) || !Array.isArray(responses)) return [];
  const out = [];
  responses.forEach((r, i) => {
    const code = r && !r.success && r.error && r.error.code;
    if (code && DEAD_TOKEN_CODES.has(code) && typeof tokens[i] === "string") out.push(tokens[i]);
  });
  return out;
}

/**
 * Fixed-window call limiter for the push callables, stored like the
 * sign-in limiter ({count, windowStart}). Counts every allowed call.
 * @param {{count:number, windowStart:number}|null|undefined} existing
 * @param {number} nowMs
 * @param {number} limit calls per window
 * @param {number} [windowMs] default one hour
 * @returns {{allowed:boolean, next:{count:number, windowStart:number}}}
 */
function callWindow(existing, nowMs, limit, windowMs = 60 * 60 * 1000) {
  const active =
    !!existing &&
    typeof existing.count === "number" &&
    typeof existing.windowStart === "number" &&
    existing.windowStart <= nowMs &&
    nowMs - existing.windowStart < windowMs;
  if (!active) return { allowed: limit > 0, next: { count: limit > 0 ? 1 : 0, windowStart: nowMs } };
  if (existing.count >= limit) return { allowed: false, next: { count: existing.count, windowStart: existing.windowStart } };
  return { allowed: true, next: { count: existing.count + 1, windowStart: existing.windowStart } };
}

module.exports = {
  validToken,
  addToken,
  removeToken,
  shouldSend,
  cleanName,
  buildAlert,
  recipientOf,
  deadTokens,
  callWindow,
  LAST_SENT_MAX,
  DEAD_TOKEN_CODES,
};
