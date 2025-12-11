/**
 * SSE Multi-User Authentication Tests
 * Tests per-user token authentication and data isolation
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSSETransportServer, SSETransportServer } from "../../src/transports/sse.js";
import http from "node:http";

describe("SSE Multi-User Authentication", () => {
  let server: SSETransportServer;
  const port = 3100;
  const token1 = "fizzy-token-user1";
  const token2 = "fizzy-token-user2";

  beforeEach(async () => {
    server = createSSETransportServer({
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

  it("should reject SSE connection without Authorization header", async () => {
    const response = await new Promise<http.IncomingMessage>((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/sse`, (res) => {
        resolve(res);
      });
      req.end();
    });

    expect(response.statusCode).toBe(401);
  });

  it("should accept SSE connection with valid Authorization header", async () => {
    const response = await new Promise<http.IncomingMessage>((resolve) => {
      const req = http.get(
        `http://127.0.0.1:${port}/sse`,
        {
          headers: {
            Authorization: `Bearer ${token1}`,
          },
        },
        (res) => {
          resolve(res);
          // Close the connection
          req.destroy();
        }
      );
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/event-stream");
  });

  it("should create separate sessions for different users", async () => {
    // User 1 connects
    const req1 = http.get(
      `http://127.0.0.1:${port}/sse`,
      {
        headers: {
          Authorization: `Bearer ${token1}`,
        },
      },
      () => {
        // Connection established
      }
    );

    // Wait a bit for session to be created
    await new Promise((resolve) => setTimeout(resolve, 100));

    // User 2 connects
    const req2 = http.get(
      `http://127.0.0.1:${port}/sse`,
      {
        headers: {
          Authorization: `Bearer ${token2}`,
        },
      },
      () => {
        // Connection established
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have 2 active sessions
    expect(server.sessionManager.size).toBe(2);

    // Cleanup
    req1.destroy();
    req2.destroy();
  });

  it("should reject message request with mismatched token", async () => {
    // Create a session with token1
    const sseReq = http.get(
      `http://127.0.0.1:${port}/sse`,
      {
        headers: {
          Authorization: `Bearer ${token1}`,
        },
      },
      () => {
        // Connection established
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get the session ID
    const sessions = Array.from(server.sessionManager["sessions"].keys());
    expect(sessions.length).toBe(1);
    const sessionId = sessions[0];

    // Try to send a message with a different token
    const response = await new Promise<http.IncomingMessage>((resolve) => {
      const req = http.request(
        `http://127.0.0.1:${port}/messages?sessionId=${sessionId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token2}`, // Different token!
            "Content-Type": "application/json",
          },
        },
        (res) => {
          resolve(res);
        }
      );
      req.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
      req.end();
    });

    expect(response.statusCode).toBe(403);

    // Cleanup
    sseReq.destroy();
  });
});

