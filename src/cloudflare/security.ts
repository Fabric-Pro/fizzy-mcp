/**
 * Request security validation for the Cloudflare Worker
 *
 * Kept out of `index.ts` so tests can exercise the real implementation: that
 * module re-exports the Durable Object classes and pulls in Workers-only
 * globals, which a Node test runner cannot import.
 *
 * Origin matching itself lives in `utils/origin.ts` and is shared with the Node
 * transports, so both deployments enforce one rule. Client authentication is
 * shared the same way, via `utils/client-auth.ts`.
 */

import type { Env, SecurityResult } from "./types.js";
import { isOriginAllowed } from "../utils/origin.js";
import {
  CLIENT_AUTH_HEADER,
  CLIENT_AUTH_INVALID_ERROR,
  CLIENT_AUTH_REQUIRED_ERROR,
  timingSafeEqualString,
} from "../utils/client-auth.js";

/**
 * Validate request security (Origin validation, then client authentication)
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

  // Determine CORS origin. Computed before the auth check so a 401 can carry it
  // too — without it a browser cannot read the error body and the client sees an
  // opaque network failure instead of "your token is wrong". It is the same
  // value the success path returns, never a more permissive one: echoing the
  // caller's origin on a request the allowlist has not vetted would pair
  // Access-Control-Allow-Credentials with an arbitrary origin.
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

  // Validate client authentication, when the operator configured a token.
  //
  // The token arrives on its own header, bare, because `Authorization` is
  // already spoken for: `extractFizzyToken` in index.ts reads it as the caller's
  // Fizzy Personal Access Token. Enforcing client auth there would make the two
  // layers mutually exclusive rather than independent. See utils/client-auth.ts.
  if (env.MCP_AUTH_TOKEN) {
    const clientToken = request.headers.get(CLIENT_AUTH_HEADER);

    if (!clientToken) {
      return {
        allowed: false,
        statusCode: 401,
        error: CLIENT_AUTH_REQUIRED_ERROR,
        corsOrigin,
      };
    }

    if (!timingSafeEqualString(clientToken, env.MCP_AUTH_TOKEN)) {
      return {
        allowed: false,
        statusCode: 401,
        error: CLIENT_AUTH_INVALID_ERROR,
        corsOrigin,
      };
    }
  }

  return { allowed: true, corsOrigin };
}
