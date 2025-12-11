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
 * 
 * @see https://developers.cloudflare.com/durable-objects/
 */

import { DurableObject } from "cloudflare:workers";
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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
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
    if (this.sessionState) {
      this.sessionState.initialized = true;
      this.sessionState.clientInfo = params?.clientInfo as { name?: string; version?: string };
      await this.ctx.storage.put("sessionState", this.sessionState);
    }

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
   */
  private getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      // Identity Tools
      { name: "fizzy_get_identity", description: "Get the current authenticated user's identity and associated accounts", inputSchema: { type: "object", properties: {}, required: [] } },
      { name: "fizzy_get_accounts", description: "Get all accounts accessible to the current user", inputSchema: { type: "object", properties: {}, required: [] } },
      
      // Board Tools
      { name: "fizzy_get_boards", description: "Get all boards in an account", inputSchema: { type: "object", properties: { account_slug: { type: "string", description: "The account slug identifier" } }, required: ["account_slug"] } },
      { name: "fizzy_get_board", description: "Get details of a specific board", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, board_id: { type: "string" } }, required: ["account_slug", "board_id"] } },
      { name: "fizzy_create_board", description: "Create a new board in an account", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, name: { type: "string" } }, required: ["account_slug", "name"] } },
      { name: "fizzy_update_board", description: "Update an existing board", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, board_id: { type: "string" }, name: { type: "string" } }, required: ["account_slug", "board_id", "name"] } },
      { name: "fizzy_delete_board", description: "Delete a board", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, board_id: { type: "string" } }, required: ["account_slug", "board_id"] } },
      
      // Card Tools
      { name: "fizzy_get_cards", description: "Get all cards in an account, optionally filtered by status, column, assignees, or tags", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, status: { type: "string", enum: ["draft", "published", "archived"] }, column_id: { type: "string" }, assignee_ids: { type: "array", items: { type: "string" } }, tag_ids: { type: "array", items: { type: "string" } }, search: { type: "string" } }, required: ["account_slug"] } },
      { name: "fizzy_get_board_cards", description: "Get all cards on a specific board", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, board_id: { type: "string" }, status: { type: "string" }, column_id: { type: "string" } }, required: ["account_slug", "board_id"] } },
      { name: "fizzy_get_card", description: "Get details of a specific card including its description, assignees, and tags", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_id: { type: "string" } }, required: ["account_slug", "card_id"] } },
      { name: "fizzy_create_card", description: "Create a new card on a board", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, board_id: { type: "string" }, title: { type: "string" }, description: { type: "string" }, status: { type: "string" }, column_id: { type: "string" }, assignee_ids: { type: "array", items: { type: "string" } }, tag_ids: { type: "array", items: { type: "string" } }, due_on: { type: "string" } }, required: ["account_slug", "board_id", "title"] } },
      { name: "fizzy_update_card", description: "Update an existing card's title, description, status, column, assignees, tags, or due date", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_id: { type: "string" }, title: { type: "string" }, description: { type: "string" }, status: { type: "string" }, column_id: { type: "string" }, assignee_ids: { type: "array", items: { type: "string" } }, tag_ids: { type: "array", items: { type: "string" } }, due_on: { type: "string" } }, required: ["account_slug", "card_id"] } },
      { name: "fizzy_delete_card", description: "Delete a card", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_id: { type: "string" } }, required: ["account_slug", "card_id"] } },
      
      // Comment Tools
      { name: "fizzy_get_card_comments", description: "Get all comments on a card", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_id: { type: "string" } }, required: ["account_slug", "card_id"] } },
      { name: "fizzy_create_comment", description: "Add a comment to a card", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_id: { type: "string" }, body: { type: "string" } }, required: ["account_slug", "card_id", "body"] } },
      { name: "fizzy_delete_comment", description: "Delete a comment", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, comment_id: { type: "string" } }, required: ["account_slug", "comment_id"] } },
      
      // Column Tools  
      { name: "fizzy_get_columns", description: "Get all columns on a board (workflow stages)", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, board_id: { type: "string" } }, required: ["account_slug", "board_id"] } },
      { name: "fizzy_get_column", description: "Get details of a specific column", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, board_id: { type: "string" }, column_id: { type: "string" } }, required: ["account_slug", "board_id", "column_id"] } },
      { name: "fizzy_create_column", description: "Create a new column on a board", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, board_id: { type: "string" }, name: { type: "string" }, color: { type: "string", enum: ["blue", "gray", "tan", "yellow", "lime", "aqua", "violet", "purple", "pink"] } }, required: ["account_slug", "board_id", "name"] } },
      { name: "fizzy_update_column", description: "Update a column's name or color", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, board_id: { type: "string" }, column_id: { type: "string" }, name: { type: "string" }, color: { type: "string" } }, required: ["account_slug", "board_id", "column_id"] } },
      { name: "fizzy_delete_column", description: "Delete a column from a board", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, board_id: { type: "string" }, column_id: { type: "string" } }, required: ["account_slug", "board_id", "column_id"] } },
      
      // Tag Tools
      { name: "fizzy_get_tags", description: "Get all tags in an account", inputSchema: { type: "object", properties: { account_slug: { type: "string" } }, required: ["account_slug"] } },
      
      // User Tools
      { name: "fizzy_get_users", description: "Get all active users in an account", inputSchema: { type: "object", properties: { account_slug: { type: "string" } }, required: ["account_slug"] } },
      { name: "fizzy_get_user", description: "Get details of a specific user", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, user_id: { type: "string" } }, required: ["account_slug", "user_id"] } },
      { name: "fizzy_update_user", description: "Update a user's display name", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, user_id: { type: "string" }, name: { type: "string" } }, required: ["account_slug", "user_id", "name"] } },
      { name: "fizzy_deactivate_user", description: "Deactivate a user from an account", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, user_id: { type: "string" } }, required: ["account_slug", "user_id"] } },
      
      // Notification Tools
      { name: "fizzy_get_notifications", description: "Get all notifications for the current user in an account", inputSchema: { type: "object", properties: { account_slug: { type: "string" } }, required: ["account_slug"] } },
      { name: "fizzy_mark_notification_read", description: "Mark a notification as read", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, notification_id: { type: "string" } }, required: ["account_slug", "notification_id"] } },
      { name: "fizzy_mark_notification_unread", description: "Mark a notification as unread", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, notification_id: { type: "string" } }, required: ["account_slug", "notification_id"] } },
      { name: "fizzy_mark_all_notifications_read", description: "Mark all notifications as read in an account", inputSchema: { type: "object", properties: { account_slug: { type: "string" } }, required: ["account_slug"] } },
      
      // Card Action Tools
      { name: "fizzy_close_card", description: "Close a card (mark as done)", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" } }, required: ["account_slug", "card_number"] } },
      { name: "fizzy_reopen_card", description: "Reopen a closed card", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" } }, required: ["account_slug", "card_number"] } },
      { name: "fizzy_move_card_to_not_now", description: "Move a card to 'Not Now' triage", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" } }, required: ["account_slug", "card_number"] } },
      { name: "fizzy_move_card_to_column", description: "Move a card from triage to a specific column", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" }, column_id: { type: "string" } }, required: ["account_slug", "card_number", "column_id"] } },
      { name: "fizzy_send_card_to_triage", description: "Send a card back to triage (remove from column)", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" } }, required: ["account_slug", "card_number"] } },
      { name: "fizzy_toggle_card_tag", description: "Toggle a tag on/off for a card. If the tag doesn't exist, it will be created.", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" }, tag_title: { type: "string" } }, required: ["account_slug", "card_number", "tag_title"] } },
      { name: "fizzy_toggle_card_assignment", description: "Toggle a user assignment on/off for a card", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" }, assignee_id: { type: "string" } }, required: ["account_slug", "card_number", "assignee_id"] } },
      { name: "fizzy_watch_card", description: "Subscribe to notifications for a card", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" } }, required: ["account_slug", "card_number"] } },
      { name: "fizzy_unwatch_card", description: "Unsubscribe from notifications for a card", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" } }, required: ["account_slug", "card_number"] } },
      
      // Additional Comment Tools
      { name: "fizzy_get_comment", description: "Get a specific comment on a card", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" }, comment_id: { type: "string" } }, required: ["account_slug", "card_number", "comment_id"] } },
      { name: "fizzy_update_comment", description: "Update a comment on a card", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" }, comment_id: { type: "string" }, body: { type: "string" } }, required: ["account_slug", "card_number", "comment_id", "body"] } },
      
      // Reaction Tools
      { name: "fizzy_get_reactions", description: "Get all reactions on a comment", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" }, comment_id: { type: "string" } }, required: ["account_slug", "card_number", "comment_id"] } },
      { name: "fizzy_add_reaction", description: "Add a reaction to a comment (max 16 characters)", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" }, comment_id: { type: "string" }, content: { type: "string", maxLength: 16 } }, required: ["account_slug", "card_number", "comment_id", "content"] } },
      { name: "fizzy_remove_reaction", description: "Remove an emoji reaction from a comment", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" }, comment_id: { type: "string" }, reaction_id: { type: "string" } }, required: ["account_slug", "card_number", "comment_id", "reaction_id"] } },
      
      // Step Tools
      { name: "fizzy_get_step", description: "Get a specific to-do step on a card", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" }, step_id: { type: "string" } }, required: ["account_slug", "card_number", "step_id"] } },
      { name: "fizzy_create_step", description: "Create a new to-do step on a card", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" }, description: { type: "string" } }, required: ["account_slug", "card_number", "description"] } },
      { name: "fizzy_update_step", description: "Update a to-do step on a card (e.g., mark complete)", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" }, step_id: { type: "string" }, description: { type: "string" }, completed: { type: "boolean" } }, required: ["account_slug", "card_number", "step_id"] } },
      { name: "fizzy_delete_step", description: "Delete a to-do step from a card", inputSchema: { type: "object", properties: { account_slug: { type: "string" }, card_number: { type: "string" }, step_id: { type: "string" } }, required: ["account_slug", "card_number", "step_id"] } },
    ];
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

    try {
      const result = await this.executeToolCall(toolName, toolArgs);
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
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Tool execution failed",
        },
      };
    }
  }

  /**
   * Execute a tool call
   */
  private async executeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.client) throw new Error("Client not initialized");

    switch (toolName) {
      // Identity
      case "fizzy_get_identity":
        return this.client.getIdentity();
      case "fizzy_get_accounts":
        return this.client.getAccounts();

      // Boards
      case "fizzy_get_boards":
        return this.client.getBoards(args.account_slug as string);
      case "fizzy_get_board":
        return this.client.getBoard(args.account_slug as string, args.board_id as string);
      case "fizzy_create_board":
        return this.client.createBoard(args.account_slug as string, { name: args.name as string });
      case "fizzy_update_board":
        await this.client.updateBoard(args.account_slug as string, args.board_id as string, { name: args.name as string });
        return `Board ${args.board_id} updated successfully`;
      case "fizzy_delete_board":
        await this.client.deleteBoard(args.account_slug as string, args.board_id as string);
        return `Board ${args.board_id} deleted successfully`;

      // Cards
      case "fizzy_get_cards":
        return this.client.getCards(args.account_slug as string, {
          status: args.status as "draft" | "published" | "archived" | undefined,
          column_id: args.column_id as string,
          assignee_ids: args.assignee_ids as string[],
          tag_ids: args.tag_ids as string[],
          search: args.search as string,
        });
      case "fizzy_get_card":
        return this.client.getCard(args.account_slug as string, args.card_id as string);
      case "fizzy_create_card":
        return this.client.createCard(args.account_slug as string, args.board_id as string, {
          title: args.title as string,
          description: args.description as string,
          status: args.status as "draft" | "published" | undefined,
          column_id: args.column_id as string,
          assignee_ids: args.assignee_ids as string[],
          tag_ids: args.tag_ids as string[],
          due_on: args.due_on as string,
        });
      case "fizzy_update_card":
        await this.client.updateCard(args.account_slug as string, args.card_id as string, {
          title: args.title as string,
          description: args.description as string,
          status: args.status as "draft" | "published" | "archived" | undefined,
          column_id: args.column_id as string,
          assignee_ids: args.assignee_ids as string[],
          tag_ids: args.tag_ids as string[],
          due_on: args.due_on as string,
        });
        return `Card ${args.card_id} updated successfully`;
      case "fizzy_delete_card":
        await this.client.deleteCard(args.account_slug as string, args.card_id as string);
        return `Card ${args.card_id} deleted successfully`;

      // Comments
      case "fizzy_get_card_comments":
        return this.client.getCardComments(args.account_slug as string, args.card_id as string);
      case "fizzy_create_comment":
        return this.client.createCardComment(args.account_slug as string, args.card_id as string, { body: args.body as string });
      case "fizzy_get_comment":
        return this.client.getComment(args.account_slug as string, args.card_number as string, args.comment_id as string);
      case "fizzy_update_comment":
        await this.client.updateComment(args.account_slug as string, args.card_number as string, args.comment_id as string, { body: args.body as string });
        return `Comment ${args.comment_id} updated`;
      case "fizzy_delete_comment":
        await this.client.deleteComment(args.account_slug as string, args.card_number as string, args.comment_id as string);
        return `Comment ${args.comment_id} deleted successfully`;

      // Columns
      case "fizzy_get_columns":
        return this.client.getColumns(args.account_slug as string, args.board_id as string);
      case "fizzy_get_column":
        return this.client.getColumn(args.account_slug as string, args.board_id as string, args.column_id as string);
      case "fizzy_create_column":
        return this.client.createColumn(args.account_slug as string, args.board_id as string, {
          name: args.name as string,
          color: args.color as string,
        });
      case "fizzy_update_column":
        await this.client.updateColumn(args.account_slug as string, args.board_id as string, args.column_id as string, {
          name: args.name as string,
          color: args.color as string,
        });
        return `Column ${args.column_id} updated successfully`;
      case "fizzy_delete_column":
        await this.client.deleteColumn(args.account_slug as string, args.board_id as string, args.column_id as string);
        return `Column ${args.column_id} deleted successfully`;

      // Tags
      case "fizzy_get_tags":
        return this.client.getTags(args.account_slug as string);

      // Users
      case "fizzy_get_users":
        return this.client.getUsers(args.account_slug as string);
      case "fizzy_get_user":
        return this.client.getUser(args.account_slug as string, args.user_id as string);
      case "fizzy_update_user":
        await this.client.updateUser(args.account_slug as string, args.user_id as string, { name: args.name as string });
        return `User ${args.user_id} updated successfully`;
      case "fizzy_deactivate_user":
        await this.client.deactivateUser(args.account_slug as string, args.user_id as string);
        return `User ${args.user_id} deactivated successfully`;

      // Notifications
      case "fizzy_get_notifications":
        return this.client.getNotifications(args.account_slug as string);
      case "fizzy_mark_notification_read":
        await this.client.markNotificationAsRead(args.account_slug as string, args.notification_id as string);
        return `Notification ${args.notification_id} marked as read`;
      case "fizzy_mark_notification_unread":
        await this.client.markNotificationAsUnread(args.account_slug as string, args.notification_id as string);
        return `Notification ${args.notification_id} marked as unread`;
      case "fizzy_mark_all_notifications_read":
        await this.client.markAllNotificationsAsRead(args.account_slug as string);
        return "All notifications marked as read";

      // Card Actions
      case "fizzy_close_card":
        await this.client.closeCard(args.account_slug as string, args.card_number as string);
        return `Card ${args.card_number} closed`;
      case "fizzy_reopen_card":
        await this.client.reopenCard(args.account_slug as string, args.card_number as string);
        return `Card ${args.card_number} reopened`;
      case "fizzy_move_card_to_not_now":
        await this.client.moveCardToNotNow(args.account_slug as string, args.card_number as string);
        return `Card ${args.card_number} moved to Not Now`;
      case "fizzy_move_card_to_column":
        await this.client.moveCardToColumn(args.account_slug as string, args.card_number as string, args.column_id as string);
        return `Card ${args.card_number} moved to column ${args.column_id}`;
      case "fizzy_send_card_to_triage":
        await this.client.sendCardToTriage(args.account_slug as string, args.card_number as string);
        return `Card ${args.card_number} sent to triage`;
      case "fizzy_toggle_card_tag":
        await this.client.toggleCardTag(args.account_slug as string, args.card_number as string, args.tag_title as string);
        return `Tag "${args.tag_title}" toggled on card ${args.card_number}`;
      case "fizzy_toggle_card_assignment":
        await this.client.toggleCardAssignment(args.account_slug as string, args.card_number as string, args.assignee_id as string);
        return `User ${args.assignee_id} assignment toggled on card ${args.card_number}`;
      case "fizzy_watch_card":
        await this.client.watchCard(args.account_slug as string, args.card_number as string);
        return `Now watching card ${args.card_number}`;
      case "fizzy_unwatch_card":
        await this.client.unwatchCard(args.account_slug as string, args.card_number as string);
        return `Stopped watching card ${args.card_number}`;

      // Reactions
      case "fizzy_get_reactions":
        return this.client.getReactions(args.account_slug as string, args.card_number as string, args.comment_id as string);
      case "fizzy_add_reaction":
        return this.client.addReaction(args.account_slug as string, args.card_number as string, args.comment_id as string, args.content as string);
      case "fizzy_remove_reaction":
        await this.client.removeReaction(args.account_slug as string, args.card_number as string, args.comment_id as string, args.reaction_id as string);
        return `Reaction ${args.reaction_id} removed`;

      // Steps
      case "fizzy_get_step":
        return this.client.getStep(args.account_slug as string, args.card_number as string, args.step_id as string);
      case "fizzy_create_step":
        return this.client.createStep(args.account_slug as string, args.card_number as string, { description: args.description as string });
      case "fizzy_update_step":
        await this.client.updateStep(args.account_slug as string, args.card_number as string, args.step_id as string, {
          description: args.description as string,
          completed: args.completed as boolean,
        });
        return `Step ${args.step_id} updated`;
      case "fizzy_delete_step":
        await this.client.deleteStep(args.account_slug as string, args.card_number as string, args.step_id as string);
        return `Step ${args.step_id} deleted`;

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
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
   */
  private jsonError(status: number, code: number, message: string): Response {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
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
      console.log(`Session expired after ${Math.round(timeSinceActivity / 1000)}s of inactivity`);
      await this.ctx.storage.deleteAll();
      return;
    }

    await this.ctx.storage.setAlarm(now + ALARM_INTERVAL_MS);
  }
}
