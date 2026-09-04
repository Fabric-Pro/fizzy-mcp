/**
 * Request security validation for the Cloudflare Worker
 *
 * Kept out of `index.ts` so tests can exercise the real implementation: that
 * module re-exports the Durable Object classes and pulls in Workers-only
 * globals, which a Node test runner cannot import.
 *
 * Origin matching itself lives in `utils/origin.ts` and is shared with the Node
 * transports, so both deployments enforce one rule.
 */

import type { Env, SecurityResult } from "./types.js";
import { isOriginAllowed } from "../utils/origin.js";

/**
 * Validate request security (Origin validation)
 */
export function validateSecurity(request: Request, env: Env): SecurityResult {
  const origin = request.headers.get("Origin");

  // Parse allowed origins from env
  const allowedOriginsStr = env.MCP_ALLOWED_ORIGINS || "*";
  const allowedOrigins = allowedOriginsStr === "*"
    ? ["*"]
    : allowedOriginsStr.split(",").map(o => o.trim());

  // Validate Origin header (same allowlist rules as the Node transports)
  if (origin && !isOriginAllowed(origin, allowedOrigins)) {
    return {
      allowed: false,
      statusCode: 403,
      error: "Origin not allowed",
      corsOrigin: allowedOrigins[0],
    };
  }

  // Determine CORS origin
  let corsOrigin: string;
  if (allowedOrigins.includes("*")) {
    corsOrigin = "*";
  } else if (origin && isOriginAllowed(origin, allowedOrigins)) {
    // Echo back the caller's origin, not just a verbatim allowlist entry, so a
    // request allowed by the portless-loopback rule gets a usable CORS header.
    corsOrigin = origin;
  } else {
    corsOrigin = allowedOrigins[0] || "*";
  }

  return { allowed: true, corsOrigin };
}
