/**
 * Fizzy MCP Server - Cloudflare Workers Entry Point
 * 
 * This is the main entry point for deploying the Fizzy MCP server
 * to Cloudflare Workers. It handles:
 * 
 * - HTTP Streamable transport (/mcp endpoint)
 * - Health checks (/health endpoint)
 * - CORS preflight requests
 * - Security validation (Origin, optional client auth via X-MCP-Auth-Token)
 * - Multi-user authentication via Authorization header
 * - Session routing via Durable Objects
 * - Rate limiting (optional, via RATE_LIMITER binding)
 * - Request/response logging (optional, via AUDIT_LOGS R2 bucket)
 * - Analytics tracking (optional, via ANALYTICS binding)
 * 
 * Authentication Model (Multi-User):
 * - Each client provides their own Fizzy Personal Access Token
 * - Token is sent via Authorization: Bearer <fizzy-token> header
 * - The server does NOT store any Fizzy tokens
 * - Each request is authenticated against the Fizzy API using the client's token
 *
 * Client Authentication (optional, MCP_AUTH_TOKEN):
 * - A server-level shared secret gating which clients may connect at all
 * - Sent bare on X-MCP-Auth-Token, deliberately NOT on Authorization, which is
 *   already the per-user Fizzy token — see utils/client-auth.ts
 * - Enforced in validateSecurity(); /health and OPTIONS stay exempt below
 * 
 * @see https://developers.cloudflare.com/workers/
 * @see https://modelcontextprotocol.io/
 */

import type { Env, ExecutionContext, HealthResponse } from "./types.js";
import { SERVER_VERSION } from "./types.js";
import { RateLimiter, createLogger, createAnalytics, type LogLevel } from "./utils/index.js";
import { buildWorkerErrorEnvelope } from "./utils/worker-errors.js";
import { validateSecurity } from "./security.js";
import { setCorsHeaders, setSecurityHeaders } from "./headers.js";

// Re-export Durable Object classes for Wrangler
export { McpSessionDO } from "./mcp-session.js";
export { RateLimiterDO } from "./utils/rate-limiter.js";

/**
 * Extract Fizzy token from request headers
 * Supports: Authorization: Bearer <token>
 */
function extractFizzyToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  
  return null;
}

/**
 * Create error response with CORS and security headers
 */
function errorResponse(
  statusCode: number,
  message: string,
  corsOrigin: string = "*"
): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  setCorsHeaders(headers, corsOrigin);
  setSecurityHeaders(headers);

  return new Response(
    JSON.stringify({ error: message }),
    { status: statusCode, headers }
  );
}

/**
 * Handle health check requests
 */
function handleHealth(corsOrigin: string, env: Env): Response {
  const health: HealthResponse & { features?: Record<string, boolean> } = {
    status: "ok",
    transport: "streamable-http",
    version: SERVER_VERSION,
    durableObjects: true,
    features: {
      rateLimiting: !!env.RATE_LIMITER && env.ENABLE_RATE_LIMIT !== "false",
      auditLogs: !!env.AUDIT_LOGS,
      analytics: !!env.ANALYTICS,
      caching: !!env.FIZZY_CACHE && env.ENABLE_CACHE !== "false",
    },
  };

  const headers = new Headers({ "Content-Type": "application/json" });
  setCorsHeaders(headers, corsOrigin);
  setSecurityHeaders(headers);

  return new Response(JSON.stringify(health), { status: 200, headers });
}

/**
 * Handle CORS preflight requests
 */
function handleOptions(corsOrigin: string): Response {
  const headers = new Headers();
  setCorsHeaders(headers, corsOrigin);
  setSecurityHeaders(headers);

  return new Response(null, { status: 204, headers });
}

/**
 * Route MCP requests to Durable Objects
 * 
 * This handler implements the Streamable HTTP transport for MCP.
 * Each session is managed by a Durable Object for stateful processing.
 */
async function handleMcp(
  request: Request,
  env: Env,
  corsOrigin: string
): Promise<Response> {
  // Extract Fizzy token from Authorization header
  const fizzyToken = extractFizzyToken(request);
  
  if (!fizzyToken) {
    return errorResponse(
      401, 
      "Authorization required. Send your Fizzy Personal Access Token via: Authorization: Bearer <token>",
      corsOrigin
    );
  }

  // Get or create session ID
  let sessionId = request.headers.get("mcp-session-id");

  // For POST without session ID, create new session
  if (!sessionId && request.method === "POST") {
    sessionId = crypto.randomUUID();
  }

  // For GET/DELETE, session ID is required
  if (!sessionId && (request.method === "GET" || request.method === "DELETE")) {
    return errorResponse(400, "Missing mcp-session-id header", corsOrigin);
  }

  if (!sessionId) {
    return errorResponse(400, "Invalid request", corsOrigin);
  }

  // Get Durable Object for this session
  const doId = env.MCP_SESSIONS.idFromName(sessionId);
  const doStub = env.MCP_SESSIONS.get(doId);

  // Forward request to Durable Object with Fizzy token in header
  // The DO will use this token to create the FizzyClient
  const doHeaders = new Headers(request.headers);
  doHeaders.set("X-Fizzy-Token", fizzyToken);
  
  const doRequest = new Request(request.url, {
    method: request.method,
    headers: doHeaders,
    body: request.body,
  });

  const doResponse = await doStub.fetch(doRequest);

  // Add CORS and security headers to response
  const responseHeaders = new Headers(doResponse.headers);
  setCorsHeaders(responseHeaders, corsOrigin);
  setSecurityHeaders(responseHeaders);

  // Ensure session ID is in response
  if (!responseHeaders.has("mcp-session-id")) {
    responseHeaders.set("mcp-session-id", sessionId);
  }

  // Residual limitation: `doResponse.body` is streamed through, not buffered.
  // The try/catch around the top-level `fetch` handler (see the default
  // export below) only covers the `await handleMcp(...)` call settling —
  // reading this body happens later and asynchronously, disconnected from
  // that await, once the platform starts consuming the Response this
  // function returns. A DO failure *while this body is being consumed
  // downstream* therefore happens outside that boundary and can still
  // surface as an uncaught error, no matter what the caller does with the
  // Response in between. Buffering here with `doResponse.arrayBuffer()`
  // would make that case catchable too, but at the cost of holding the
  // *entire* response (e.g. a large `get_cards` page) in the calling
  // Worker's own memory — which reintroduces the memory pressure this
  // change exists to relieve. Kept streaming deliberately; this gap is
  // accepted.
  return new Response(doResponse.body, {
    status: doResponse.status,
    statusText: doResponse.statusText,
    headers: responseHeaders,
  });
}

/**
 * Main Worker fetch handler
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // `path` is computed defensively (outside the try's happy path) so the
    // catch block below can still report which route failed even if the
    // failure happened before or during URL parsing.
    let path = "";

    try {
      const startTime = Date.now();
      const url = new URL(request.url);
      path = url.pathname;

      // Initialize logger
      const logger = createLogger({
        level: (env.LOG_LEVEL as LogLevel) || "info",
        r2Bucket: env.AUDIT_LOGS,
        consoleOutput: true,
      });

      // Initialize analytics
      const analytics = createAnalytics(env.ANALYTICS);

      // Validate Durable Objects binding
      if (!env.MCP_SESSIONS) {
        console.error("MCP_SESSIONS Durable Objects binding not configured");
        return errorResponse(500, "Server configuration error: Missing Durable Objects binding");
      }

      // Handle health check (skip security for monitoring)
      //
      // `allowed` is deliberately ignored: validateSecurity is called only for
      // the CORS origin it computes. /health must answer uptime monitors that
      // hold no client token, which is also what the Node transports do by
      // default (`skipHealthCheck: true` in utils/security.ts).
      if (path === "/health" && request.method === "GET") {
        const security = validateSecurity(request, env);
        return handleHealth(security.corsOrigin || "*", env);
      }

      // Validate security for all other requests
      const security = validateSecurity(request, env);

      // Handle CORS preflight
      //
      // This returns *before* the `security.allowed` check below, and must keep
      // doing so. Browsers send no custom headers on a preflight, so a request
      // that would be perfectly authenticated arrives here with no
      // X-MCP-Auth-Token; failing it would break every browser client before it
      // ever got to send the real request.
      if (request.method === "OPTIONS") {
        return handleOptions(security.corsOrigin || "*");
      }

      // Check security result
      if (!security.allowed) {
        analytics.trackRequest(request.method, path, security.statusCode || 403, Date.now() - startTime);
        return errorResponse(
          security.statusCode || 403,
          security.error || "Access denied",
          security.corsOrigin
        );
      }

      // Route to MCP handler (Streamable HTTP transport)
      if (path === "/mcp") {
        // Check rate limit if enabled
        if (env.RATE_LIMITER && env.ENABLE_RATE_LIMIT !== "false") {
          const fizzyToken = extractFizzyToken(request);
          if (fizzyToken) {
            const rateLimiter = new RateLimiter(env.RATE_LIMITER, {
              limit: parseInt(env.RATE_LIMIT_RPM || "10000", 10),
              windowSeconds: 60,
            });

            const rateLimitResult = await rateLimiter.checkByToken(fizzyToken);

            if (!rateLimitResult.allowed) {
              logger.warn("Rate limit exceeded", {
                remaining: rateLimitResult.remaining,
                resetAt: rateLimitResult.resetAt,
              });
              analytics.trackRequest(request.method, path, 429, Date.now() - startTime);
              return RateLimiter.createRateLimitResponse(rateLimitResult, security.corsOrigin);
            }
          }
        }

        // `doStub.fetch()` below rejects when Cloudflare kills the session's
        // Durable Object for exceeding its memory/CPU budget (see the
        // byte-bounded ETag cache in utils/etag-cache.ts for the main source
        // of that memory pressure). That rejection — like any exception in
        // this handler — is caught by the try/catch wrapping this whole
        // function, which is what keeps it from surfacing as an uncatchable
        // Cloudflare error 1101 to the client.
        const response = await handleMcp(request, env, security.corsOrigin!);

        // Track request metrics
        analytics.trackRequest(request.method, path, response.status, Date.now() - startTime);

        // Flush logs asynchronously
        ctx.waitUntil(logger.flush());

        return response;
      }

      // 404 for unknown routes
      analytics.trackRequest(request.method, path, 404, Date.now() - startTime);
      return errorResponse(404, "Not found", security.corsOrigin);
    } catch (error) {
      // Last-resort error boundary: converts anything that would otherwise
      // escape this handler uncaught — and surface to the client as an
      // opaque, misleadingly-"non-retryable" Cloudflare error 1101 — into a
      // diagnosable JSON-RPC error response instead.
      console.error("Unhandled error in Worker fetch handler", error);

      // The origin may be unknown at this point (the failure could have
      // happened before `validateSecurity` ran, or `validateSecurity` itself
      // could be the thing that threw), so recompute it defensively and
      // never let this fallback itself throw.
      let corsOrigin = "*";
      try {
        corsOrigin = validateSecurity(request, env).corsOrigin || "*";
      } catch {
        corsOrigin = "*";
      }

      const { status, body } = buildWorkerErrorEnvelope(path, error);
      const headers = new Headers({ "Content-Type": "application/json" });
      setCorsHeaders(headers, corsOrigin);
      setSecurityHeaders(headers);

      return new Response(JSON.stringify(body), { status, headers });
    }
  },
};
