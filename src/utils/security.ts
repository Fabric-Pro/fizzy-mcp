/**
 * Security utilities for MCP transport servers
 * Implements MCP security requirements for HTTP/SSE transports
 * 
 * Security Layers:
 * 1. Localhost binding (default) - Prevents remote network access
 * 2. Origin validation - Controls which web origins can connect via CORS
 * 3. Client Authentication - Bearer token to authenticate MCP clients connecting to this server
 * 
 * Note: Client Authentication (MCP_AUTH_TOKEN) is separate from User Authentication
 * (FIZZY_ACCESS_TOKEN). User Authentication is always required and handled by the
 * FizzyClient to identify the user and access their Fizzy data.
 * 
 * Environment Variables:
 * - MCP_ALLOWED_ORIGINS: Comma-separated list of allowed origins (or "*" for all)
 * - MCP_AUTH_TOKEN: Bearer token for MCP client authentication
 * - MCP_BIND_ALL_INTERFACES: Set to "true" to bind to 0.0.0.0
 */

import { IncomingMessage, ServerResponse } from "node:http";
import { logger } from "./logger.js";

const log = logger.child("security");

/**
 * Security configuration options
 */
export interface SecurityOptions {
  /**
   * Allowed origins for CORS and Origin validation
   * Default: ["*"] (allow all origins for ease of use)
   * Set to specific origins like ["http://localhost:3000"] for stricter security
   * Can also be configured via MCP_ALLOWED_ORIGINS environment variable
   */
  allowedOrigins?: string[];
  
  /**
   * Bearer token for Client Authentication
   * If set, MCP clients must include Authorization: Bearer <token> header
   * This is separate from User Authentication (FIZZY_ACCESS_TOKEN) which
   * authenticates the user with the Fizzy API
   * Can also be configured via MCP_AUTH_TOKEN environment variable
   */
  authToken?: string;
  
  /**
   * Custom authorization function
   * Called for each request after authentication
   * Return true to allow, false to deny
   */
  authorize?: (req: IncomingMessage, sessionId?: string) => boolean | Promise<boolean>;
  
  /**
   * Whether to bind to localhost only (default: true)
   * When true, binds to 127.0.0.1 (recommended for security)
   * When false, binds to 0.0.0.0 (all interfaces)
   * Can also be configured via MCP_BIND_ALL_INTERFACES environment variable
   */
  localhostOnly?: boolean;
  
  /**
   * Skip security checks for health endpoint (default: true)
   */
  skipHealthCheck?: boolean;
}

/**
 * Get security options from environment variables
 * These can be overridden by explicit options passed to the function
 */
export function getSecurityFromEnv(): Partial<SecurityOptions> {
  const env: Partial<SecurityOptions> = {};
  
  // MCP_ALLOWED_ORIGINS: comma-separated list or "*"
  const originsEnv = process.env.MCP_ALLOWED_ORIGINS;
  if (originsEnv) {
    env.allowedOrigins = originsEnv === "*" 
      ? ["*"] 
      : originsEnv.split(",").map(o => o.trim()).filter(Boolean);
  }
  
  // MCP_AUTH_TOKEN: bearer token for authentication
  if (process.env.MCP_AUTH_TOKEN) {
    env.authToken = process.env.MCP_AUTH_TOKEN;
  }
  
  // MCP_BIND_ALL_INTERFACES: set to "true" to bind to 0.0.0.0
  if (process.env.MCP_BIND_ALL_INTERFACES === "true") {
    env.localhostOnly = false;
  }
  
  return env;
}

/**
 * Merge security options with environment variables
 * Explicit options take precedence over environment variables
 */
export function resolveSecurityOptions(options: SecurityOptions = {}): SecurityOptions {
  const envOptions = getSecurityFromEnv();
  return {
    // Default to allow all origins for ease of use (localhost binding is the main protection)
    allowedOrigins: options.allowedOrigins ?? envOptions.allowedOrigins ?? ["*"],
    authToken: options.authToken ?? envOptions.authToken,
    authorize: options.authorize,
    localhostOnly: options.localhostOnly ?? envOptions.localhostOnly ?? true,
    skipHealthCheck: options.skipHealthCheck ?? true,
  };
}

/**
 * Localhost origins (used when specific localhost origins are configured)
 */
const LOCALHOST_ORIGINS = [
  "http://localhost",
  "http://127.0.0.1",
  "https://localhost",
  "https://127.0.0.1",
];

/**
 * Check if an origin matches the allowed patterns
 * Supports exact match and localhost with any port
 */
function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  // Wildcard allows all
  if (allowedOrigins.includes("*")) {
    return true;
  }
  
  // Exact match
  if (allowedOrigins.includes(origin)) {
    return true;
  }
  
  // Check localhost with any port
  try {
    const url = new URL(origin);
    const hostWithoutPort = `${url.protocol}//${url.hostname}`;
    
    // Check if it's a localhost variant
    if (LOCALHOST_ORIGINS.includes(hostWithoutPort)) {
      // Check if base localhost origin is in allowed list
      return allowedOrigins.some(allowed => {
        if (LOCALHOST_ORIGINS.includes(allowed)) {
          return true;
        }
        try {
          const allowedUrl = new URL(allowed);
          return allowedUrl.hostname === url.hostname && 
                 allowedUrl.protocol === url.protocol;
        } catch {
          return false;
        }
      });
    }
  } catch {
    // Invalid URL
    return false;
  }
  
  return false;
}

/**
 * Security result for request validation
 */
export interface SecurityResult {
  allowed: boolean;
  statusCode?: number;
  error?: string;
  corsOrigin?: string;
}

/**
 * Validate request security (Origin, Auth, Authorization)
 */
export async function validateRequestSecurity(
  req: IncomingMessage,
  options: SecurityOptions,
  _port: number,
  sessionId?: string
): Promise<SecurityResult> {
  // Resolve options with environment variables
  const resolved = resolveSecurityOptions(options);
  const origin = req.headers.origin as string | undefined;
  const allowedOrigins = resolved.allowedOrigins!;
  
  // 1. Validate Origin header (DNS Rebinding protection)
  // MCP Requirement: "Servers MUST validate the Origin header on all incoming connections"
  if (origin) {
    if (!isOriginAllowed(origin, allowedOrigins)) {
      log.warn(`Origin rejected: ${origin}`);
      return {
        allowed: false,
        statusCode: 403,
        error: "Origin not allowed",
      };
    }
  } else if (req.method !== "OPTIONS") {
    // For non-OPTIONS requests without Origin, check if it could be a browser request
    // Browsers always send Origin for cross-origin requests
    // Requests without Origin are likely from non-browser clients (curl, SDKs)
    // We still allow them but log for monitoring
    log.debug("Request without Origin header (likely non-browser client)");
  }
  
  // 2. Validate Client Authentication (Bearer token)
  // This authenticates the MCP client connecting to this server
  // (separate from User Authentication via FIZZY_ACCESS_TOKEN for the Fizzy API)
  if (resolved.authToken) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      log.warn("Missing Authorization header for client authentication");
      return {
        allowed: false,
        statusCode: 401,
        error: "Client authentication required",
      };
    }
    
    if (!authHeader.startsWith("Bearer ")) {
      log.warn("Invalid Authorization header format for client authentication");
      return {
        allowed: false,
        statusCode: 401,
        error: "Invalid client authentication format. Expected: Bearer <token>",
      };
    }
    
    const token = authHeader.slice(7); // Remove "Bearer "
    if (token !== resolved.authToken) {
      log.warn("Invalid client authentication token");
      return {
        allowed: false,
        statusCode: 401,
        error: "Invalid client authentication token",
      };
    }
  }
  
  // 3. Custom Authorization
  if (resolved.authorize) {
    try {
      const authorized = await resolved.authorize(req, sessionId);
      if (!authorized) {
        log.warn("Request authorization denied");
        return {
          allowed: false,
          statusCode: 403,
          error: "Authorization denied",
        };
      }
    } catch (err) {
      log.error("Authorization check failed:", err);
      return {
        allowed: false,
        statusCode: 500,
        error: "Authorization check failed",
      };
    }
  }
  
  // Determine CORS origin to return
  let corsOrigin: string;
  if (allowedOrigins.includes("*")) {
    corsOrigin = "*";
  } else if (origin && isOriginAllowed(origin, allowedOrigins)) {
    corsOrigin = origin;
  } else {
    // Return first allowed origin as default
    corsOrigin = allowedOrigins[0] || "http://localhost";
  }
  
  return {
    allowed: true,
    corsOrigin,
  };
}

/**
 * Send security error response
 */
export function sendSecurityError(res: ServerResponse, result: SecurityResult): void {
  res.writeHead(result.statusCode || 403, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: result.error }));
}

/**
 * Set secure CORS headers based on validation result
 */
export function setSecureCorsHeaders(
  res: ServerResponse,
  corsOrigin: string,
  exposedHeaders: string[] = []
): void {
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");
  
  if (exposedHeaders.length > 0) {
    res.setHeader("Access-Control-Expose-Headers", exposedHeaders.join(", "));
  }
  
  // Allow credentials only if not using wildcard
  if (corsOrigin !== "*") {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
}

/**
 * Get bind address based on security options
 */
export function getBindAddress(options: SecurityOptions = {}): string {
  const resolved = resolveSecurityOptions(options);
  // MCP Requirement: "When running locally, servers SHOULD bind only to localhost"
  return resolved.localhostOnly !== false ? "127.0.0.1" : "0.0.0.0";
}

