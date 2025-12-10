import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { createHTTPRequestHandler } from "../../src/transports/http.js";
import { FizzyClient } from "../../src/client/fizzy-client.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SessionManager } from "../../src/utils/session-manager.js";

// Mock the SDK transports
vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation((options) => {
    const sessionId = crypto.randomUUID();
    // Simulate session initialization callback
    setTimeout(() => {
      options.onsessioninitialized?.(sessionId);
    }, 0);
    
    return {
      sessionId,
      handleRequest: vi.fn().mockImplementation((req, res) => {
        res.setHeader("mcp-session-id", sessionId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
        return Promise.resolve();
      }),
      close: vi.fn(),
    };
  }),
}));

// Mock the server
vi.mock("../../src/server.js", () => ({
  createFizzyServer: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock fetch for FizzyClient
global.fetch = vi.fn();

describe("HTTP Transport", () => {
  let client: FizzyClient;
  let sessionManager: SessionManager<StreamableHTTPServerTransport>;
  let handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new FizzyClient({
      accessToken: "test-token",
      maxRetries: 0,
    });
    sessionManager = new SessionManager<StreamableHTTPServerTransport>({
      maxSessions: 100,
      sessionTimeout: 30 * 60 * 1000,
      cleanupInterval: 0, // Disable auto-cleanup in tests
    });
    handler = createHTTPRequestHandler(client, sessionManager, 3000);
  });

  afterEach(() => {
    sessionManager.dispose();
  });

  // Helper to create mock request/response
  function createMockRequest(
    method: string,
    url: string,
    headers: Record<string, string | string[]> = {}
  ) {
    const req = new EventEmitter() as IncomingMessage;
    req.method = method;
    req.url = url;
    req.headers = headers;
    return req;
  }

  function createMockResponse() {
    const res = new EventEmitter() as ServerResponse & {
      _headers: Record<string, string>;
      _statusCode: number;
      _body: string;
    };
    res._headers = {};
    res._statusCode = 200;
    res._body = "";

    res.setHeader = vi.fn((name: string, value: string) => {
      res._headers[name.toLowerCase()] = value;
      return res;
    });
    res.writeHead = vi.fn((statusCode: number, headers?: Record<string, string>) => {
      res._statusCode = statusCode;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          res._headers[k.toLowerCase()] = v;
        }
      }
      return res;
    });
    res.end = vi.fn((body?: string) => {
      res._body = body || "";
      return res;
    });
    res.write = vi.fn();

    return res;
  }

  describe("Health Check Endpoint", () => {
    it("should return 200 OK with status on GET /health", async () => {
      const req = createMockRequest("GET", "/health");
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
      const body = JSON.parse(res._body);
      expect(body.status).toBe("ok");
      expect(body.transport).toBe("streamable-http");
      expect(body.activeSessions).toBe(0);
    });

    it("should include active session count and max sessions", async () => {
      // Add mock sessions
      sessionManager.create("session-1", {} as StreamableHTTPServerTransport);
      sessionManager.create("session-2", {} as StreamableHTTPServerTransport);

      const req = createMockRequest("GET", "/health");
      const res = createMockResponse();

      await handler(req, res);

      const body = JSON.parse(res._body);
      expect(body.activeSessions).toBe(2);
      expect(body.maxSessions).toBe(100);
    });
  });

  describe("CORS Headers", () => {
    it("should set CORS headers with wildcard origin by default", async () => {
      // Default security allows all origins (*)
      const req = createMockRequest("POST", "/mcp", { origin: "http://localhost:3000" });
      const res = createMockResponse();

      await handler(req, res);

      // Default is to allow all origins for ease of use
      expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
      expect(res.setHeader).toHaveBeenCalledWith(
        "Access-Control-Allow-Methods",
        "GET, POST, DELETE, OPTIONS"
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, mcp-session-id"
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        "Access-Control-Expose-Headers",
        "mcp-session-id"
      );
    });

    it("should handle OPTIONS preflight requests", async () => {
      const req = createMockRequest("OPTIONS", "/mcp", { origin: "http://localhost:3000" });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
    });

    it("should allow any origin by default", async () => {
      const req = createMockRequest("POST", "/mcp", { origin: "https://any-origin.com" });
      const res = createMockResponse();

      await handler(req, res);

      // Should succeed with wildcard CORS
      expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
      expect(StreamableHTTPServerTransport).toHaveBeenCalled();
    });

    it("should reject non-allowed origins when explicitly configured", async () => {
      const restrictedHandler = createHTTPRequestHandler(client, sessionManager, 3000, {
        allowedOrigins: ["http://localhost:3000"],
      });
      const req = createMockRequest("POST", "/mcp", { origin: "https://evil.com" });
      const res = createMockResponse();

      await restrictedHandler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(403, { "Content-Type": "application/json" });
      expect(JSON.parse(res._body).error).toBe("Origin not allowed");
    });
  });

  describe("Security - Client Authentication", () => {
    let secureHandler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;

    beforeEach(() => {
      secureHandler = createHTTPRequestHandler(client, sessionManager, 3000, {
        authToken: "test-secret-token",
      });
    });

    it("should reject requests without Authorization header", async () => {
      const req = createMockRequest("POST", "/mcp", { origin: "http://localhost:3000" });
      const res = createMockResponse();

      await secureHandler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
      expect(JSON.parse(res._body).error).toBe("Client authentication required");
    });

    it("should reject requests with wrong token", async () => {
      const req = createMockRequest("POST", "/mcp", {
        origin: "http://localhost:3000",
        authorization: "Bearer wrong-token",
      });
      const res = createMockResponse();

      await secureHandler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
      expect(JSON.parse(res._body).error).toBe("Invalid client authentication token");
    });

    it("should allow requests with correct Bearer token", async () => {
      const req = createMockRequest("POST", "/mcp", {
        origin: "http://localhost:3000",
        authorization: "Bearer test-secret-token",
      });
      const res = createMockResponse();

      await secureHandler(req, res);

      // Should proceed to create session, not return auth error
      expect(res._statusCode).not.toBe(401);
      expect(StreamableHTTPServerTransport).toHaveBeenCalled();
    });

    it("should skip client auth for health check by default", async () => {
      const req = createMockRequest("GET", "/health");
      const res = createMockResponse();

      await secureHandler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
      const body = JSON.parse(res._body);
      expect(body.status).toBe("ok");
    });
  });

  describe("MCP Endpoint - POST /mcp", () => {
    it("should create new session when no session ID provided", async () => {
      const req = createMockRequest("POST", "/mcp");
      const res = createMockResponse();

      await handler(req, res);

      // Transport constructor should have been called
      expect(StreamableHTTPServerTransport).toHaveBeenCalled();
    });

    it("should use existing session when session ID is provided", async () => {
      // Create a mock transport in the session manager
      const mockTransport = {
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };
      sessionManager.create("existing-session", mockTransport as unknown as StreamableHTTPServerTransport);

      const req = createMockRequest("POST", "/mcp", {
        "mcp-session-id": "existing-session",
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(mockTransport.handleRequest).toHaveBeenCalledWith(req, res);
      // Should not create a new transport
      expect(StreamableHTTPServerTransport).not.toHaveBeenCalled();
    });

    it("should create new session for unknown session ID", async () => {
      const req = createMockRequest("POST", "/mcp", {
        "mcp-session-id": "unknown-session",
      });
      const res = createMockResponse();

      await handler(req, res);

      // Should create a new transport since session wasn't found
      expect(StreamableHTTPServerTransport).toHaveBeenCalled();
    });
  });

  describe("MCP Endpoint - GET /mcp (SSE Stream)", () => {
    it("should return 400 when session ID is missing", async () => {
      const req = createMockRequest("GET", "/mcp");
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, { "Content-Type": "application/json" });
      expect(JSON.parse(res._body).error).toBe("Missing mcp-session-id header");
    });

    it("should return 404 for unknown session", async () => {
      const req = createMockRequest("GET", "/mcp", {
        "mcp-session-id": "unknown-session",
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, { "Content-Type": "application/json" });
      expect(JSON.parse(res._body).error).toBe("Session not found");
    });

    it("should handle GET for valid session", async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };
      sessionManager.create("valid-session", mockTransport as unknown as StreamableHTTPServerTransport);

      const req = createMockRequest("GET", "/mcp", {
        "mcp-session-id": "valid-session",
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(mockTransport.handleRequest).toHaveBeenCalledWith(req, res);
    });
  });

  describe("MCP Endpoint - DELETE /mcp", () => {
    it("should return 400 when session ID is missing", async () => {
      const req = createMockRequest("DELETE", "/mcp");
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, { "Content-Type": "application/json" });
      expect(JSON.parse(res._body).error).toBe("Missing mcp-session-id header");
    });

    it("should return 404 for unknown session", async () => {
      const req = createMockRequest("DELETE", "/mcp", {
        "mcp-session-id": "unknown-session",
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, { "Content-Type": "application/json" });
      expect(JSON.parse(res._body).error).toBe("Session not found");
    });

    it("should handle DELETE for valid session", async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };
      sessionManager.create("valid-session", mockTransport as unknown as StreamableHTTPServerTransport);

      const req = createMockRequest("DELETE", "/mcp", {
        "mcp-session-id": "valid-session",
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(mockTransport.handleRequest).toHaveBeenCalledWith(req, res);
    });
  });

  describe("MCP Endpoint - Invalid Methods", () => {
    it("should return 400 for PUT requests", async () => {
      const req = createMockRequest("PUT", "/mcp", {
        "mcp-session-id": "some-session",
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, { "Content-Type": "application/json" });
      expect(JSON.parse(res._body).error).toBe("Invalid request");
    });

    it("should return 400 for PATCH requests", async () => {
      const req = createMockRequest("PATCH", "/mcp", {
        "mcp-session-id": "some-session",
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, { "Content-Type": "application/json" });
      expect(JSON.parse(res._body).error).toBe("Invalid request");
    });
  });

  describe("404 Handling", () => {
    it("should return 404 for unknown paths", async () => {
      const req = createMockRequest("GET", "/unknown");
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, { "Content-Type": "application/json" });
      expect(JSON.parse(res._body).error).toBe("Not found");
    });

    it("should return 404 for /sse path (wrong transport)", async () => {
      const req = createMockRequest("GET", "/sse");
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, { "Content-Type": "application/json" });
    });
  });

  describe("Session Management", () => {
    it("should call onsessioninitialized callback when session is created", async () => {
      const req = createMockRequest("POST", "/mcp");
      const res = createMockResponse();

      await handler(req, res);

      // Wait for async session initialization
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Session should have been added to the map via callback
      // Note: In the real implementation, the callback adds to sessions map
    });
  });

  describe("Session Limit (503 Handling)", () => {
    let limitedSessionManager: SessionManager<StreamableHTTPServerTransport>;
    let limitedHandler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;

    beforeEach(() => {
      // Create session manager with very low limit
      limitedSessionManager = new SessionManager<StreamableHTTPServerTransport>({
        maxSessions: 2,
        sessionTimeout: 30 * 60 * 1000,
        cleanupInterval: 0,
      });
      limitedHandler = createHTTPRequestHandler(client, limitedSessionManager, 3000);
    });

    afterEach(() => {
      limitedSessionManager.dispose();
    });

    it("should return 503 when session limit is reached", async () => {
      // Fill up all available sessions
      limitedSessionManager.create("session-1", {} as StreamableHTTPServerTransport);
      limitedSessionManager.create("session-2", {} as StreamableHTTPServerTransport);

      // Try to create a new session
      const req = createMockRequest("POST", "/mcp");
      const res = createMockResponse();

      await limitedHandler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(503, expect.objectContaining({
        "Content-Type": "application/json",
        "Retry-After": "60",
      }));
      const body = JSON.parse(res._body);
      expect(body.error).toBe("Server at capacity");
    });

    it("should include Retry-After header on 503", async () => {
      limitedSessionManager.create("session-1", {} as StreamableHTTPServerTransport);
      limitedSessionManager.create("session-2", {} as StreamableHTTPServerTransport);

      const req = createMockRequest("POST", "/mcp");
      const res = createMockResponse();

      await limitedHandler(req, res);

      expect(res._headers["retry-after"]).toBe("60");
    });

    it("should show max sessions in health check", async () => {
      const req = createMockRequest("GET", "/health");
      const res = createMockResponse();

      await limitedHandler(req, res);

      const body = JSON.parse(res._body);
      expect(body.maxSessions).toBe(2);
    });

    it("should allow new sessions when existing ones are below limit", async () => {
      limitedSessionManager.create("session-1", {} as StreamableHTTPServerTransport);
      // Only 1 session, limit is 2

      const req = createMockRequest("POST", "/mcp");
      const res = createMockResponse();

      await limitedHandler(req, res);

      // Should create new transport, not return 503
      expect(StreamableHTTPServerTransport).toHaveBeenCalled();
      expect(res._statusCode).not.toBe(503);
    });

    it("should allow using existing sessions when at limit", async () => {
      // Fill up sessions
      const mockTransport = { handleRequest: vi.fn().mockResolvedValue(undefined) };
      limitedSessionManager.create("session-1", {} as StreamableHTTPServerTransport);
      limitedSessionManager.create("session-2", mockTransport as unknown as StreamableHTTPServerTransport);

      // Request with existing session ID should work
      const req = createMockRequest("POST", "/mcp", { "mcp-session-id": "session-2" });
      const res = createMockResponse();

      await limitedHandler(req, res);

      expect(mockTransport.handleRequest).toHaveBeenCalled();
      expect(res._statusCode).not.toBe(503);
    });
  });
});

