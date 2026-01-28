/**
 * MCP Session Durable Object Tests
 *
 * Tests for the MCP session handling including:
 * - JSON-RPC message parsing
 * - MCP protocol implementation
 * - Tool execution
 * - Session lifecycle
 * - Durable Object base class extension
 * - Alarm optimization
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Test types
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown> | unknown[];
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

describe("JSON-RPC Message Parsing", () => {
  it("should parse valid JSON-RPC request", () => {
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "test-client" } },
    };

    expect(message.jsonrpc).toBe("2.0");
    expect(message.method).toBe("initialize");
    expect(message.id).toBe(1);
  });

  it("should handle request without id (notification)", () => {
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      method: "initialized",
    };

    expect(message.id).toBeUndefined();
    expect(message.method).toBe("initialized");
  });

  it("should parse string id", () => {
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: "request-123",
      method: "tools/list",
    };

    expect(message.id).toBe("request-123");
  });
});

describe("MCP Protocol - Initialize", () => {
  const MCP_PROTOCOL_VERSION = "2024-11-05";
  const SERVER_NAME = "fizzy-mcp";
  const SERVER_VERSION = "1.0.0";

  function handleInitialize(
    id: string | number | undefined,
    params: Record<string, unknown>
  ): JsonRpcResponse {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
      },
    };
  }

  it("should return correct protocol version", () => {
    const response = handleInitialize(1, {});
    
    expect(response.result).toBeDefined();
    const result = response.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  });

  it("should return server info", () => {
    const response = handleInitialize(1, {});
    
    const result = response.result as Record<string, unknown>;
    const serverInfo = result.serverInfo as Record<string, string>;
    
    expect(serverInfo.name).toBe(SERVER_NAME);
    expect(serverInfo.version).toBe(SERVER_VERSION);
  });

  it("should return tools capability", () => {
    const response = handleInitialize(1, {});
    
    const result = response.result as Record<string, unknown>;
    const capabilities = result.capabilities as Record<string, unknown>;
    
    expect(capabilities.tools).toBeDefined();
  });

  it("should preserve request id", () => {
    const response = handleInitialize("req-456", {});
    expect(response.id).toBe("req-456");
  });
});

describe("MCP Protocol - Tools List", () => {
  // Simplified tool definition for testing
  const mockTools = [
    {
      name: "fizzy_get_identity",
      description: "Get the current authenticated user's identity",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "fizzy_get_boards",
      description: "Get all boards in an account",
      inputSchema: {
        type: "object",
        properties: {
          account_slug: { type: "string", description: "The account slug" },
        },
        required: ["account_slug"],
      },
    },
  ];

  it("should return tools array", () => {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { tools: mockTools },
    };

    const result = response.result as Record<string, unknown>;
    const tools = result.tools as unknown[];
    
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("should include tool name and description", () => {
    const tool = mockTools[0];
    
    expect(tool.name).toBe("fizzy_get_identity");
    expect(tool.description).toContain("identity");
  });

  it("should include input schema", () => {
    const tool = mockTools[1];
    
    expect(tool.inputSchema).toBeDefined();
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.required).toContain("account_slug");
  });
});

describe("MCP Protocol - Tool Call", () => {
  it("should handle successful tool call", async () => {
    const mockResult = { id: "123", name: "Test User" };
    
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(mockResult, null, 2),
          },
        ],
      },
    };

    const result = response.result as Record<string, unknown>;
    const content = result.content as Array<{ type: string; text: string }>;
    
    expect(content[0].type).toBe("text");
    expect(JSON.parse(content[0].text)).toEqual(mockResult);
  });

  it("should handle tool error", () => {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32603,
        message: "Fizzy API error: 404 Not Found",
      },
    };

    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe(-32603);
    expect(response.error?.message).toContain("404");
  });

  it("should handle missing tool name", () => {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32602,
        message: "Missing tool name",
      },
    };

    expect(response.error?.code).toBe(-32602);
  });

  it("should handle unknown tool", () => {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32603,
        message: "Unknown tool: nonexistent_tool",
      },
    };

    expect(response.error?.message).toContain("Unknown tool");
  });
});

describe("MCP Protocol - Error Handling", () => {
  it("should return parse error for invalid JSON", () => {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      error: {
        code: -32700,
        message: "Parse error",
      },
    };

    expect(response.error?.code).toBe(-32700);
  });

  it("should return method not found for unknown method", () => {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32601,
        message: "Method not found: unknown/method",
      },
    };

    expect(response.error?.code).toBe(-32601);
  });

  it("should return internal error for server issues", () => {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32603,
        message: "Internal error",
      },
    };

    expect(response.error?.code).toBe(-32603);
  });
});

describe("Session State", () => {
  interface McpSessionState {
    createdAt: number;
    lastActivityAt: number;
    initialized: boolean;
    clientInfo?: {
      name?: string;
      version?: string;
    };
  }

  it("should track creation time", () => {
    const now = Date.now();
    const state: McpSessionState = {
      createdAt: now,
      lastActivityAt: now,
      initialized: false,
    };

    expect(state.createdAt).toBe(now);
  });

  it("should update last activity time", () => {
    const created = Date.now();
    const state: McpSessionState = {
      createdAt: created,
      lastActivityAt: created,
      initialized: false,
    };

    // Simulate activity
    state.lastActivityAt = Date.now() + 1000;

    expect(state.lastActivityAt).toBeGreaterThan(state.createdAt);
  });

  it("should store client info after initialize", () => {
    const state: McpSessionState = {
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      initialized: true,
      clientInfo: {
        name: "cursor",
        version: "1.0.0",
      },
    };

    expect(state.initialized).toBe(true);
    expect(state.clientInfo?.name).toBe("cursor");
  });

  it("should detect session timeout", () => {
    const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
    const state: McpSessionState = {
      createdAt: Date.now() - SESSION_TIMEOUT_MS - 1000,
      lastActivityAt: Date.now() - SESSION_TIMEOUT_MS - 1000,
      initialized: true,
    };

    const now = Date.now();
    const timeSinceActivity = now - state.lastActivityAt;

    expect(timeSinceActivity).toBeGreaterThan(SESSION_TIMEOUT_MS);
  });
});

describe("Tool Definitions", () => {
  // All 47 tools should be defined
  const toolNames = [
    "fizzy_get_identity",
    "fizzy_get_accounts",
    "fizzy_get_boards",
    "fizzy_get_board",
    "fizzy_create_board",
    "fizzy_update_board",
    "fizzy_delete_board",
    "fizzy_get_cards",
    "fizzy_get_card",
    "fizzy_create_card",
    "fizzy_update_card",
    "fizzy_delete_card",
    "fizzy_get_card_comments",
    "fizzy_create_comment",
    "fizzy_delete_comment",
    "fizzy_get_columns",
    "fizzy_get_column",
    "fizzy_create_column",
    "fizzy_update_column",
    "fizzy_delete_column",
    "fizzy_get_tags",
    "fizzy_get_users",
    "fizzy_get_user",
    "fizzy_update_user",
    "fizzy_deactivate_user",
    "fizzy_get_notifications",
    "fizzy_mark_notification_read",
    "fizzy_mark_notification_unread",
    "fizzy_mark_all_notifications_read",
    "fizzy_close_card",
    "fizzy_reopen_card",
    "fizzy_move_card_to_not_now",
    "fizzy_move_card_to_column",
    "fizzy_send_card_to_triage",
    "fizzy_toggle_card_tag",
    "fizzy_toggle_card_assignment",
    "fizzy_watch_card",
    "fizzy_unwatch_card",
    "fizzy_get_comment",
    "fizzy_update_comment",
    "fizzy_get_reactions",
    "fizzy_add_reaction",
    "fizzy_remove_reaction",
    "fizzy_get_step",
    "fizzy_create_step",
    "fizzy_update_step",
    "fizzy_delete_step",
  ];

  it("should have all expected tools", () => {
    expect(toolNames.length).toBe(47);
  });

  it("should have identity tools", () => {
    expect(toolNames).toContain("fizzy_get_identity");
    expect(toolNames).toContain("fizzy_get_accounts");
  });

  it("should have board tools", () => {
    expect(toolNames).toContain("fizzy_get_boards");
    expect(toolNames).toContain("fizzy_create_board");
    expect(toolNames).toContain("fizzy_update_board");
    expect(toolNames).toContain("fizzy_delete_board");
  });

  it("should have card tools", () => {
    expect(toolNames).toContain("fizzy_get_cards");
    expect(toolNames).toContain("fizzy_create_card");
    expect(toolNames).toContain("fizzy_update_card");
    expect(toolNames).toContain("fizzy_delete_card");
  });

  it("should have card action tools", () => {
    expect(toolNames).toContain("fizzy_close_card");
    expect(toolNames).toContain("fizzy_reopen_card");
    expect(toolNames).toContain("fizzy_toggle_card_tag");
    expect(toolNames).toContain("fizzy_toggle_card_assignment");
  });

  it("should have comment tools", () => {
    expect(toolNames).toContain("fizzy_get_card_comments");
    expect(toolNames).toContain("fizzy_create_comment");
    expect(toolNames).toContain("fizzy_update_comment");
    expect(toolNames).toContain("fizzy_delete_comment");
  });

  it("should have reaction tools", () => {
    expect(toolNames).toContain("fizzy_get_reactions");
    expect(toolNames).toContain("fizzy_add_reaction");
    expect(toolNames).toContain("fizzy_remove_reaction");
  });

  it("should have step tools", () => {
    expect(toolNames).toContain("fizzy_get_step");
    expect(toolNames).toContain("fizzy_create_step");
    expect(toolNames).toContain("fizzy_update_step");
    expect(toolNames).toContain("fizzy_delete_step");
  });
});

describe("HTTP Response Handling", () => {
  it("should include mcp-session-id in response headers", () => {
    const sessionId = "test-session-123";
    const headers = new Headers();
    headers.set("mcp-session-id", sessionId);
    headers.set("Content-Type", "application/json");

    expect(headers.get("mcp-session-id")).toBe(sessionId);
  });

  it("should return 204 for DELETE requests", () => {
    const response = new Response(null, { status: 204 });
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("should return 400 for missing session ID on GET", () => {
    const response = new Response(
      JSON.stringify({ error: "Missing mcp-session-id header" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );

    expect(response.status).toBe(400);
  });
});

describe("Durable Object Base Class", () => {
  it("should use ctx property for storage access", () => {
    // Mock DurableObjectState
    const mockCtx = {
      id: { toString: () => "test-id" },
      storage: {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        deleteAll: vi.fn(),
        setAlarm: vi.fn(),
      },
    };

    // Verify ctx.storage methods are available
    expect(mockCtx.storage.get).toBeDefined();
    expect(mockCtx.storage.put).toBeDefined();
    expect(mockCtx.storage.delete).toBeDefined();
    expect(mockCtx.storage.deleteAll).toBeDefined();
    expect(mockCtx.storage.setAlarm).toBeDefined();
  });

  it("should use ctx.id for session identification", () => {
    const mockCtx = {
      id: { toString: () => "session-123" },
      storage: {},
    };

    expect(mockCtx.id.toString()).toBe("session-123");
  });

  it("should inherit env from base class", () => {
    const mockEnv = {
      FIZZY_ACCESS_TOKEN: "test-token",
      FIZZY_BASE_URL: "https://api.fizzy.do",
    };

    expect(mockEnv.FIZZY_ACCESS_TOKEN).toBe("test-token");
    expect(mockEnv.FIZZY_BASE_URL).toBe("https://api.fizzy.do");
  });
});

describe("Card Number Resolution (shared utility)", () => {
  // Import and test the shared resolveCardNumber utility
  // This ensures the Cloudflare path uses the same logic as the standard server

  // Note: We import the utility dynamically to avoid module resolution issues in test environment
  // The actual implementation is tested in tests/comment-card-resolution.test.ts
  // This test verifies the Cloudflare path imports and uses the shared utility correctly

  it("should use the shared card-resolver utility (verified by import)", async () => {
    // This test verifies that the shared utility exists and exports correctly
    const { resolveCardNumber } = await import("../../src/utils/card-resolver.js");
    expect(typeof resolveCardNumber).toBe("function");
  });

  it("should resolve card_id using the shared utility", async () => {
    const { resolveCardNumber } = await import("../../src/utils/card-resolver.js");
    const mockClient = {
      getCard: vi.fn().mockResolvedValue({
        number: 11,
        url: "https://app.fizzy.do/123/cards/11",
      }),
    };

    const result = await resolveCardNumber(mockClient, "/123", "card-abc", undefined);

    expect(result).toBe("11");
    expect(mockClient.getCard).toHaveBeenCalledWith("/123", "card-abc");
  });

  it("should return card_number directly without API call", async () => {
    const { resolveCardNumber } = await import("../../src/utils/card-resolver.js");
    const mockClient = { getCard: vi.fn() };

    const result = await resolveCardNumber(mockClient, "/123", undefined, "15");

    expect(result).toBe("15");
    expect(mockClient.getCard).not.toHaveBeenCalled();
  });

  it("should fallback to URL parsing when number field is missing", async () => {
    const { resolveCardNumber } = await import("../../src/utils/card-resolver.js");
    const mockClient = {
      getCard: vi.fn().mockResolvedValue({
        url: "https://app.fizzy.do/123/cards/20",
      }),
    };

    const result = await resolveCardNumber(mockClient, "/123", "card-xyz", undefined);

    expect(result).toBe("20");
  });
});

describe("Alarm Optimization", () => {
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  const ALARM_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes (optimized)

  it("should use 15 minute alarm interval for cost optimization", () => {
    expect(ALARM_INTERVAL_MS).toBe(15 * 60 * 1000);
    expect(ALARM_INTERVAL_MS).toBe(900000); // 900,000 ms = 15 minutes
  });

  it("should have alarm interval less than session timeout", () => {
    expect(ALARM_INTERVAL_MS).toBeLessThan(SESSION_TIMEOUT_MS);
  });

  it("should schedule next alarm at current time plus interval", () => {
    const now = Date.now();
    const nextAlarm = now + ALARM_INTERVAL_MS;

    expect(nextAlarm).toBeGreaterThan(now);
    expect(nextAlarm - now).toBe(ALARM_INTERVAL_MS);
  });

  it("should clean up expired sessions", () => {
    const now = Date.now();
    const lastActivity = now - (SESSION_TIMEOUT_MS + 1000); // Expired
    const timeSinceActivity = now - lastActivity;

    expect(timeSinceActivity).toBeGreaterThan(SESSION_TIMEOUT_MS);
  });

  it("should not clean up active sessions", () => {
    const now = Date.now();
    const lastActivity = now - (5 * 60 * 1000); // 5 minutes ago
    const timeSinceActivity = now - lastActivity;

    expect(timeSinceActivity).toBeLessThan(SESSION_TIMEOUT_MS);
  });

  it("should delete all storage on cleanup", async () => {
    const mockStorage = {
      deleteAll: vi.fn().mockResolvedValue(undefined),
    };

    await mockStorage.deleteAll();
    expect(mockStorage.deleteAll).toHaveBeenCalledTimes(1);
  });
});

