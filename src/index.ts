#!/usr/bin/env node

/**
 * Fizzy MCP Server - Entry Point
 * 
 * Supports multiple transport modes:
 * - stdio: For CLI tools and IDE integrations (Cursor, VS Code, Claude Desktop)
 * - sse: Server-Sent Events for web-based clients (deprecated, use http)
 * - http: Streamable HTTP for scalable deployments
 * 
 * Security:
 * - All transports bind to localhost (127.0.0.1) by default
 * - HTTP/SSE transports support CORS origin restrictions and client authentication
 * - Configure via environment variables: MCP_ALLOWED_ORIGINS, MCP_AUTH_TOKEN
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FizzyClient } from "./client/fizzy-client.js";
import { createFizzyServer } from "./server.js";
import { 
  startHTTPTransport as startSecureHTTPTransport,
  startSSETransport as startSecureSSETransport,
} from "./transports/index.js";

// Configuration from environment variables
const CONFIG = {
  accessToken: process.env.FIZZY_ACCESS_TOKEN || "",
  baseUrl: process.env.FIZZY_BASE_URL || "https://app.fizzy.do",
  port: parseInt(process.env.PORT || "3000", 10),
  transport: process.env.MCP_TRANSPORT || "stdio",
};

// Parse command line arguments
function parseArgs(): { transport: string; port: number } {
  const args = process.argv.slice(2);
  let transport = CONFIG.transport;
  let port = CONFIG.port;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--transport" || args[i] === "-t") {
      transport = args[i + 1] || transport;
      i++;
    } else if (args[i] === "--port" || args[i] === "-p") {
      port = parseInt(args[i + 1] || String(port), 10);
      i++;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
Fizzy MCP Server

Usage: fizzy-mcp [options]

Options:
  -t, --transport <type>  Transport type: stdio, sse, or http (default: stdio)
  -p, --port <number>     Port for HTTP/SSE transport (default: 3000)
  -h, --help              Show this help message

Environment Variables:
  FIZZY_ACCESS_TOKEN      Your Fizzy API access token (required for stdio only)
  FIZZY_BASE_URL          Fizzy API base URL (default: https://app.fizzy.do)
  PORT                    Server port for HTTP/SSE (default: 3000)
  MCP_TRANSPORT           Default transport type (default: stdio)

Security (HTTP/SSE transports):
  MCP_ALLOWED_ORIGINS     Allowed CORS origins (comma-separated, or "*" for all)
  MCP_AUTH_TOKEN          Bearer token for client authentication (optional)
  MCP_BIND_ALL_INTERFACES Set to "true" to bind to 0.0.0.0 (not recommended)

Multi-User Support (HTTP/SSE):
  HTTP and SSE transports support multiple users simultaneously.
  Each user provides their own Fizzy token via Authorization header:
    Authorization: Bearer <user-fizzy-token>

Examples:
  # Run with stdio transport (for Cursor, VS Code, Claude Desktop)
  FIZZY_ACCESS_TOKEN=your-token fizzy-mcp

  # Run with SSE transport (multi-user, tokens via Authorization header)
  fizzy-mcp --transport sse --port 3000

  # Run with Streamable HTTP transport (multi-user)
  fizzy-mcp --transport http --port 3000

  # Run with restricted CORS origins
  MCP_ALLOWED_ORIGINS="http://localhost:3000" fizzy-mcp --transport http

  # Run with client authentication (optional, restricts MCP client access)
  MCP_AUTH_TOKEN="my-secret" fizzy-mcp --transport http
`);
      process.exit(0);
    }
  }

  return { transport, port };
}

// Validate configuration for stdio transport only
// HTTP/SSE transports use per-user tokens via Authorization header
function validateConfig(transport: string): void {
  if (transport === "stdio" && !CONFIG.accessToken) {
    console.error("Error: FIZZY_ACCESS_TOKEN environment variable is required for stdio transport");
    console.error("Get your access token from your Fizzy profile > API > Personal access tokens");
    process.exit(1);
  }
}

// Create Fizzy client
function createClient(): FizzyClient {
  return new FizzyClient({
    accessToken: CONFIG.accessToken,
    baseUrl: CONFIG.baseUrl,
  });
}

// Start stdio transport - for IDE integrations like Cursor, VS Code, Claude Desktop
async function startStdioTransport(): Promise<void> {
  const client = createClient();
  const server = createFizzyServer(client);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  
  // Log to stderr so it doesn't interfere with stdio communication
  console.error("Fizzy MCP Server running on stdio");
}

// Start SSE transport - for web-based clients (uses secure transport)
async function startSSETransport(port: number): Promise<void> {
  const server = await startSecureSSETransport({
    port,
    // Security options are read from environment variables automatically
  });

  console.error("Fizzy MCP Server running on SSE");
  console.error(`  SSE endpoint: http://localhost:${port}/sse`);
  console.error(`  Message endpoint: http://localhost:${port}/messages`);
  console.error(`  Health check: http://localhost:${port}/health`);
  console.error(`  Multi-user: Each user provides their own Fizzy token via Authorization header`);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.error("Shutting down SSE server...");
    await server.close();
    process.exit(0);
  });
}

// Start Streamable HTTP transport - for scalable deployments (uses secure transport)
async function startHTTPTransport(port: number): Promise<void> {
  const server = await startSecureHTTPTransport({
    port,
    // Security options are read from environment variables automatically
  });

  console.error("Fizzy MCP Server running on Streamable HTTP");
  console.error(`  MCP endpoint: http://localhost:${port}/mcp`);
  console.error(`  Health check: http://localhost:${port}/health`);
  console.error(`  Multi-user: Each user provides their own Fizzy token via Authorization header`);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.error("Shutting down HTTP server...");
    await server.close();
    process.exit(0);
  });
}

// Main entry point
async function main(): Promise<void> {
  const { transport, port } = parseArgs();
  validateConfig(transport);

  switch (transport.toLowerCase()) {
    case "stdio":
      await startStdioTransport();
      break;
    case "sse":
      await startSSETransport(port);
      break;
    case "http":
    case "streamablehttp":
    case "streamable-http":
      await startHTTPTransport(port);
      break;
    default:
      console.error(`Unknown transport: ${transport}`);
      console.error("Supported transports: stdio, sse, http");
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
