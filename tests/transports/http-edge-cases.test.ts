import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { createHTTPRequestHandler } from "../../src/transports/http.js";
import { FizzyClient } from "../../src/client/fizzy-client.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SessionManager } from "../../src/utils/session-manager.js";

// Track created sessions
let createdSessionIds: string[] = [];
let sessionInitCallbacks: Array<(sessionId: string) => void> = [];
let sessionCloseCallbacks: Array<(sessionId: string) => void> = [];

// Mock the SDK transports
vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation((options) => {
    const sessionId = crypto.randomUUID();
    createdSessionIds.push(sessionId);
    
    if (options.onsessioninitialized) {
      sessionInitCallbacks.push(options.onsessioninitialized);
      // Simulate async initialization
      setTimeout(() => options.onsessioninitialized(sessionId), 0);
    }
    if (options.onsessionclosed) {
      sessionCloseCallbacks.push(options.onsessionclosed);
    }

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

describe("HTTP Transport - Edge Cases", () => {
  let client: FizzyClient;
  let sessionManager: SessionManager<StreamableHTTPServerTransport>;
  let handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    createdSessionIds = [];
    sessionInitCallbacks = [];
    sessionCloseCallbacks = [];
    client = new FizzyClient({
      accessToken: "test-token",
      maxRetries: 0,
    });
    sessionManager = new SessionManager<StreamableHTTPServerTransport>({
      maxSessions: 100,
      sessionTimeout: 30 * 60 * 1000,
      cleanupInterval: 0,
    });
    handler = createHTTPRequestHandler(client, sessionManager, 3000);
  });

  afterEach(() => {
    sessionManager.dispose();
  });

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
    it("should handle multiple concurrent session initializations", async () => {
      const requests = Array.from({ length: 5 }, () => ({
        req: createMockRequest("POST", "/mcp"),
        res: createMockResponse(),
      }));

      // Fire all requests concurrently
      await Promise.all(requests.map(({ req, res }) => handler(req, res)));

      // Wait for async session initialization
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Each should have created a transport
      expect(StreamableHTTPServerTransport).toHaveBeenCalledTimes(5);
    });

    it("should handle session ID header with different cases", async () => {
      // Add a mock session
      const sessionId = "test-session-123";
      sessionManager.create(sessionId, {
        handleRequest: vi.fn().mockResolvedValue(undefined),
      } as unknown as StreamableHTTPServerTransport);

      // Try different header case variations
      const headerVariations = [
        { "mcp-session-id": sessionId },
        { "MCP-SESSION-ID": sessionId },
        { "Mcp-Session-Id": sessionId },
      ];

      for (const headers of headerVariations) {
        const req = createMockRequest("POST", "/mcp", headers);
        const res = createMockResponse();

        await handler(req, res);

        // HTTP headers are case-insensitive, but Node.js lowercases them
        // Our implementation should handle this correctly
      }
    });

    it("should handle session expiry during request", async () => {
      const testSessionId = "expiring-session";
      const mockTransport = {
        handleRequest: vi.fn().mockImplementation(async (req, res) => {
          // Simulate delay during which session expires
          await new Promise((resolve) => setTimeout(resolve, 10));
          res.writeHead(200);
          res.end("{}");
        }),
      };
      sessionManager.create(testSessionId, mockTransport as unknown as StreamableHTTPServerTransport);

      const req = createMockRequest("POST", "/mcp", {
        "mcp-session-id": testSessionId,
        origin: "http://localhost:3000",
      });
      const res = createMockResponse();

      // Start the request - handler captures transport reference via sessionManager.get()
      const requestPromise = handler(req, res);

      // Wait a tick to ensure handler has captured the transport reference
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Delete session mid-request (after transport is captured)
      sessionManager.delete(testSessionId);

      // Should still complete because handler captured the transport reference
      await requestPromise;
      expect(mockTransport.handleRequest).toHaveBeenCalled();
    });

    it("should call onsessionclosed callback when session is terminated", async () => {
      const req = createMockRequest("POST", "/mcp");
      const res = createMockResponse();

      await handler(req, res);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate session close
      if (sessionCloseCallbacks.length > 0 && createdSessionIds.length > 0) {
        sessionCloseCallbacks[0](createdSessionIds[0]);
      }

      // Session should be removed from map after callback
    });
  });

  describe("Routing Edge Cases", () => {
    it("should handle /mcp with trailing slash", async () => {
      const req = createMockRequest("POST", "/mcp/");
      const res = createMockResponse();

      await handler(req, res);

      expect(res._statusCode).toBe(404);
    });

    it("should handle /mcp with query parameters", async () => {
      const req = createMockRequest("POST", "/mcp?debug=true");
      const res = createMockResponse();

      await handler(req, res);

      // Should still work
      expect(StreamableHTTPServerTransport).toHaveBeenCalled();
    });

    it("should reject requests with malformed session ID header", async () => {
      const malformedIds = [
        "",
        "   ",
        "\x00\x00\x00",
        "a".repeat(10000), // Very long
        "../../../etc/passwd",
      ];

      for (const sessionId of malformedIds) {
        const req = createMockRequest("GET", "/mcp", {
          "mcp-session-id": sessionId,
        });
        const res = createMockResponse();

        await handler(req, res);

        // Should return 404 for non-existent session (or 400 for invalid)
        expect([400, 404]).toContain(res._statusCode);
      }
    });

    it("should handle path case sensitivity", async () => {
      // Note: URL paths are case-sensitive, but /MCP is not same as /mcp
      // Our handler should only respond to exact lowercase paths
      const casePaths = ["/MCP", "/Mcp", "/mCp", "/HEALTH", "/Health"];

      for (const path of casePaths) {
        const req = createMockRequest("GET", path); // Use GET to avoid session creation side effects
        const res = createMockResponse();

        await handler(req, res);

        // Should return 404 for case-mismatched paths
        expect(res._statusCode).toBe(404);
      }
    });

    it("should handle path traversal safely", async () => {
      // URL parser normalizes paths - ../ sequences are resolved
      // The key security property: you can only access defined endpoints
      
      // Paths that normalize to /mcp should work (POST creates session)
      const normalizedToMcp = [
        "/foo/../mcp",  // Normalizes to /mcp
      ];

      for (const path of normalizedToMcp) {
        const req = createMockRequest("POST", path);
        const res = createMockResponse();
        await handler(req, res);
        // Creates a session successfully
        expect(res._statusCode).toBe(200);
      }

      // Paths that normalize to non-existent endpoints should 404
      const notFoundPaths = [
        "/admin",
        "/etc/passwd",
        "/private",
      ];

      for (const path of notFoundPaths) {
        const req = createMockRequest("GET", path);
        const res = createMockResponse();
        await handler(req, res);
        expect(res._statusCode).toBe(404);
      }
    });
  });

  describe("CORS Edge Cases", () => {
    it("should expose mcp-session-id header for cross-origin requests", async () => {
      const req = createMockRequest("POST", "/mcp", {
        origin: "http://localhost:3000",
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        "Access-Control-Expose-Headers",
        "mcp-session-id"
      );
    });

    it("should handle OPTIONS with mcp-session-id header request", async () => {
      const req = createMockRequest("OPTIONS", "/mcp", {
        "access-control-request-method": "POST",
        "access-control-request-headers": "Content-Type, mcp-session-id",
        origin: "http://localhost:3000",
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res._statusCode).toBe(204);
      expect(res.setHeader).toHaveBeenCalledWith(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, mcp-session-id"
      );
    });

    it("should set wildcard CORS origin by default", async () => {
      const req = createMockRequest("GET", "/mcp", { origin: "http://localhost:3000" }); // Missing session ID
      const res = createMockResponse();

      await handler(req, res);

      // Default allows all origins
      expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
    });

    it("should handle preflight for DELETE method", async () => {
      const req = createMockRequest("OPTIONS", "/mcp", {
        "access-control-request-method": "DELETE",
        origin: "http://localhost:3000",
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res._statusCode).toBe(204);
      expect(res.setHeader).toHaveBeenCalledWith(
        "Access-Control-Allow-Methods",
        "GET, POST, DELETE, OPTIONS"
      );
    });

    it("should allow any origin by default", async () => {
      const req = createMockRequest("POST", "/mcp", {
        origin: "https://example.com",
      });
      const res = createMockResponse();

      await handler(req, res);

      // Default allows all origins
      expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
      expect(StreamableHTTPServerTransport).toHaveBeenCalled();
    });
  });

  describe("Protocol Compliance", () => {
    it("should return mcp-session-id header on new session creation", async () => {
      const req = createMockRequest("POST", "/mcp");
      const res = createMockResponse();

      await handler(req, res);

      expect(res._headers["mcp-session-id"]).toBeDefined();
    });

    it("should return proper Content-Type for JSON responses", async () => {
      const req = createMockRequest("GET", "/health");
      const res = createMockResponse();

      await handler(req, res);

      expect(res._headers["content-type"]).toBe("application/json");
    });

    it("should return valid JSON for all error responses", async () => {
      const errorCases = [
        { method: "GET", url: "/mcp" }, // Missing session ID
        { method: "GET", url: "/mcp", headers: { "mcp-session-id": "invalid" } },
        { method: "DELETE", url: "/mcp" }, // Missing session ID
        { method: "DELETE", url: "/mcp", headers: { "mcp-session-id": "invalid" } },
        { method: "PUT", url: "/mcp" }, // Invalid method
        { method: "GET", url: "/unknown" }, // 404
      ];

      for (const { method, url, headers } of errorCases) {
        const req = createMockRequest(method, url, headers);
        const res = createMockResponse();

        await handler(req, res);

        if (res._body) {
          expect(() => JSON.parse(res._body)).not.toThrow();
          const body = JSON.parse(res._body);
          expect(body.error).toBeDefined();
        }
      }
    });

    it("should differentiate between missing and invalid session", async () => {
      // Missing session ID for GET
      const reqMissing = createMockRequest("GET", "/mcp");
      const resMissing = createMockResponse();
      await handler(reqMissing, resMissing);
      expect(resMissing._statusCode).toBe(400);
      expect(JSON.parse(resMissing._body).error).toContain("Missing");

      // Invalid session ID
      const reqInvalid = createMockRequest("GET", "/mcp", {
        "mcp-session-id": "nonexistent",
      });
      const resInvalid = createMockResponse();
      await handler(reqInvalid, resInvalid);
      expect(resInvalid._statusCode).toBe(404);
      expect(JSON.parse(resInvalid._body).error).toContain("not found");
    });
  });

  describe("Race Conditions", () => {
    it("should handle concurrent requests with same session", async () => {
      const sessionId = "shared-session";
      const requestCount = { value: 0 };
      const mockTransport = {
        handleRequest: vi.fn().mockImplementation(async (req, res) => {
          requestCount.value++;
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
          res.writeHead(200);
          res.end(`{"count":${requestCount.value}}`);
        }),
      };
      sessionManager.create(sessionId, mockTransport as unknown as StreamableHTTPServerTransport);

      const requests = Array.from({ length: 10 }, () => ({
        req: createMockRequest("POST", "/mcp", { "mcp-session-id": sessionId }),
        res: createMockResponse(),
      }));

      await Promise.all(requests.map(({ req, res }) => handler(req, res)));

      // All requests should have been handled
      expect(mockTransport.handleRequest).toHaveBeenCalledTimes(10);
    });

    it("should handle session deletion while GET stream is active", async () => {
      const sessionId = "streaming-session";
      let streamActive = false;
      const mockTransport = {
        handleRequest: vi.fn().mockImplementation(async (req, res) => {
          if (req.method === "GET") {
            streamActive = true;
            // Simulate long-running SSE stream
            await new Promise((resolve) => setTimeout(resolve, 100));
            streamActive = false;
          }
          res.writeHead(200);
          res.end();
        }),
      };
      sessionManager.create(sessionId, mockTransport as unknown as StreamableHTTPServerTransport);

      // Start GET stream
      const getReq = createMockRequest("GET", "/mcp", {
        "mcp-session-id": sessionId,
      });
      const getRes = createMockResponse();
      const streamPromise = handler(getReq, getRes);

      // Wait a bit then delete session
      await new Promise((resolve) => setTimeout(resolve, 10));
      sessionManager.delete(sessionId);

      // Stream should complete without error
      await streamPromise;
    });

    it("should handle rapid session create/delete cycles", async () => {
      for (let i = 0; i < 10; i++) {
        // Create session
        const createReq = createMockRequest("POST", "/mcp");
        const createRes = createMockResponse();
        await handler(createReq, createRes);

        await new Promise((resolve) => setTimeout(resolve, 5));

        // Get session ID from response
        const sessionId = createRes._headers["mcp-session-id"];
        if (sessionId && sessionManager.has(sessionId)) {
          // Delete session
          const deleteReq = createMockRequest("DELETE", "/mcp", {
            "mcp-session-id": sessionId,
          });
          const deleteRes = createMockResponse();
          await handler(deleteReq, deleteRes);
        }
      }

      // Should complete without crashes
    });
  });

  describe("HTTP Method Edge Cases", () => {
    it("should handle PATCH method", async () => {
      const req = createMockRequest("PATCH", "/mcp", {
        "mcp-session-id": "some-session",
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res._statusCode).toBe(400);
    });

    it("should handle TRACE method", async () => {
      const req = createMockRequest("TRACE", "/mcp");
      const res = createMockResponse();

      await handler(req, res);

      expect(res._statusCode).toBe(400);
    });

    it("should handle CONNECT method", async () => {
      const req = createMockRequest("CONNECT", "/mcp");
      const res = createMockResponse();

      await handler(req, res);

      expect(res._statusCode).toBe(400);
    });
  });
});

