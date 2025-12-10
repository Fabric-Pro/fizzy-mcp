/**
 * Stdio Transport Handler
 * Uses standard input/output for MCP communication
 * Primarily used for IDE integrations (Cursor, VS Code, Claude Desktop)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FizzyClient } from "../client/fizzy-client.js";
import { createFizzyServer } from "../server.js";
import { logger } from "../utils/logger.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface StdioTransportOptions {
  client: FizzyClient;
}

export interface StdioTransportConnection {
  server: McpServer;
  transport: StdioServerTransport;
  close: () => Promise<void>;
}

/**
 * Create and start stdio transport
 */
export async function startStdioTransport(
  options: StdioTransportOptions
): Promise<StdioTransportConnection> {
  const log = logger.child("stdio");
  const { client } = options;

  const server = createFizzyServer(client);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  
  log.info("Stdio transport connected");

  return {
    server,
    transport,
    close: async () => {
      log.info("Closing stdio transport");
      await transport.close();
    },
  };
}

