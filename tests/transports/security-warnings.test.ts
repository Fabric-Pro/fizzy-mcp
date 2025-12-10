import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startHTTPTransport } from "../../src/transports/http.js";
import { startSSETransport } from "../../src/transports/sse.js";
import { FizzyClient } from "../../src/client/fizzy-client.js";

// Mock the SDK transports
vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/server/sse.js", () => ({
  SSEServerTransport: vi.fn(),
}));

// Mock the server
vi.mock("../../src/server.js", () => ({
  createFizzyServer: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock fetch for FizzyClient
global.fetch = vi.fn();

describe("Security Warnings", () => {
  let client: FizzyClient;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new FizzyClient({
      accessToken: "test-token",
      maxRetries: 0,
    });
    // Spy on console.error since that's what the logger uses
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleErrorSpy.mockRestore();
  });

  // Helper to check if a warning message was logged
  function wasWarningLogged(substring: string): boolean {
    return consoleErrorSpy.mock.calls.some(
      (call) => typeof call[0] === "string" && call[0].includes(substring)
    );
  }

  describe("HTTP Transport", () => {
    it("should warn when binding to all interfaces with wildcard origins", async () => {
      const server = await startHTTPTransport({
        port: 3001,
        client,
        security: {
          localhostOnly: false, // Bind to 0.0.0.0
          allowedOrigins: ["*"], // Wildcard
        },
      });

      expect(wasWarningLogged("SECURITY WARNING: Server is accessible from network")).toBe(true);
      expect(wasWarningLogged("NOT recommended for production")).toBe(true);
      expect(wasWarningLogged("MCP_ALLOWED_ORIGINS")).toBe(true);
      expect(wasWarningLogged("MCP_AUTH_TOKEN")).toBe(true);

      await server.close();
    });

    it("should warn when binding to all interfaces with default origins", async () => {
      const server = await startHTTPTransport({
        port: 3002,
        client,
        security: {
          localhostOnly: false, // Bind to 0.0.0.0
          // No allowedOrigins specified (defaults to wildcard)
        },
      });

      expect(wasWarningLogged("SECURITY WARNING")).toBe(true);

      await server.close();
    });

    it("should NOT warn when binding to localhost with wildcard origins", async () => {
      const server = await startHTTPTransport({
        port: 3003,
        client,
        security: {
          localhostOnly: true, // Bind to 127.0.0.1
          allowedOrigins: ["*"],
        },
      });

      expect(wasWarningLogged("SECURITY WARNING")).toBe(false);

      await server.close();
    });

    it("should NOT warn when binding to all interfaces with restricted origins", async () => {
      const server = await startHTTPTransport({
        port: 3004,
        client,
        security: {
          localhostOnly: false, // Bind to 0.0.0.0
          allowedOrigins: ["https://myapp.com"], // Restricted
        },
      });

      expect(wasWarningLogged("SECURITY WARNING")).toBe(false);

      await server.close();
    });

    it("should NOT suggest MCP_AUTH_TOKEN if already configured", async () => {
      const server = await startHTTPTransport({
        port: 3005,
        client,
        security: {
          localhostOnly: false,
          allowedOrigins: ["*"],
          authToken: "my-token", // Auth token configured
        },
      });

      expect(wasWarningLogged("SECURITY WARNING")).toBe(true);
      expect(wasWarningLogged("MCP_AUTH_TOKEN")).toBe(false);

      await server.close();
    });
  });

  describe("SSE Transport", () => {
    it("should warn when binding to all interfaces with wildcard origins", async () => {
      const server = await startSSETransport({
        port: 3006,
        client,
        security: {
          localhostOnly: false,
          allowedOrigins: ["*"],
        },
      });

      expect(wasWarningLogged("SECURITY WARNING: Server is accessible from network")).toBe(true);

      await server.close();
    });

    it("should NOT warn when binding to localhost", async () => {
      const server = await startSSETransport({
        port: 3007,
        client,
        security: {
          localhostOnly: true,
          allowedOrigins: ["*"],
        },
      });

      expect(wasWarningLogged("SECURITY WARNING")).toBe(false);

      await server.close();
    });
  });
});

