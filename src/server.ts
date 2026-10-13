/**
 * Fizzy MCP Server
 * Implements the Model Context Protocol for Fizzy API
 *
 * Uses centralized tool definitions from tools/definitions.ts and
 * shared handlers from tools/handlers.ts for consistency across
 * all deployment paths (standard server and Cloudflare Workers).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FizzyClient } from "./client/fizzy-client.js";
import { ALL_TOOLS } from "./tools/definitions.js";
import {
  executeToolHandler,
  toMcpContent,
  type McpContentBlock,
} from "./tools/handlers.js";

/**
 * Format handler result as MCP tool response
 *
 * The rule itself lives in `toMcpContent`, shared with the Cloudflare
 * transport so both answer identically — including for the one handler that
 * returns an `image` block rather than serialized JSON.
 */
function formatMcpResponse(result: unknown): {
  content: McpContentBlock[];
} {
  return { content: toMcpContent(result) };
}

/**
 * Most array elements plus object members one `tools/call` may carry.
 *
 * The SDK counts them before zod validation and stops counting at this cap, so
 * an oversized payload is refused cheaply instead of being walked in full; the
 * request body cap alone would let one carry millions of elements.
 *
 * The cap is a judgement, not an upstream limit. The only arrays in the tool
 * schemas are unbounded ID lists (`assignee_ids`, `tag_ids`), and
 * fizzy_get_cards sends those in the query string, so 10,000 of them would
 * already make a URL of several hundred kilobytes. A long text or base64 field
 * is a single string and counts once.
 *
 * Covers stdio, HTTP and SSE. The Cloudflare worker does not use McpServer.
 */
export const MAX_TOOL_INPUT_ELEMENTS = 10_000;

/**
 * Create the Fizzy MCP Server with all tools registered
 */
export function createFizzyServer(client: FizzyClient): McpServer {
  const server = new McpServer(
    {
      name: "fizzy-mcp",
      version: "1.1.0",
    },
    { maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS }
  );

  // Register all tools using shared handlers
  for (const toolDef of ALL_TOOLS) {
    server.registerTool(
      toolDef.name,
      {
        title: toolDef.title,
        description: toolDef.description,
        inputSchema: toolDef.schema,
        annotations: toolDef.annotations,
      },
      (async (args: Record<string, unknown>) => {
        const result = await executeToolHandler(client, toolDef.name, args);
        return formatMcpResponse(result);
      }) as any
    );
  }

  return server;
}
