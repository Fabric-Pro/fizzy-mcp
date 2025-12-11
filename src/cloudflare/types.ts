/**
 * Cloudflare Workers Environment Types
 * 
 * These types define the bindings and environment variables
 * available to the Fizzy MCP Worker.
 */

import type { DurableObjectNamespace, DurableObjectState, ExecutionContext } from "@cloudflare/workers-types";

/**
 * Environment bindings for the Fizzy MCP Worker
 * 
 * Authentication Model (Multi-User):
 * - FIZZY_ACCESS_TOKEN is NOT required on the server
 * - Each client provides their own Fizzy token via Authorization header
 * - This enables multi-tenant deployments where each user has their own Fizzy account
 */
export interface Env {
  // === Optional Environment Variables ===
  /**
   * Fizzy API base URL
   * Default: https://app.fizzy.do
   */
  FIZZY_BASE_URL?: string;

  /**
   * Logging level
   * Default: info
   */
  LOG_LEVEL?: "debug" | "info" | "warn" | "error";

  /**
   * Allowed CORS origins (comma-separated or "*" for all)
   * Default: "*"
   */
  MCP_ALLOWED_ORIGINS?: string;

  // === Durable Object Bindings ===
  /**
   * Durable Object namespace for MCP sessions
   */
  MCP_SESSIONS: DurableObjectNamespace;
}

/**
 * JSON-RPC 2.0 Message Types for MCP Protocol
 */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown> | unknown[];
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse;

/**
 * MCP Session state stored in Durable Object
 */
export interface McpSessionState {
  /** Session creation timestamp */
  createdAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Whether the session has been initialized */
  initialized: boolean;
  /** Server capabilities sent during initialization */
  serverCapabilities?: Record<string, unknown>;
  /** Client info received during initialization */
  clientInfo?: {
    name?: string;
    version?: string;
  };
}

/**
 * Security validation result
 */
export interface SecurityResult {
  allowed: boolean;
  statusCode?: number;
  error?: string;
  corsOrigin?: string;
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: "ok" | "error";
  transport: "streamable-http" | "sse";
  version: string;
  durableObjects: boolean;
}

/**
 * MCP Protocol Constants
 */
export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const SERVER_NAME = "fizzy-mcp";
export const SERVER_VERSION = "1.0.0";

/**
 * Re-export Cloudflare types for convenience
 */
export type { DurableObjectState, DurableObjectNamespace, ExecutionContext };

