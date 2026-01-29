/**
 * MCP Session Durable Object
 * 
 * Manages stateful MCP sessions on Cloudflare Workers using
 * the Streamable HTTP transport.
 * 
 * Each session gets its own Durable Object instance that:
 * - Maintains the FizzyClient and session state
 * - Handles JSON-RPC message routing
 * - Persists across requests within the same session
 * - Logs tool invocations for audit trails
 * - Tracks metrics via Analytics Engine
 * 
 * @see https://developers.cloudflare.com/durable-objects/
 */

import { DurableObject } from "cloudflare:workers";
import { zodToJsonSchema } from "zod-to-json-schema";
import { FizzyClient } from "../client/fizzy-client.js";
import type {
  Env,
  DurableObjectState,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcMessage,
  McpSessionState,
} from "./types.js";
import {
  MCP_PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
} from "./types.js";
import { 
  createLogger, 
  createAnalytics,
  type CloudflareLogger,
  type CloudflareAnalytics,
  type LogLevel,
} from "./utils/index.js";
import { ALL_TOOLS } from "../tools/definitions.js";
import { executeToolHandler } from "../tools/handlers.js";

/**
 * Session timeout in milliseconds (30 minutes)
 */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Alarm interval for cleanup (15 minutes)
 */
const ALARM_INTERVAL_MS = 15 * 60 * 1000;

/**
 * MCP Session Durable Object
 *
 * Handles Streamable HTTP transport for MCP protocol.
 * Each session maintains a FizzyClient instance for API calls.
 */
export class McpSessionDO extends DurableObject<Env> {
  private client: FizzyClient | null = null;
  private sessionState: McpSessionState | null = null;
  private currentFizzyToken: string | null = null;
  private logger: CloudflareLogger;
  private analytics: CloudflareAnalytics;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    
    // Initialize logger with session ID
    this.logger = createLogger({
      level: (env.LOG_LEVEL as LogLevel) || "info",
      r2Bucket: env.AUDIT_LOGS,
      sessionId: ctx.id.toString(),
      consoleOutput: true,
    });
    
    // Initialize analytics
    this.analytics = createAnalytics(env.ANALYTICS);
  }

  /**
   * Initialize the session with the provided Fizzy token
   */
  private async initialize(fizzyToken: string): Promise<void> {
    if (this.client && this.currentFizzyToken === fizzyToken) {
      return;
    }

    this.sessionState = await this.ctx.storage.get<McpSessionState>("sessionState") ?? {
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      initialized: false,
    };

    this.currentFizzyToken = fizzyToken;

    this.client = new FizzyClient({
      accessToken: fizzyToken,
      baseUrl: this.env.FIZZY_BASE_URL || "https://app.fizzy.do",
    });

    const currentAlarm = await this.ctx.storage.getAlarm();
    if (!currentAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }

  /**
   * Update session activity timestamp
   */
  private async touch(): Promise<void> {
    if (this.sessionState) {
      this.sessionState.lastActivityAt = Date.now();
      await this.ctx.storage.put("sessionState", this.sessionState);
    }
  }

  /**
   * Handle incoming fetch requests
   */
  async fetch(request: Request): Promise<Response> {
    try {
      const fizzyToken = request.headers.get("X-Fizzy-Token");
      
      if (!fizzyToken) {
        return this.jsonError(401, -32603, "Missing Fizzy access token");
      }

      await this.touch();

      // Handle POST requests (Streamable HTTP)
      if (request.method === "POST") {
        return this.handlePost(request, fizzyToken);
      }

      if (request.method === "DELETE") {
        return this.handleDelete();
      }

      if (request.method === "OPTIONS") {
        return this.handleOptions(request);
      }

      return this.jsonError(400, -32600, "Invalid request method");
    } catch (error) {
      console.error("Session error:", error);
      return this.jsonError(500, -32603, error instanceof Error ? error.message : "Internal error");
    }
  }

  /**
   * Handle POST requests (Streamable HTTP transport)
   */
  private async handlePost(request: Request, fizzyToken: string): Promise<Response> {
    await this.initialize(fizzyToken);

    const contentType = request.headers.get("Content-Type");
    if (!contentType?.includes("application/json")) {
      return this.jsonError(400, -32700, "Invalid content type");
    }

    let message: JsonRpcMessage;
    try {
      message = await request.json() as JsonRpcMessage;
    } catch {
      return this.jsonError(400, -32700, "Parse error");
    }

    if ("method" in message) {
      const response = await this.handleJsonRpcRequest(message as JsonRpcRequest);
      const sessionId = this.ctx.id.toString();
      
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "mcp-session-id": sessionId,
        },
      });
    }

    return new Response(null, { status: 202 });
  }

  /**
   * Handle JSON-RPC requests
   */
  private async handleJsonRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { id, method, params } = request;

    try {
      switch (method) {
        case "initialize":
          return this.handleInitialize(id, params as Record<string, unknown>);
        
        case "initialized":
          return { jsonrpc: "2.0", id };
        
        case "ping":
          return { jsonrpc: "2.0", id, result: {} };
        
        case "tools/list":
          return this.handleToolsList(id);
        
        case "tools/call":
          return this.handleToolCall(id, params as Record<string, unknown>);
        
        case "resources/list":
          return { jsonrpc: "2.0", id, result: { resources: [] } };
        
        case "prompts/list":
          return { jsonrpc: "2.0", id, result: { prompts: [] } };
        
        default:
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          };
      }
    } catch (error) {
      console.error(`Error handling ${method}:`, error);
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Internal error",
        },
      };
    }
  }

  /**
   * Handle initialize request
   */
  private async handleInitialize(
    id: string | number | undefined,
    params: Record<string, unknown>
  ): Promise<JsonRpcResponse> {
    const clientInfo = params?.clientInfo as { name?: string; version?: string } | undefined;
    
    if (this.sessionState) {
      this.sessionState.initialized = true;
      this.sessionState.clientInfo = clientInfo;
      await this.ctx.storage.put("sessionState", this.sessionState);
    }

    // Log session initialization
    this.logger.logSessionEvent("initialized", clientInfo);
    
    // Track session initialization metrics
    this.analytics.trackSessionInitialized(
      this.ctx.id.toString(),
      clientInfo?.name,
      clientInfo?.version
    );

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
          tools: { listChanged: false },
        },
      },
    };
  }

  /**
   * Handle tools/list request
   */
  private handleToolsList(id: string | number | undefined): JsonRpcResponse {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: this.getToolDefinitions() },
    };
  }

  /**
   * Get tool definitions
   * 
   * Uses centralized tool definitions from tools/definitions.ts and converts
   * Zod schemas to JSON Schema for MCP protocol compatibility.
   */
  private getToolDefinitions(): Array<{
    name: string;
    title?: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
    };
  }> {
    return ALL_TOOLS.map((toolDef) => {
      // Convert Zod schema to JSON Schema
      const jsonSchema = zodToJsonSchema(toolDef.schema, {
        target: "jsonSchema2019-09",
        $refStrategy: "none",
      });

      // Remove $schema field (MCP defaults to 2020-12)
      if ("$schema" in jsonSchema) {
        delete jsonSchema.$schema;
      }

      // Add strict mode (additionalProperties: false)
      if (jsonSchema.type === "object") {
        jsonSchema.additionalProperties = false;
      }

      return {
        name: toolDef.name,
        title: toolDef.title,
        description: toolDef.description,
        inputSchema: jsonSchema as Record<string, unknown>,
        annotations: toolDef.annotations,
      };
    });
  }

  /**
   * Handle tools/call request
   */
  private async handleToolCall(
    id: string | number | undefined,
    params: Record<string, unknown>
  ): Promise<JsonRpcResponse> {
    const toolName = params?.name as string;
    const toolArgs = params?.arguments as Record<string, unknown> || {};
    const startTime = Date.now();

    if (!toolName) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "Missing tool name" },
      };
    }

    if (!this.client) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: "Client not initialized" },
      };
    }

    const accountSlug = (toolArgs.account_slug as string) || "unknown";

    try {
      const result = await this.executeToolCall(toolName, toolArgs);
      const durationMs = Date.now() - startTime;
      
      // Log successful tool invocation
      this.logger.logToolInvocation(toolName, accountSlug, toolArgs, {
        success: true,
        durationMs,
      });
      
      // Track metrics
      this.analytics.trackToolInvocation(
        toolName,
        accountSlug,
        true,
        durationMs,
        this.ctx.id.toString()
      );

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            },
          ],
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorInstance = error instanceof Error ? error : new Error(String(error));
      
      // Log failed tool invocation
      this.logger.logToolInvocation(toolName, accountSlug, toolArgs, {
        success: false,
        durationMs,
        error: errorInstance,
      });
      
      // Track error metrics
      this.analytics.trackToolInvocation(
        toolName,
        accountSlug,
        false,
        durationMs,
        this.ctx.id.toString()
      );
      this.analytics.trackError(
        "tool_execution",
        errorInstance.message,
        -32603,
        toolName,
        this.ctx.id.toString()
      );

      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: errorInstance.message,
        },
      };
    }
  }

  /**
   * Execute a tool call using shared handlers
   */
  private async executeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.client) throw new Error("Client not initialized");
    return executeToolHandler(this.client, toolName, args);
  }

  /**
   * Handle DELETE requests (close session)
   */
  private async handleDelete(): Promise<Response> {
    await this.ctx.storage.deleteAll();
    this.client = null;
    this.sessionState = null;

    return new Response(null, { status: 204 });
  }

  /**
   * Handle OPTIONS requests (CORS preflight)
   */
  private handleOptions(request: Request): Response {
    const origin = request.headers.get("Origin") || "*";
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-session-id",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  /**
   * Helper to create JSON error response
   * Note: id is set to null when the request id couldn't be determined (per JSON-RPC 2.0 spec)
   */
  private jsonError(status: number, code: number, message: string, id: string | number | null = null): Response {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code, message },
      }),
      {
        status,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  /**
   * Handle alarms for session cleanup
   */
  async alarm(): Promise<void> {
    const sessionState = await this.ctx.storage.get<McpSessionState>("sessionState");
    
    if (!sessionState) {
      await this.ctx.storage.deleteAll();
      return;
    }

    const now = Date.now();
    const timeSinceActivity = now - sessionState.lastActivityAt;

    if (timeSinceActivity > SESSION_TIMEOUT_MS) {
      const sessionDurationSeconds = Math.round((now - sessionState.createdAt) / 1000);
      
      // Log session expiration
      this.logger.logSessionEvent("expired", sessionState.clientInfo);
      
      // Track session expiration metrics
      this.analytics.trackSessionExpired(
        this.ctx.id.toString(),
        sessionDurationSeconds
      );
      
      console.log(`Session expired after ${Math.round(timeSinceActivity / 1000)}s of inactivity`);
      await this.ctx.storage.deleteAll();
      
      // Flush logs before cleanup
      await this.logger.flush();
      return;
    }

    await this.ctx.storage.setAlarm(now + ALARM_INTERVAL_MS);
  }
}
