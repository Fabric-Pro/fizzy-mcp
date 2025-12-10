/**
 * SSE Transport Handler
 * Creates an HTTP server that handles Server-Sent Events connections
 * 
 * Security Features:
 * - Origin header validation (DNS rebinding protection)
 * - Localhost-only binding by default
 * - Optional Bearer token authentication
 * - Custom authorization support
 * - Secure CORS configuration
 */

import { createServer, IncomingMessage, ServerResponse, Server } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
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
} from "../utils/security.js";

export interface SSESession {
  transport: SSEServerTransport;
}

export interface SSETransportOptions {
  port: number;
  client: FizzyClient;
  /** Maximum concurrent sessions (default: 1000) */
  maxSessions?: number;
  /** Session idle timeout in ms (default: 30 minutes) */
  sessionTimeout?: number;
  /** Security options */
  security?: SecurityOptions;
}

export interface SSETransportServer {
  server: Server;
  sessionManager: SessionManager<SSESession>;
  close: () => Promise<void>;
}

/**
 * Create request handler for SSE transport
 * Exported for testing
 */
export function createSSERequestHandler(
  client: FizzyClient,
  sessionManager: SessionManager<SSESession>,
  port: number,
  security: SecurityOptions = {}
) {
  const log = logger.child("sse");

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const sessionId = url.searchParams.get("sessionId") || undefined;

    // Health check endpoint (optionally skip security, but handle OPTIONS for CORS)
    if (url.pathname === "/health" && req.method !== "OPTIONS") {
      if (security.skipHealthCheck !== false) {
        const stats = sessionManager.getStats();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
          status: "ok", 
          transport: "sse",
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
    setSecureCorsHeaders(res, securityResult.corsOrigin!);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // SSE connection endpoint - GET /sse
    if (url.pathname === "/sse" && req.method === "GET") {
      log.debug("New SSE connection request");
      
      // Check if we can create a new session
      if (sessionManager.size >= sessionManager.maxSessions) {
        // Try to clean up expired sessions first
        sessionManager.cleanup();
        
        // Still at capacity after cleanup?
        if (sessionManager.size >= sessionManager.maxSessions) {
          log.warn("Server at capacity, rejecting new SSE connection");
          res.writeHead(503, { 
            "Content-Type": "application/json",
            "Retry-After": "60",
          });
          res.end(JSON.stringify({ 
            error: "Server at capacity",
            message: "Maximum number of concurrent sessions reached. Please try again later.",
          }));
          return;
        }
      }
      
      // Create new server instance for this session
      const server = createFizzyServer(client);
      
      // Create SSE transport with the endpoint for POST messages
      const transport = new SSEServerTransport("/messages", res);
      
      log.info(`SSE session created: ${transport.sessionId}`);
      
      // Store the session using SessionManager
      sessionManager.create(transport.sessionId, { transport });

      // Clean up on disconnect
      res.on("close", () => {
        log.info(`SSE session closed: ${transport.sessionId}`);
        sessionManager.delete(transport.sessionId);
      });

      // Connect server to transport
      await server.connect(transport);
      
      // Start the SSE stream
      await transport.start();
      return;
    }

    // Message endpoint - POST /messages
    if (url.pathname === "/messages" && req.method === "POST") {
      if (!sessionId) {
        log.warn("Message request without sessionId");
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing sessionId parameter" }));
        return;
      }

      // Use get() to update activity timestamp
      const session = sessionManager.get(sessionId);
      if (!session) {
        log.warn(`Session not found: ${sessionId}`);
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return;
      }

      log.debug(`Handling message for session: ${sessionId}`);
      
      // Handle the POST message
      await session.transport.handlePostMessage(req, res);
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  };
}

/**
 * Create SSE transport server
 */
export function createSSETransportServer(options: SSETransportOptions): SSETransportServer {
  const { port, client, maxSessions, sessionTimeout, security = {} } = options;
  const log = logger.child("sse");
  
  const sessionManager = new SessionManager<SSESession>({
    maxSessions: maxSessions ?? 1000,
    sessionTimeout: sessionTimeout ?? 30 * 60 * 1000, // 30 minutes
    onSessionEvicted: (sessionId, reason) => {
      log.info(`Session evicted (${reason}): ${sessionId}`);
    },
  });
  
  const handler = createSSERequestHandler(client, sessionManager, port, security);
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
 * Start SSE transport server
 */
export async function startSSETransport(options: SSETransportOptions): Promise<SSETransportServer> {
  const transportServer = createSSETransportServer(options);
  const log = logger.child("sse");
  const security = options.security ?? {};
  const bindAddress = getBindAddress(security);

  return new Promise((resolve) => {
    // MCP Requirement: "When running locally, servers SHOULD bind only to localhost"
    transportServer.server.listen(options.port, bindAddress, () => {
      log.info(`SSE transport running on ${bindAddress}:${options.port}`);
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

      resolve(transportServer);
    });
  });
}
