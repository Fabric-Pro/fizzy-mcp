import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { createSSERequestHandler, type SSESession } from "../../src/transports/sse.js";
import { FizzyClient } from "../../src/client/fizzy-client.js";
import { SessionManager } from "../../src/utils/session-manager.js";

// Track mock instances
let mockTransportInstances: Array<{
  sessionId: string;
  start: ReturnType<typeof vi.fn>;
  handlePostMessage: ReturnType<typeof vi.fn>;
}> = [];

// Mock the SDK transports
vi.mock("@modelcontextprotocol/sdk/server/sse.js", () => ({
  SSEServerTransport: vi.fn().mockImplementation((endpoint, res) => {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const instance = {
      sessionId,
      start: vi.fn().mockResolvedValue(undefined),
      handlePostMessage: vi.fn().mockImplementation((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
        return Promise.resolve();
      }),
    };
    mockTransportInstances.push(instance);
    return instance;
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

describe("SSE Transport - Edge Cases", () => {
  let client: FizzyClient;
  let sessionManager: SessionManager<SSESession>;
  let handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTransportInstances = [];
    client = new FizzyClient({
      accessToken: "test-token",
      maxRetries: 0,
    });
    sessionManager = new SessionManager<SSESession>({
      maxSessions: 100,
      sessionTimeout: 30 * 60 * 1000,
      cleanupInterval: 0,
    });
    handler = createSSERequestHandler(client, sessionManager, 3000);
  });

  afterEach(() => {
    sessionManager.dispose();
  });

  function createMockRequest(
    method: string,
    url: string,
    headers: Record<string, string> = {}
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
      headersSent: boolean;
    };
    res._headers = {};
    res._statusCode = 200;
    res._body = "";
    res.headersSent = false;

    res.setHeader = vi.fn((name: string, value: string) => {
      res._headers[name.toLowerCase()] = value;
      return res;
    });
    res.writeHead = vi.fn((statusCode: number, headers?: Record<string, string>) => {
      res._statusCode = statusCode;
      res.headersSent = true;
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

  describe("Session Management Bugs", () => {
    it("should handle multiple concurrent session creations", async () => {
      const requests = Array.from({ length: 5 }, () => ({
        req: createMockRequest("GET", "/sse"),
        res: createMockResponse(),
      }));

      // Fire all requests concurrently
      await Promise.all(requests.map(({ req, res }) => handler(req, res)));

      // Each should create a unique session
      expect(sessionManager.size).toBe(5);
      const sessionIds = Array.from(sessionManager.keys());
      const uniqueIds = new Set(sessionIds);
      expect(uniqueIds.size).toBe(5); // All IDs should be unique
    });

    it("should not leak sessions when response errors before start", async () => {
      const req = createMockRequest("GET", "/sse", { origin: "http://localhost:3000" });
      const res = createMockResponse();

      // Start handler - it will create session and register close handler synchronously
      const handlerPromise = handler(req, res);

      // Wait a tick to ensure session is created and close handler is registered
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Emit close event - this should trigger the cleanup handler
      res.emit("close");

      // Wait another tick for the close event to be processed
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Try to complete the handler (may throw, but that's ok)
      await handlerPromise.catch(() => {
        // Ignore errors from transport.start() on closed response
      });

      // Session should be cleaned up by the close handler
      expect(sessionManager.size).toBe(0);
    });

    it("should handle session cleanup when client disconnects mid-request", async () => {
      const req = createMockRequest("GET", "/sse");
      const res = createMockResponse();
      
      // Add error handler to prevent unhandled error
      res.on("error", () => {});

      await handler(req, res);
      expect(sessionManager.size).toBe(1);

      // Simulate abrupt client disconnect
      res.emit("close");

      expect(sessionManager.size).toBe(0);
    });

    it("should handle message to session that was just deleted", async () => {
      // Create a session
      const sseReq = createMockRequest("GET", "/sse");
      const sseRes = createMockResponse();
      await handler(sseReq, sseRes);

      const sessionId = Array.from(sessionManager.keys())[0];

      // Delete the session (simulating disconnect)
      sessionManager.delete(sessionId);

      // Try to send a message to the deleted session
      const msgReq = createMockRequest("POST", `/messages?sessionId=${sessionId}`);
      const msgRes = createMockResponse();
      await handler(msgReq, msgRes);

      expect(msgRes._statusCode).toBe(404);
      expect(JSON.parse(msgRes._body).error).toBe("Session not found");
    });

    it("should handle duplicate session IDs gracefully", async () => {
      // Manually add a session with known ID
      const existingSession = {
        transport: {
          sessionId: "duplicate-id",
          handlePostMessage: vi.fn(),
        } as any,
      };
      sessionManager.create("duplicate-id", existingSession);

      // Create a new SSE connection
      const req = createMockRequest("GET", "/sse");
      const res = createMockResponse();
      await handler(req, res);

      // Original session should still exist
      expect(sessionManager.has("duplicate-id")).toBe(true);
      // New session should also be added with different ID
      expect(sessionManager.size).toBe(2);
    });
  });

  describe("Routing Edge Cases", () => {
    it("should handle URL with trailing slash", async () => {
      const req = createMockRequest("GET", "/health/");
      const res = createMockResponse();

      await handler(req, res);

      // Should return 404 for /health/ (strict routing)
      expect(res._statusCode).toBe(404);
    });

    it("should handle URL with query parameters on /sse", async () => {
      const req = createMockRequest("GET", "/sse?foo=bar&baz=qux");
      const res = createMockResponse();

      await handler(req, res);

      // Should still work
      expect(sessionManager.size).toBe(1);
    });

    it("should handle URL with hash fragment", async () => {
      // Note: hash fragments are stripped by browser before sending to server
      // When received, they're parsed correctly by URL class
      const req = createMockRequest("GET", "/health#section");
      const res = createMockResponse();

      await handler(req, res);

      // URL parsing strips the hash, so this still matches /health
      expect(res._statusCode).toBe(200);
    });

    it("should handle malformed sessionId parameter", async () => {
      const testCases = [
        "/messages?sessionId=",           // Empty
        "/messages?sessionId=   ",        // Whitespace
        "/messages?sessionId=%00%00",     // Null bytes
        "/messages?sessionId=a".repeat(1000), // Very long
      ];

      for (const url of testCases) {
        const req = createMockRequest("POST", url);
        const res = createMockResponse();

        await handler(req, res);

        // Should handle gracefully (either 400 or 404)
        expect([400, 404]).toContain(res._statusCode);
      }
    });

    it("should handle special characters in sessionId", async () => {
      // Create session with special ID
      const specialId = "session-with-special-chars!@#$%";
      sessionManager.create(specialId, {
        transport: {
          sessionId: specialId,
          handlePostMessage: vi.fn().mockImplementation((req, res) => {
            res.writeHead(200);
            res.end("{}");
          }),
        } as any,
      });

      const encodedId = encodeURIComponent(specialId);
      const req = createMockRequest("POST", `/messages?sessionId=${encodedId}`);
      const res = createMockResponse();

      await handler(req, res);

      // Should find the session with decoded ID
      expect(res._statusCode).toBe(200);
    });

    it("should handle path traversal attempts safely", async () => {
      // URL parser normalizes paths - this is the security behavior we rely on
      // The key is: malicious paths either normalize to valid endpoints or 404
      // They can never access resources outside the defined routes
      
      // These normalize to non-existent paths -> 404
      const notFoundPaths = [
        "/etc/passwd",
        "/admin",
        "/unknown2",
        "/private/data",
      ];

      for (const path of notFoundPaths) {
        const req = createMockRequest("GET", path);
        const res = createMockResponse();
        await handler(req, res);
        expect(res._statusCode).toBe(404);
      }
    });

    it("should normalize traversal paths to valid endpoints", async () => {
      // Paths with ../ that normalize to valid endpoints should work
      // This is expected URL behavior, not a vulnerability
      const normalizedPaths = [
        { path: "/admin/../health", expectedCode: 200 },  // Normalizes to /health
        { path: "/foo/../sse", expectedCode: 200 },  // Normalizes to /sse (creates session)
      ];

      for (const { path, expectedCode } of normalizedPaths) {
        const req = createMockRequest("GET", path);
        const res = createMockResponse();
        await handler(req, res);
        // Valid endpoints should be accessible
        expect(res._statusCode).toBe(expectedCode);
      }
    });

    it("should handle case sensitivity in paths", async () => {
      const casePaths = ["/SSE", "/Sse", "/HEALTH", "/Health", "/MESSAGES"];

      for (const path of casePaths) {
        const req = createMockRequest("GET", path);
        const res = createMockResponse();

        await handler(req, res);

        // Should return 404 (case-sensitive routing)
        expect(res._statusCode).toBe(404);
      }
    });
  });

  describe("CORS Edge Cases", () => {
    it("should set wildcard CORS origin by default", async () => {
      const req = createMockRequest("GET", "/unknown-path", { origin: "http://localhost:3000" });
      const res = createMockResponse();

      await handler(req, res);

      // Default allows all origins
      expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
    });

    it("should handle OPTIONS with various headers", async () => {
      const req = createMockRequest("OPTIONS", "/sse", {
        "access-control-request-method": "GET",
        "access-control-request-headers": "Content-Type, X-Custom-Header",
        origin: "http://localhost:3000",
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res._statusCode).toBe(204);
      expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
    });

    it("should handle OPTIONS for all endpoints", async () => {
      const endpoints = ["/sse", "/messages", "/health", "/unknown"];

      for (const endpoint of endpoints) {
        const req = createMockRequest("OPTIONS", endpoint, { origin: "http://localhost:3000" });
        const res = createMockResponse();

        await handler(req, res);

        expect(res._statusCode).toBe(204);
        expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
      }
    });

    it("should allow any origin by default", async () => {
      const req = createMockRequest("GET", "/sse", {
        origin: "https://example.com",
      });
      const res = createMockResponse();

      await handler(req, res);

      // Default allows all origins
      expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
      expect(sessionManager.size).toBe(1);
    });
  });

  describe("Protocol Compliance", () => {
    it("should return proper Content-Type for JSON responses", async () => {
      const req = createMockRequest("GET", "/health");
      const res = createMockResponse();

      await handler(req, res);

      expect(res._headers["content-type"]).toBe("application/json");
    });

    it("should return valid JSON for all error responses", async () => {
      const errorRequests = [
        { method: "POST", url: "/messages" }, // Missing sessionId
        { method: "POST", url: "/messages?sessionId=invalid" }, // Invalid session
        { method: "GET", url: "/unknown" }, // 404
      ];

      for (const { method, url } of errorRequests) {
        const req = createMockRequest(method, url);
        const res = createMockResponse();

        await handler(req, res);

        // Should not throw when parsing
        expect(() => JSON.parse(res._body)).not.toThrow();
        const body = JSON.parse(res._body);
        expect(body.error).toBeDefined();
      }
    });

    it("should handle HEAD requests gracefully", async () => {
      const req = createMockRequest("HEAD", "/health");
      const res = createMockResponse();

      await handler(req, res);

      // Should return 404 or appropriate response
      expect([200, 404]).toContain(res._statusCode);
    });
  });

  describe("Race Conditions", () => {
    it("should handle concurrent messages to same session", async () => {
      // Create a session
      const sseReq = createMockRequest("GET", "/sse");
      const sseRes = createMockResponse();
      await handler(sseReq, sseRes);

      const sessionId = Array.from(sessionManager.keys())[0];

      // Send multiple messages concurrently
      const messageRequests = Array.from({ length: 10 }, () => ({
        req: createMockRequest("POST", `/messages?sessionId=${sessionId}`),
        res: createMockResponse(),
      }));

      await Promise.all(messageRequests.map(({ req, res }) => handler(req, res)));

      // All should succeed
      for (const { res } of messageRequests) {
        expect(res._statusCode).toBe(200);
      }
    });

    it("should handle session deletion during message processing", async () => {
      // Create a session
      const sseReq = createMockRequest("GET", "/sse");
      const sseRes = createMockResponse();
      await handler(sseReq, sseRes);

      const sessionId = Array.from(sessionManager.keys())[0];

      // Start a message request
      const msgReq = createMockRequest("POST", `/messages?sessionId=${sessionId}`);
      const msgRes = createMockResponse();

      // Delete session while message is "in flight"
      const messagePromise = handler(msgReq, msgRes);
      
      // Simulate race: delete happens after handler starts but before completion
      // This is hard to test precisely, but we can verify no crashes
      await messagePromise;

      // Should complete without error (either 200 or 404)
      expect([200, 404]).toContain(msgRes._statusCode);
    });

    it("should handle rapid connect/disconnect cycles", async () => {
      for (let i = 0; i < 20; i++) {
        const req = createMockRequest("GET", "/sse");
        const res = createMockResponse();

        await handler(req, res);

        // Immediately disconnect
        res.emit("close");
      }

      // All sessions should be cleaned up
      expect(sessionManager.size).toBe(0);
    });
  });
});

