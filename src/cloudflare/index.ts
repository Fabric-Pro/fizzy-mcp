/**
 * Fizzy MCP Server - Cloudflare Workers Entry Point
 * 
 * This is the main entry point for deploying the Fizzy MCP server
 * to Cloudflare Workers. It handles:
 * 
 * - HTTP Streamable transport (/mcp endpoint)
 * - Health checks (/health endpoint)
 * - CORS preflight requests
 * - Security validation (Origin)
 * - Multi-user authentication via Authorization header
 * - Session routing via Durable Objects
 * 
 * Authentication Model (Multi-User):
 * - Each client provides their own Fizzy Personal Access Token
 * - Token is sent via Authorization: Bearer <fizzy-token> header
 * - The server does NOT store any Fizzy tokens
 * - Each request is authenticated against the Fizzy API using the client's token
 * 
 * @see https://developers.cloudflare.com/workers/
 * @see https://modelcontextprotocol.io/
 */

import type { Env, ExecutionContext, SecurityResult, HealthResponse } from "./types.js";
import { SERVER_VERSION } from "./types.js";

// Re-export Durable Object class for Wrangler
export { McpSessionDO } from "./mcp-session.js";

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
 * Validate request security (Origin validation)
 */
function validateSecurity(request: Request, env: Env): SecurityResult {
  const origin = request.headers.get("Origin");
  
  // Parse allowed origins from env
  const allowedOriginsStr = env.MCP_ALLOWED_ORIGINS || "*";
  const allowedOrigins = allowedOriginsStr === "*" 
    ? ["*"] 
    : allowedOriginsStr.split(",").map(o => o.trim());

  // Validate Origin header
  if (origin && !allowedOrigins.includes("*")) {
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed === origin) return true;
      // Check localhost variants with any port
      try {
        const originUrl = new URL(origin);
        const allowedUrl = new URL(allowed);
        return originUrl.hostname === allowedUrl.hostname && 
               originUrl.protocol === allowedUrl.protocol;
      } catch {
        return false;
      }
    });

    if (!isAllowed) {
      return {
        allowed: false,
        statusCode: 403,
        error: "Origin not allowed",
        corsOrigin: allowedOrigins[0],
      };
    }
  }

  // Determine CORS origin
  let corsOrigin: string;
  if (allowedOrigins.includes("*")) {
    corsOrigin = "*";
  } else if (origin && allowedOrigins.includes(origin)) {
    corsOrigin = origin;
  } else {
    corsOrigin = allowedOrigins[0] || "*";
  }

  return { allowed: true, corsOrigin };
}

/**
 * Set CORS headers on response
 *
 * @see https://developers.cloudflare.com/workers/examples/cors-header-proxy/
 */
function setCorsHeaders(headers: Headers, corsOrigin: string): void {
  headers.set("Access-Control-Allow-Origin", corsOrigin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");
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
function setSecurityHeaders(headers: Headers): void {
  // Prevent MIME type sniffing
  headers.set("X-Content-Type-Options", "nosniff");

  // Prevent clickjacking by disallowing embedding in iframes
  headers.set("X-Frame-Options", "DENY");

  // Additional security headers for best practices
  headers.set("X-XSS-Protection", "1; mode=block");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
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
function handleHealth(corsOrigin: string): Response {
  const health: HealthResponse = {
    status: "ok",
    transport: "streamable-http",
    version: SERVER_VERSION,
    durableObjects: true,
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
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Validate Durable Objects binding
    if (!env.MCP_SESSIONS) {
      console.error("MCP_SESSIONS Durable Objects binding not configured");
      return errorResponse(500, "Server configuration error: Missing Durable Objects binding");
    }

    // Handle health check (skip security for monitoring)
    if (path === "/health" && request.method === "GET") {
      const security = validateSecurity(request, env);
      return handleHealth(security.corsOrigin || "*");
    }

    // Validate security for all other requests
    const security = validateSecurity(request, env);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return handleOptions(security.corsOrigin || "*");
    }

    // Check security result
    if (!security.allowed) {
      return errorResponse(
        security.statusCode || 403,
        security.error || "Access denied",
        security.corsOrigin
      );
    }

    // Route to MCP handler (Streamable HTTP transport)
    if (path === "/mcp") {
      return handleMcp(request, env, security.corsOrigin!);
    }

    // 404 for unknown routes
    return errorResponse(404, "Not found", security.corsOrigin);
  },
};
