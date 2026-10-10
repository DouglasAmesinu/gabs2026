"use strict";

const { HttpsError } = require("firebase-functions/v2/https");

/**
 * Throw permission-denied unless the caller is the configured admin.
 * An empty or missing adminUid (parameter not configured) never
 * matches, so nobody is admin by accident.
 * @param {{auth?: {uid?: string}}} request callable request
 * @param {string} adminUid value of the ADMIN_UID parameter
 */
function requireAdmin(request, adminUid) {
  const uid = request && request.auth && request.auth.uid;
  if (typeof adminUid !== "string" || !adminUid || typeof uid !== "string" || uid !== adminUid) {
    throw new HttpsError("permission-denied", "Admin only.");
  }
}

module.exports = { requireAdmin };
