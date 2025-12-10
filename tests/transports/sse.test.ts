import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { createSSERequestHandler, type SSESession } from "../../src/transports/sse.js";
import { FizzyClient } from "../../src/client/fizzy-client.js";
import { SessionManager } from "../../src/utils/session-manager.js";

// Mock the SDK transports
vi.mock("@modelcontextprotocol/sdk/server/sse.js", () => ({
  SSEServerTransport: vi.fn().mockImplementation((endpoint, res) => {
    const sessionId = `test-session-${Date.now()}`;
    return {
      sessionId,
      start: vi.fn().mockResolvedValue(undefined),
      handlePostMessage: vi.fn().mockImplementation((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
      }),
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

describe("SSE Transport", () => {
  let client: FizzyClient;
  let sessionManager: SessionManager<SSESession>;
  let handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new FizzyClient({
      accessToken: "test-token",
      maxRetries: 0,
    });
    sessionManager = new SessionManager<SSESession>({
      maxSessions: 100,
      sessionTimeout: 30 * 60 * 1000,
      cleanupInterval: 0, // Disable auto-cleanup in tests
    });
    handler = createSSERequestHandler(client, sessionManager, 3000);
  });

  afterEach(() => {
    sessionManager.dispose();
  });

  // Helper to create mock request/response
  function createMockRequest(method: string, url: string, headers: Record<string, string> = {}) {
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
      expect(body.transport).toBe("sse");
      expect(body.activeSessions).toBe(0);
    });

    it("should include active session count and max sessions", async () => {
      // Add mock sessions
      sessionManager.create("session-1", { transport: {} as any });
      sessionManager.create("session-2", { transport: {} as any });

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
      const req = createMockRequest("GET", "/sse", { origin: "http://localhost:3000" });
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
    });

    it("should handle OPTIONS preflight requests", async () => {
      const req = createMockRequest("OPTIONS", "/sse", { origin: "http://localhost:3000" });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
    });

    it("should allow any origin by default", async () => {
      const req = createMockRequest("GET", "/sse", { origin: "https://any-origin.com" });
      const res = createMockResponse();

      await handler(req, res);

      // Should succeed with wildcard CORS
      expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
      expect(sessionManager.size).toBe(1);
    });

    it("should reject non-allowed origins when explicitly configured", async () => {
      const restrictedHandler = createSSERequestHandler(client, sessionManager, 3000, {
        allowedOrigins: ["http://localhost:3000"],
      });
      const req = createMockRequest("GET", "/sse", { origin: "https://evil.com" });
      const res = createMockResponse();

      await restrictedHandler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(403, { "Content-Type": "application/json" });
      expect(JSON.parse(res._body).error).toBe("Origin not allowed");
    });
  });

  describe("Security - Client Authentication", () => {
    let secureHandler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;

    beforeEach(() => {
      secureHandler = createSSERequestHandler(client, sessionManager, 3000, {
        authToken: "test-secret-token",
      });
    });

    it("should reject requests without Authorization header", async () => {
      const req = createMockRequest("GET", "/sse", { origin: "http://localhost:3000" });
      const res = createMockResponse();

      await secureHandler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
      expect(JSON.parse(res._body).error).toBe("Client authentication required");
    });

    it("should allow requests with correct Bearer token", async () => {
      const req = createMockRequest("GET", "/sse", {
        origin: "http://localhost:3000",
        authorization: "Bearer test-secret-token",
      });
      const res = createMockResponse();

      await secureHandler(req, res);

      // Should proceed to create session, not return auth error
      expect(res._statusCode).not.toBe(401);
      expect(sessionManager.size).toBe(1);
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

  describe("SSE Connection Endpoint (GET /sse)", () => {
    it("should create a new session on GET /sse", async () => {
      const req = createMockRequest("GET", "/sse");
      const res = createMockResponse();

      await handler(req, res);

      // Session should be created
      expect(sessionManager.size).toBe(1);
    });

    it("should clean up session on disconnect", async () => {
      const req = createMockRequest("GET", "/sse");
      const res = createMockResponse();

      await handler(req, res);

      expect(sessionManager.size).toBe(1);

      // Simulate disconnect
      res.emit("close");

      expect(sessionManager.size).toBe(0);
    });
  });

  describe("Message Endpoint (POST /messages)", () => {
    it("should return 400 when sessionId is missing", async () => {
      const req = createMockRequest("POST", "/messages");
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, { "Content-Type": "application/json" });
      expect(JSON.parse(res._body).error).toBe("Missing sessionId parameter");
    });

    it("should return 404 when session is not found", async () => {
      const req = createMockRequest("POST", "/messages?sessionId=invalid-session");
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, { "Content-Type": "application/json" });
      expect(JSON.parse(res._body).error).toBe("Session not found");
    });

    it("should handle message for valid session", async () => {
      // Create a session first
      const mockTransport = {
        sessionId: "valid-session-id",
        handlePostMessage: vi.fn().mockImplementation((req, res) => {
          res.writeHead(200);
          res.end('{"jsonrpc":"2.0","id":1,"result":{}}');
        }),
      };
      sessionManager.create("valid-session-id", { transport: mockTransport as any });

      const req = createMockRequest("POST", "/messages?sessionId=valid-session-id");
      const res = createMockResponse();

      await handler(req, res);

      expect(mockTransport.handlePostMessage).toHaveBeenCalledWith(req, res);
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

    it("should return 404 for wrong method on /sse", async () => {
      const req = createMockRequest("POST", "/sse");
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, { "Content-Type": "application/json" });
    });

    it("should return 404 for wrong method on /messages", async () => {
      const req = createMockRequest("GET", "/messages");
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, { "Content-Type": "application/json" });
    });
  });

  describe("Session Limit (503 Handling)", () => {
    let limitedSessionManager: SessionManager<SSESession>;
    let limitedHandler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;

    beforeEach(() => {
      limitedSessionManager = new SessionManager<SSESession>({
        maxSessions: 2,
        sessionTimeout: 30 * 60 * 1000,
        cleanupInterval: 0,
      });
      limitedHandler = createSSERequestHandler(client, limitedSessionManager, 3000);
    });

    afterEach(() => {
      limitedSessionManager.dispose();
    });

    it("should return 503 when session limit is reached", async () => {
      // Fill up all available sessions
      limitedSessionManager.create("session-1", { transport: {} as any });
      limitedSessionManager.create("session-2", { transport: {} as any });

      const req = createMockRequest("GET", "/sse");
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
      limitedSessionManager.create("session-1", { transport: {} as any });
      limitedSessionManager.create("session-2", { transport: {} as any });

      const req = createMockRequest("GET", "/sse");
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

    it("should allow new sessions when below limit", async () => {
      limitedSessionManager.create("session-1", { transport: {} as any });
      // Only 1 session, limit is 2

      const req = createMockRequest("GET", "/sse");
      const res = createMockResponse();

      await limitedHandler(req, res);

      // Should create new session, not return 503
      expect(res._statusCode).not.toBe(503);
      expect(limitedSessionManager.size).toBe(2);
    });

    it("should allow messages to existing sessions when at limit", async () => {
      const mockTransport = { handlePostMessage: vi.fn().mockResolvedValue(undefined) };
      limitedSessionManager.create("session-1", { transport: {} as any });
      limitedSessionManager.create("session-2", { transport: mockTransport as any });

      const req = createMockRequest("POST", "/messages?sessionId=session-2");
      const res = createMockResponse();

      await limitedHandler(req, res);

      expect(mockTransport.handlePostMessage).toHaveBeenCalled();
      expect(res._statusCode).not.toBe(503);
    });
  });
});
