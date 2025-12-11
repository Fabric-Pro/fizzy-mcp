/**
 * Streamable HTTP Transport Handler
 * Creates an HTTP server that handles the MCP Streamable HTTP protocol
 *
 * Multi-User Support:
 * - Each user provides their own Fizzy token via Authorization: Bearer <token> header
 * - Each session gets its own FizzyClient instance with the user's token
 * - Sessions are isolated - users cannot access each other's data
 *
 * Security Features:
 * - Origin header validation (DNS rebinding protection)
 * - Localhost-only binding by default
 * - Per-user authentication via Authorization header
 * - Optional client authentication (MCP_AUTH_TOKEN)
 * - Custom authorization support
 * - Secure CORS configuration
 */

import { createServer, IncomingMessage, ServerResponse, Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { FizzyClient } from "../client/fizzy-client.js";
import { createFizzyServer } from "../server.js";
import { logger } from "../utils/logger.js";
import { SessionManager } from "../utils/session-manager.js";
import {
  SecurityOptions,
  validateRequestSecurity,
  sendSecurityError,
  setSecureCorsHeaders,
  getBindAddress,
  extractFizzyToken,
} from "../utils/security.js";

export interface HTTPSession {
  transport: StreamableHTTPServerTransport;
  client: FizzyClient;
  fizzyToken: string;
}

export interface HTTPTransportOptions {
  port: number;
  /** @deprecated No longer used - each session creates its own client with user's token */
  client?: FizzyClient;
  /** Maximum concurrent sessions (default: 1000) */
  maxSessions?: number;
  /** Session idle timeout in ms (default: 30 minutes) */
  sessionTimeout?: number;
  /** Security options */
  security?: SecurityOptions;
}

export interface HTTPTransportServer {
  server: Server;
  sessionManager: SessionManager<HTTPSession>;
  close: () => Promise<void>;
}

/**
 * Create request handler for Streamable HTTP transport
 * Exported for testing
 */
export function createHTTPRequestHandler(
  sessionManager: SessionManager<HTTPSession>,
  port: number,
  security: SecurityOptions = {}
) {
  const log = logger.child("http");

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Health check endpoint (optionally skip security, but handle OPTIONS for CORS)
    if (url.pathname === "/health" && req.method !== "OPTIONS") {
      if (security.skipHealthCheck !== false) {
        const stats = sessionManager.getStats();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
          status: "ok", 
          transport: "streamable-http",
          activeSessions: stats.activeSessions,
          maxSessions: stats.maxSessions,
        }));
        return;
      }
    }

    // Validate request security (Origin, Auth, Authorization)
    const securityResult = await validateRequestSecurity(req, security, port, sessionId);
    
    if (!securityResult.allowed) {
      sendSecurityError(res, securityResult);
      return;
    }

    // Set secure CORS headers
    setSecureCorsHeaders(res, securityResult.corsOrigin!, ["mcp-session-id"]);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      // POST - Initialize new session or send message to existing session
      if (req.method === "POST") {
        // Extract user's Fizzy token from Authorization header
        const fizzyToken = extractFizzyToken(req);
        if (!fizzyToken) {
          log.warn("Missing Fizzy token in Authorization header");
          setSecureCorsHeaders(res, securityResult.corsOrigin || "*");
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "Authorization required",
            message: "Please provide your Fizzy Personal Access Token via: Authorization: Bearer <token>",
          }));
          return;
        }

        const session = sessionId ? sessionManager.get(sessionId) : undefined;

        if (!session) {
          // Check if we can create a new session
          if (sessionManager.size >= sessionManager.maxSessions) {
            // Try to clean up expired sessions first
            sessionManager.cleanup();

            // Still at capacity after cleanup?
            if (sessionManager.size >= sessionManager.maxSessions) {
              log.warn("Server at capacity, rejecting new session");
              setSecureCorsHeaders(res, securityResult.corsOrigin || "*");
              res.writeHead(503, {
                "Content-Type": "application/json",
                "Retry-After": "60", // Suggest retry after 60 seconds
              });
              res.end(JSON.stringify({
                error: "Server at capacity",
                message: "Maximum number of concurrent sessions reached. Please try again later.",
              }));
              return;
            }
          }

          log.debug("Creating new HTTP session");

          // Create per-user FizzyClient with the user's token
          const userClient = new FizzyClient({
            accessToken: fizzyToken,
          });

          // Create new server and transport for this session with user's client
          const server = createFizzyServer(userClient);

          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (newSessionId) => {
              log.info(`HTTP session created: ${newSessionId}`);
              sessionManager.create(newSessionId, {
                transport,
                client: userClient,
                fizzyToken,
              });
            },
            onsessionclosed: (closedSessionId) => {
              log.info(`HTTP session closed: ${closedSessionId}`);
              sessionManager.delete(closedSessionId);
            },
          });

          // Connect server to transport
          await server.connect(transport);

          // Handle the initial request
          await transport.handleRequest(req, res);
          return;
        }

        // Validate token matches the session
        if (fizzyToken !== session.fizzyToken) {
          log.warn(`Token mismatch for session: ${sessionId}`);
          setSecureCorsHeaders(res, securityResult.corsOrigin || "*");
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "Token mismatch",
            message: "The Authorization token does not match the session",
          }));
          return;
        }

        // Handle subsequent requests for existing session
        await session.transport.handleRequest(req, res);
        return;
      }

      // GET - SSE stream for server-initiated messages (if session exists)
      if (req.method === "GET") {
        if (!sessionId) {
          setSecureCorsHeaders(res, securityResult.corsOrigin || "*");
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing mcp-session-id header" }));
          return;
        }

        const session = sessionManager.get(sessionId);
        if (session) {
          // Validate token matches the session
          const fizzyToken = extractFizzyToken(req);
          if (fizzyToken !== session.fizzyToken) {
            log.warn(`Token mismatch for session: ${sessionId}`);
            setSecureCorsHeaders(res, securityResult.corsOrigin || "*");
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              error: "Token mismatch",
              message: "The Authorization token does not match the session",
            }));
            return;
          }

          log.debug(`SSE stream request for session: ${sessionId}`);
          await session.transport.handleRequest(req, res);
          return;
        }
        setSecureCorsHeaders(res, securityResult.corsOrigin || "*");
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return;
      }

      // DELETE - Close session
      if (req.method === "DELETE") {
        if (!sessionId) {
          setSecureCorsHeaders(res, securityResult.corsOrigin || "*");
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing mcp-session-id header" }));
          return;
        }

        const session = sessionManager.get(sessionId);
        if (session) {
          // Validate token matches the session
          const fizzyToken = extractFizzyToken(req);
          if (fizzyToken !== session.fizzyToken) {
            log.warn(`Token mismatch for session: ${sessionId}`);
            setSecureCorsHeaders(res, securityResult.corsOrigin || "*");
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              error: "Token mismatch",
              message: "The Authorization token does not match the session",
            }));
            return;
          }

          log.debug(`Delete request for session: ${sessionId}`);
          await session.transport.handleRequest(req, res);
          return;
        }
        setSecureCorsHeaders(res, securityResult.corsOrigin || "*");
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return;
      }

      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid request" }));
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  };
}

/**
 * Create HTTP transport server
 */
export function createHTTPTransportServer(options: HTTPTransportOptions): HTTPTransportServer {
  const { port, maxSessions, sessionTimeout, security = {} } = options;
  const log = logger.child("http");

  const sessionManager = new SessionManager<HTTPSession>({
    maxSessions: maxSessions ?? 1000,
    sessionTimeout: sessionTimeout ?? 30 * 60 * 1000, // 30 minutes
    onSessionEvicted: (sessionId, reason) => {
      log.info(`Session evicted (${reason}): ${sessionId}`);
    },
  });

  const handler = createHTTPRequestHandler(sessionManager, port, security);
  const server = createServer(handler);

  return {
    server,
    sessionManager,
    close: () => {
      return new Promise((resolve, reject) => {
        // Dispose session manager (stops cleanup timer and clears sessions)
        sessionManager.dispose();

        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

/**
 * Start HTTP transport server
 */
export async function startHTTPTransport(options: HTTPTransportOptions): Promise<HTTPTransportServer> {
  const transportServer = createHTTPTransportServer(options);
  const log = logger.child("http");
  const security = options.security ?? {};
  const bindAddress = getBindAddress(security);

  return new Promise((resolve) => {
    // MCP Requirement: "When running locally, servers SHOULD bind only to localhost"
    transportServer.server.listen(options.port, bindAddress, () => {
      log.info(`HTTP transport running on ${bindAddress}:${options.port}`);
      log.info(`Max sessions: ${transportServer.sessionManager.maxSessions}`);

      // Security configuration logging
      if (security.authToken) {
        log.info("Authentication: Bearer token required");
      }

      const allowedOrigins = security.allowedOrigins ?? ["*"];
      const hasWildcardOrigin = allowedOrigins.includes("*") || allowedOrigins.length === 0;

      if (security.allowedOrigins?.length) {
        log.info(`Allowed origins: ${security.allowedOrigins.join(", ")}`);
      } else {
        log.info("Allowed origins: * (all origins allowed)");
      }

      // Security warning for insecure configurations
      if (bindAddress === "0.0.0.0" && hasWildcardOrigin) {
        log.warn("SECURITY WARNING: Server is accessible from network with unrestricted CORS origins!");
        log.warn("This configuration is NOT recommended for production use.");
        log.warn("Consider setting MCP_ALLOWED_ORIGINS to restrict access to specific origins.");
        log.warn("Example: MCP_ALLOWED_ORIGINS='https://myapp.com'");
        if (!security.authToken) {
          log.warn("Consider setting MCP_AUTH_TOKEN for client authentication.");
        }
      }

      // Log multi-user authentication info
      log.info("Multi-user support: Each user provides their own Fizzy token via Authorization header");

      resolve(transportServer);
    });
  });
}
/**
 * Convenience function for starting HTTP transport with security options from environment
 */
export async function startSecureHTTPTransport(
  options: Omit<HTTPTransportOptions, "security" | "client">
): Promise<HTTPTransportServer> {
  return startHTTPTransport({
    ...options,
    security: {
      // Security options are read from environment variables automatically
    },
  });
}
