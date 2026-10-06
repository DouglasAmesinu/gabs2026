"use strict";

// ── Input validation ─────────────────────────────────────────────────────
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * @param {*} data the raw request.data from the callable
 * @returns {string[]|null} the cleaned candidateIds array, or null if invalid
 */
function validateInput(data) {
  if (!data || typeof data !== "object") return null;
  const raw = data.candidateIds;
  if (!Array.isArray(raw)) return null;
  if (raw.length < 1 || raw.length > 40) return null;
  const seen = new Set();
  const cleaned = [];
  for (const item of raw) {
    if (typeof item !== "string" || !ID_RE.test(item)) return null;
    if (seen.has(item)) return null; // must be unique
    seen.add(item);
    cleaned.push(item);
  }
  return cleaned;
}

// ── Field cleaning ───────────────────────────────────────────────────────
/**
 * Coerce to string, collapse all whitespace (including newlines) to a
 * single space, trim, and cut to `max` characters. Used on every
 * profile field that reaches the prompt so nothing in a name/bio/etc.
 * can inject newlines or run past its budget.
 * @param {*} value
 * @param {number} max
 * @returns {string}
 */
function cleanField(value, max) {
  let s = value == null ? "" : String(value);
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}

const FIELD_MAX = 80; // name/title/company/sector/country/ptype
const BIO_MAX = 300;
const INTEREST_MAX = 60; // each interest
const MAX_INTERESTS = 8;

function cleanInterests(interests) {
  const arr = Array.isArray(interests) ? interests : [];
  return arr
    .slice(0, MAX_INTERESTS)
    .map((i) => cleanField(i, INTEREST_MAX))
    .filter(Boolean);
}

function profileLine(p) {
  const prof = p || {};
  return [
    cleanField(prof.name, FIELD_MAX),
    cleanField(prof.title, FIELD_MAX),
    cleanField(prof.company, FIELD_MAX),
    cleanField(prof.sector, FIELD_MAX),
    cleanField(prof.country, FIELD_MAX),
    cleanInterests(prof.interests).join(","),
    cleanField(prof.bio, BIO_MAX),
    cleanField(prof.ptype, FIELD_MAX),
  ].join("|");
}

// ── Prompt building ──────────────────────────────────────────────────────
/**
 * Builds exactly the same instruction text the client used to build
 * itself (see claudeMatch in index.html), with every field run
 * through cleanField/cleanInterests first.
 * @param {object} me my own profile
 * @param {Array<{id:string}>} candidates candidate profiles, each with an id
 * @returns {string}
 */
function buildPrompt(me, candidates) {
  const myProfile = `ME: ${profileLine(me)}`;
  const otherProfiles = (candidates || [])
    .map((p, i) => `${i + 1}: ID=${p.id}|${profileLine(p)}`)
    .join("\n");

  return `You are a B2B matchmaker for GABS 2026, German-African Business Summit, Accra Ghana, Nov 23-25.

${myProfile}

OTHER PARTICIPANTS:
${otherProfiles}

Find the single best match. Prioritise: German-African pairing, complementary needs (investor+startup, market entry seeker+local expert), overlapping interests, senior titles.

Respond ONLY with valid JSON, no other text:
{"matchId":"<exact id>","matchName":"<name>","reason":"<2 sentences max, conversational tone, no em dashes, specific to their actual profiles>"}`;
}

// ── Reply parsing ────────────────────────────────────────────────────────
/**
 * Finds the first block in an Anthropic response's `content` array
 * whose type is "text" (never content[0] blindly — a response can
 * start with a {type:"thinking"} block) and returns its text.
 * @param {Array<{type?:string, text?:string}>} content
 * @returns {string|null}
 */
function extractText(content) {
  if (!Array.isArray(content)) return null;
  const block = content.find((b) => b && b.type === "text" && typeof b.text === "string");
  return block ? block.text : null;
}

/**
 * Extracts the first balanced {...} block from `text` (brace-depth
 * counted, so it's unaffected by markdown fences or trailing prose).
 * @param {string} text
 * @returns {string|null}
 */
function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * @param {string} text the model's raw reply text
 * @param {string[]} candidateIds the ids that were actually offered
 * @returns {{matchId:string, matchName:string, reason:string}|null}
 */
function parseMatchReply(text, candidateIds) {
  if (typeof text !== "string" || !Array.isArray(candidateIds)) return null;
  const jsonStr = extractFirstJsonObject(text);
  if (!jsonStr) return null;
  let obj;
  try {
    obj = JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const { matchId, matchName, reason } = obj;
  if (typeof matchId !== "string" || !candidateIds.includes(matchId)) return null;
  if (typeof matchName !== "string" || matchName.length > 100) return null;
  if (typeof reason !== "string" || reason.length > 400) return null;
  return { matchId, matchName, reason };
}

// ── Rate limiting ────────────────────────────────────────────────────────
const DEFAULT_LIMITS = { perMinute: 3, minuteMs: 60 * 1000, perDay: 15 };

/**
 * UTC calendar-day key, e.g. "20261124".
 * @param {number} nowMs
 * @returns {string}
 */
function dayKeyFor(nowMs) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Pure per-user rate-limit decision for two combined fixed windows:
 * perMinute attempts per minuteMs, and perDay attempts per UTC day.
 * Does no I/O — the caller reads `state` from (and writes
 * `nextState` back into) Firestore inside a transaction.
 * @param {{minStart?:number, minCount?:number, dayKey?:string, dayCount?:number}|null|undefined} state
 * @param {number} nowMs
 * @param {{perMinute?:number, minuteMs?:number, perDay?:number}} [limits]
 * @returns {{allowed:boolean, nextState:object, reason:"minute"|"day"|null}}
 */
function rateDecision(state, nowMs, limits) {
  const lim = Object.assign({}, DEFAULT_LIMITS, limits || {});
  const s = state || {};
  const todayKey = dayKeyFor(nowMs);

  const minStart = typeof s.minStart === "number" ? s.minStart : null;
  const minuteExpired = minStart == null || nowMs - minStart >= lim.minuteMs;
  const minStartAfter = minuteExpired ? nowMs : minStart;
  const minCountBefore = minuteExpired ? 0 : typeof s.minCount === "number" ? s.minCount : 0;

  const dayMatches = s.dayKey === todayKey;
  const dayCountBefore = dayMatches && typeof s.dayCount === "number" ? s.dayCount : 0;

  if (minCountBefore >= lim.perMinute) {
    return {
      allowed: false,
      nextState: { minStart: minStartAfter, minCount: minCountBefore, dayKey: todayKey, dayCount: dayCountBefore },
      reason: "minute",
    };
  }
  if (dayCountBefore >= lim.perDay) {
    return {
      allowed: false,
      nextState: { minStart: minStartAfter, minCount: minCountBefore, dayKey: todayKey, dayCount: dayCountBefore },
      reason: "day",
    };
  }

  return {
    allowed: true,
    nextState: {
      minStart: minStartAfter,
      minCount: minCountBefore + 1,
      dayKey: todayKey,
      dayCount: dayCountBefore + 1,
    },
    reason: null,
  };
}

module.exports = {
  validateInput,
  cleanField,
  buildPrompt,
  extractText,
  parseMatchReply,
  rateDecision,
  dayKeyFor,
  FIELD_MAX,
  BIO_MAX,
  INTEREST_MAX,
  MAX_INTERESTS,
};
