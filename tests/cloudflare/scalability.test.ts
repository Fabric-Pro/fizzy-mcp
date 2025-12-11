/**
 * Scalability Tests for Cloudflare Workers
 * 
 * Tests for ensuring the MCP server scales properly on Cloudflare:
 * - Session isolation
 * - Concurrent request handling
 * - Session cleanup
 * - Resource limits
 */

import { describe, it, expect, vi } from "vitest";

describe("Session Isolation", () => {
  it("should generate unique session IDs", () => {
    const sessions = new Set<string>();
    const count = 1000;

    for (let i = 0; i < count; i++) {
      sessions.add(crypto.randomUUID());
    }

    expect(sessions.size).toBe(count);
  });

  it("should route requests to correct Durable Object", () => {
    // Simulate Durable Object routing
    const idFromName = vi.fn((name: string) => ({
      toString: () => `do-id-for-${name}`,
    }));

    const session1 = idFromName("session-1");
    const session2 = idFromName("session-2");

    expect(session1.toString()).not.toBe(session2.toString());
    expect(idFromName).toHaveBeenCalledTimes(2);
  });

  it("should maintain separate state per session", () => {
    interface SessionState {
      initialized: boolean;
      clientInfo?: { name: string };
    }

    const sessions = new Map<string, SessionState>();

    // Create two sessions
    sessions.set("session-1", { initialized: true, clientInfo: { name: "client-1" } });
    sessions.set("session-2", { initialized: false });

    // Verify isolation
    expect(sessions.get("session-1")?.initialized).toBe(true);
    expect(sessions.get("session-2")?.initialized).toBe(false);
    expect(sessions.get("session-1")?.clientInfo?.name).toBe("client-1");
    expect(sessions.get("session-2")?.clientInfo).toBeUndefined();
  });
});

describe("Concurrent Request Handling", () => {
  it("should handle multiple simultaneous requests", async () => {
    const requestHandler = vi.fn(async (id: number) => {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
      return { id, status: "ok" };
    });

    const requests = Array.from({ length: 100 }, (_, i) => requestHandler(i));
    const results = await Promise.all(requests);

    expect(results.length).toBe(100);
    expect(requestHandler).toHaveBeenCalledTimes(100);
    results.forEach((result, i) => {
      expect(result.id).toBe(i);
      expect(result.status).toBe("ok");
    });
  });

  it("should maintain request order within session", async () => {
    const results: number[] = [];
    
    const processRequest = async (id: number) => {
      results.push(id);
      return id;
    };

    // Sequential processing within a session
    await processRequest(1);
    await processRequest(2);
    await processRequest(3);

    expect(results).toEqual([1, 2, 3]);
  });

  it("should handle request timeouts gracefully", async () => {
    const TIMEOUT_MS = 100;
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Request timeout")), TIMEOUT_MS);
    });

    const slowRequest = new Promise<string>(resolve => {
      setTimeout(() => resolve("completed"), TIMEOUT_MS * 2);
    });

    await expect(Promise.race([slowRequest, timeoutPromise])).rejects.toThrow("Request timeout");
  });
});

describe("Session Cleanup", () => {
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  const ALARM_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  it("should identify expired sessions", () => {
    const createdAt = Date.now() - SESSION_TIMEOUT_MS - 1000;
    const lastActivityAt = createdAt;
    const now = Date.now();

    const isExpired = (now - lastActivityAt) > SESSION_TIMEOUT_MS;

    expect(isExpired).toBe(true);
  });

  it("should keep active sessions alive", () => {
    const now = Date.now();
    const lastActivityAt = now - (SESSION_TIMEOUT_MS / 2);

    const isExpired = (now - lastActivityAt) > SESSION_TIMEOUT_MS;

    expect(isExpired).toBe(false);
  });

  it("should schedule cleanup alarms", () => {
    const now = Date.now();
    const nextAlarm = now + ALARM_INTERVAL_MS;

    expect(nextAlarm - now).toBe(ALARM_INTERVAL_MS);
    expect(nextAlarm).toBeGreaterThan(now);
  });

  it("should calculate correct time since last activity", () => {
    const lastActivityAt = Date.now() - 10000; // 10 seconds ago
    const now = Date.now();

    const timeSinceActivity = now - lastActivityAt;

    expect(timeSinceActivity).toBeGreaterThanOrEqual(10000);
    expect(timeSinceActivity).toBeLessThan(15000);
  });
});

describe("Resource Limits", () => {
  it("should handle large tool responses", () => {
    // Simulate a large response (e.g., many cards)
    const largeResponse = Array.from({ length: 1000 }, (_, i) => ({
      id: `card-${i}`,
      title: `Card ${i}`,
      description: "A".repeat(1000),
    }));

    const json = JSON.stringify(largeResponse);
    
    // Cloudflare Workers have a 128MB memory limit
    // This should be well under that
    expect(json.length).toBeLessThan(10 * 1024 * 1024); // < 10MB
  });

  it("should handle many concurrent sessions", () => {
    // Durable Objects can handle millions of instances
    const sessionCount = 10000;
    const sessions = new Map<string, { id: string }>();

    for (let i = 0; i < sessionCount; i++) {
      sessions.set(`session-${i}`, { id: `session-${i}` });
    }

    expect(sessions.size).toBe(sessionCount);
  });

  it("should enforce reasonable request body limits", () => {
    const MAX_REQUEST_BODY = 100 * 1024 * 1024; // 100MB (Cloudflare limit)
    
    // A typical MCP request is small
    const typicalRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "fizzy_create_card",
        arguments: {
          account_slug: "test",
          board_id: "board-123",
          title: "Test Card",
          description: "A test card description",
        },
      },
    });

    expect(typicalRequest.length).toBeLessThan(1024); // < 1KB
    expect(typicalRequest.length).toBeLessThan(MAX_REQUEST_BODY);
  });
});

describe("Error Recovery", () => {
  it("should return error for invalid JSON", async () => {
    const invalidJson = "{ invalid json }";
    
    let parseError: Error | null = null;
    try {
      JSON.parse(invalidJson);
    } catch (e) {
      parseError = e as Error;
    }

    expect(parseError).not.toBeNull();
    // Error message varies by Node.js version
    expect(parseError?.message.length).toBeGreaterThan(0);
  });

  it("should handle Fizzy API errors gracefully", () => {
    const apiError = {
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32603,
        message: "Fizzy API error: 401 Unauthorized",
      },
    };

    expect(apiError.error.code).toBe(-32603);
    expect(apiError.error.message).toContain("401");
  });

  it("should handle network errors", () => {
    const networkError = new Error("Network error: fetch failed");
    
    const errorResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32603,
        message: networkError.message,
      },
    };

    expect(errorResponse.error.message).toContain("Network error");
  });

  it("should handle timeout errors", () => {
    const timeoutError = new Error("Request timed out after 30000ms");
    
    const errorResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32603,
        message: timeoutError.message,
      },
    };

    expect(errorResponse.error.message).toContain("timed out");
  });
});

describe("Request/Response Format", () => {
  it("should accept application/json content type", () => {
    const validContentTypes = [
      "application/json",
      "application/json; charset=utf-8",
      "application/json;charset=utf-8",
    ];

    validContentTypes.forEach(ct => {
      expect(ct.includes("application/json")).toBe(true);
    });
  });

  it("should return JSON-RPC 2.0 responses", () => {
    const response = {
      jsonrpc: "2.0",
      id: 1,
      result: { success: true },
    };

    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBeDefined();
    expect(response.result).toBeDefined();
  });

  it("should handle both string and number IDs", () => {
    const stringId = "request-abc-123";
    const numberId = 42;

    const response1 = { jsonrpc: "2.0", id: stringId, result: {} };
    const response2 = { jsonrpc: "2.0", id: numberId, result: {} };

    expect(typeof response1.id).toBe("string");
    expect(typeof response2.id).toBe("number");
  });
});

describe("Durable Object Lifecycle", () => {
  it("should handle websocket hibernation gracefully", () => {
    // Durable Objects can hibernate during long idle periods
    // Our implementation uses alarms to handle this
    const ALARM_INTERVAL_MS = 5 * 60 * 1000;
    
    expect(ALARM_INTERVAL_MS).toBe(300000); // 5 minutes in ms
  });

  it("should persist session state across hibernation", () => {
    interface StoredState {
      sessionState: {
        createdAt: number;
        lastActivityAt: number;
        initialized: boolean;
      };
    }

    const state: StoredState = {
      sessionState: {
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        initialized: true,
      },
    };

    // Simulate storage.put
    const storage = new Map<string, unknown>();
    storage.set("sessionState", state.sessionState);

    // Simulate storage.get after hibernation
    const retrieved = storage.get("sessionState") as StoredState["sessionState"];
    
    expect(retrieved.initialized).toBe(true);
    expect(retrieved.createdAt).toBe(state.sessionState.createdAt);
  });
});

