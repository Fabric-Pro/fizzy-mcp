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
import { executeToolHandler } from "./tools/handlers.js";

/**
 * Format handler result as MCP tool response
 */
function formatMcpResponse(result: unknown): {
  content: Array<{ type: string; text: string }>;
} {
  const text = typeof result === "string"
    ? result
    : JSON.stringify(result, null, 2);
  return {
    content: [{ type: "text", text }],
  };
}

/**
 * Create the Fizzy MCP Server with all tools registered
 */
export function createFizzyServer(client: FizzyClient): McpServer {
  const server = new McpServer({
    name: "fizzy-mcp",
    version: "1.0.0",
  });

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
      async (args: Record<string, unknown>) => {
        const result = await executeToolHandler(client, toolDef.name, args);
        return formatMcpResponse(result);
      }
    );
  }

  return server;
}
