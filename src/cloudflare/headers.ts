/**
 * Response header helpers for the Cloudflare Worker
 *
 * Kept out of `index.ts` for the same reason `security.ts` is: that module
 * re-exports the Durable Object classes and pulls in Workers-only globals, so a
 * Node test runner cannot import it. Living here, these are exercised by the
 * real tests rather than by a copy of themselves — the CORS allowlist below is
 * exactly the kind of thing a reimplemented test would keep passing on after
 * the production copy drifted.
 */

import { CLIENT_AUTH_HEADER } from "../utils/client-auth.js";

/**
 * Set CORS headers on response
 *
 * @see https://developers.cloudflare.com/workers/examples/cors-header-proxy/
 */
export function setCorsHeaders(headers: Headers, corsOrigin: string): void {
  headers.set("Access-Control-Allow-Origin", corsOrigin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  // X-MCP-Auth-Token must be listed or browsers strip the client-auth header
  // from cross-origin requests, and the Worker sees no token at all.
  headers.set(
    "Access-Control-Allow-Headers",
    `Content-Type, Authorization, mcp-session-id, ${CLIENT_AUTH_HEADER}`
  );
  headers.set("Access-Control-Expose-Headers", "mcp-session-id");
  headers.set("Access-Control-Max-Age", "86400"); // 24 hours - reduces preflight requests

  if (corsOrigin !== "*") {
    headers.set("Access-Control-Allow-Credentials", "true");
  }
}

/**
 * Set security headers on response
 *
 * @see https://developers.cloudflare.com/workers/examples/security-headers/
 */
export function setSecurityHeaders(headers: Headers): void {
  // Prevent MIME type sniffing
  headers.set("X-Content-Type-Options", "nosniff");

  // Prevent clickjacking by disallowing embedding in iframes
  headers.set("X-Frame-Options", "DENY");

  // Additional security headers for best practices
  headers.set("X-XSS-Protection", "1; mode=block");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
}
