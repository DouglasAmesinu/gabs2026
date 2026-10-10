"use strict";

const { normalizeRef, isValidRef } = require("./ticketRef");

// Same shape as Firestore auto-ids and the ids the client accepts (safeId).
const UID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MESSAGE_DELETE_BATCH = 400;
const TICKET_LOOKUP_LIMIT = 5;

/**
 * Validate adminBlockDelegate input.
 * @param {*} data request.data
 * @returns {{uid:string, deleteProfile:boolean}|null} null when invalid
 */
function validateBlockInput(data) {
  if (!data || typeof data !== "object") return null;
  if (typeof data.uid !== "string" || !UID_RE.test(data.uid)) return null;
  return { uid: data.uid, deleteProfile: data.deleteProfile !== false };
}

/**
 * Validate adminUnblockTicket input, normalised like signInWithTicket.
 * @param {*} data request.data
 * @returns {string|null} the normalised ref, or null when invalid
 */
function validateUnblockInput(data) {
  if (!data || typeof data !== "object") return null;
  const ref = normalizeRef(data.ref);
  return isValidRef(ref) ? ref : null;
}

/**
 * @param {*} ticket ticket document data
 * @returns {boolean} true only for an explicit blocked: true
 */
function isTicketBlocked(ticket) {
  return !!ticket && ticket.blocked === true;
}

/**
 * @param {*} err error thrown by the Admin Auth SDK
 * @returns {boolean} true when the auth user does not exist
 */
function isAuthUserNotFound(err) {
  if (!err) return false;
  return err.code === "auth/user-not-found" || !!(err.errorInfo && err.errorInfo.code === "auth/user-not-found");
}

module.exports = {
  validateBlockInput,
  validateUnblockInput,
  isTicketBlocked,
  isAuthUserNotFound,
  UID_RE,
  MESSAGE_DELETE_BATCH,
  TICKET_LOOKUP_LIMIT,
};
