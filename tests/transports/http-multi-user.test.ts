/**
 * HTTP Multi-User Authentication Tests
 * Tests per-user token authentication and data isolation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHTTPTransportServer, HTTPTransportServer } from "../../src/transports/http.js";
import http from "node:http";

// Mock FizzyClient to avoid actual API calls
vi.mock("../../src/client/fizzy-client.js", () => ({
  FizzyClient: vi.fn().mockImplementation(() => ({
    // Mock client methods as needed
  })),
}));

// Mock the server to avoid actual MCP server creation
vi.mock("../../src/server.js", () => ({
  createFizzyServer: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock StreamableHTTPServerTransport
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

describe("HTTP Multi-User Authentication", () => {
  let server: HTTPTransportServer;
  const port = 3200;
  const token1 = "fizzy-token-user1";
  const token2 = "fizzy-token-user2";

  beforeEach(async () => {
    server = createHTTPTransportServer({
      port,
      maxSessions: 10,
    });

    await new Promise<void>((resolve) => {
      server.server.listen(port, "127.0.0.1", () => resolve());
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("should reject POST request without Authorization header", async () => {
    const response = await new Promise<http.IncomingMessage>((resolve) => {
      const req = http.request(
        `http://127.0.0.1:${port}/mcp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        },
        (res) => {
          resolve(res);
        }
      );
      req.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
      req.end();
    });

    expect(response.statusCode).toBe(401);
  });

  it("should accept POST request with valid Authorization header", async () => {
    const response = await new Promise<http.IncomingMessage>((resolve) => {
      const req = http.request(
        `http://127.0.0.1:${port}/mcp`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token1}`,
            "Content-Type": "application/json",
          },
        },
        (res) => {
          resolve(res);
        }
      );
      req.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
      req.end();
    });

    expect(response.statusCode).toBe(200);
  });

  it("should create separate sessions for different users", async () => {
    // User 1 initializes
    await new Promise<void>((resolve) => {
      const req = http.request(
        `http://127.0.0.1:${port}/mcp`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token1}`,
            "Content-Type": "application/json",
          },
        },
        () => {
          resolve();
        }
      );
      req.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
      req.end();
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // User 2 initializes
    await new Promise<void>((resolve) => {
      const req = http.request(
        `http://127.0.0.1:${port}/mcp`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token2}`,
            "Content-Type": "application/json",
          },
        },
        () => {
          resolve();
        }
      );
      req.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
      req.end();
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have 2 active sessions
    expect(server.sessionManager.size).toBe(2);
  });

  it("should reject request with mismatched token for existing session", async () => {
    // Create a session with token1
    let sessionId: string | undefined;
    await new Promise<void>((resolve) => {
      const req = http.request(
        `http://127.0.0.1:${port}/mcp`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token1}`,
            "Content-Type": "application/json",
          },
        },
        (res) => {
          sessionId = res.headers["mcp-session-id"] as string;
          resolve();
        }
      );
      req.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
      req.end();
    });

    expect(sessionId).toBeDefined();

    // Try to use the session with a different token
    const response = await new Promise<http.IncomingMessage>((resolve) => {
      const req = http.request(
        `http://127.0.0.1:${port}/mcp`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token2}`, // Different token!
            "Content-Type": "application/json",
            "mcp-session-id": sessionId!,
          },
        },
        (res) => {
          resolve(res);
        }
      );
      req.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }));
      req.end();
    });

    expect(response.statusCode).toBe(403);
  });
});

