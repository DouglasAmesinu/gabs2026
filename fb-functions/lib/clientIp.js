"use strict";

/**
 * Best-effort client IP extraction from an onCall request's underlying
 * Express request. Prefers the first entry of X-Forwarded-For, falling
 * back to the socket-reported IP.
 * @param {*} rawRequest request.rawRequest from a v2 CallableRequest
 * @returns {string}
 */
function getClientIp(rawRequest) {
  const xff = rawRequest && rawRequest.headers && rawRequest.headers["x-forwarded-for"];
  if (xff) {
    const first = String(xff).split(",")[0].trim();
    if (first) return first;
  }
  return (rawRequest && rawRequest.ip) || "";
}

module.exports = { getClientIp };
