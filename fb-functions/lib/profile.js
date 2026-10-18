"use strict";

// Field limits for the profile returned by signInWithTicket.
const TEXT_LIMITS = {
  salutation: 20,
  name: 120,
  company: 120,
  title: 120,
  sector: 60,
  country: 60,
  ptype: 40,
  website: 200,
  linkedin: 200,
  bio: 600,
  av: 3,
  phone: 40,
  status: 20,
};
const PHOTO_MAX = 600;
const INTERESTS_MAX = 9;
const INTEREST_LEN = 60;
const SLOTS_MAX = 50;
const SLOT_KEYS = ["day", "start", "end", "with", "meetingId"];
const SLOT_LEN = 40;

/**
 * A string clipped to `max` UTF-16 units without leaving half of a
 * surrogate pair at the end. Numbers and booleans become their string
 * form; anything else (objects, arrays, null) becomes "".
 * @param {*} v
 * @param {number} max
 * @returns {string}
 */
function clip(v, max) {
  let s;
  if (typeof v === "string") s = v;
  else if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean") s = String(v);
  else return "";
  if (s.length <= max) return s;
  s = s.slice(0, max);
  const last = s.charCodeAt(s.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? s.slice(0, -1) : s;
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Pure: the participant fields the client needs to enter the app,
 * each coerced to its expected type and clipped. Only the listed keys,
 * no timestamps, nothing nested beyond bookedSlots' flat strings.
 * @param {*} doc participant document data
 * @returns {object}
 */
function pickProfile(doc) {
  const d = isPlainObject(doc) ? doc : {};
  const out = {};
  for (const [k, max] of Object.entries(TEXT_LIMITS)) out[k] = clip(d[k], max);

  out.interests = Array.isArray(d.interests)
    ? d.interests.filter((i) => typeof i === "string").slice(0, INTERESTS_MAX).map((i) => clip(i, INTEREST_LEN))
    : [];

  const photo = typeof d.photoURL === "string" ? d.photoURL : "";
  out.photoURL = photo.startsWith("https://") && photo.length <= PHOTO_MAX ? photo : "";

  out.bookedSlots = Array.isArray(d.bookedSlots)
    ? d.bookedSlots
        .filter(isPlainObject)
        .slice(0, SLOTS_MAX)
        .map((s) => {
          const slot = {};
          for (const k of SLOT_KEYS) slot[k] = clip(s[k], SLOT_LEN);
          return slot;
        })
    : [];

  return out;
}

module.exports = { pickProfile, clip, TEXT_LIMITS };
