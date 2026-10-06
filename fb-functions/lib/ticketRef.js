"use strict";

// GABS + 6 to 40 chars of A-Z, 0-9, or "-" (after normalisation).
const REF_RE = /^GABS[A-Z0-9-]{6,40}$/;

// Unicode dash variants (hyphen, non-breaking hyphen, figure dash, en
// dash, em dash, horizontal bar, minus sign) folded to a plain "-".
const DASH_RE = /[‐-―−]/g;

/**
 * Normalise a raw ticket reference: trim, strip all whitespace, fold
 * unicode dash variants to a plain "-", then uppercase.
 * @param {*} raw
 * @returns {string}
 */
function normalizeRef(raw) {
  let s = raw == null ? "" : String(raw);
  s = s.trim();
  s = s.replace(/\s+/g, "");
  s = s.replace(DASH_RE, "-");
  s = s.toUpperCase();
  return s;
}

/**
 * @param {string} ref an already-normalised reference
 * @returns {boolean}
 */
function isValidRef(ref) {
  return REF_RE.test(ref);
}

module.exports = { normalizeRef, isValidRef, REF_RE };
