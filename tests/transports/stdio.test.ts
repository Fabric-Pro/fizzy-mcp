import { describe, it, expect, vi, beforeEach } from "vitest";
import { FizzyClient } from "../../src/client/fizzy-client.js";

// Mock the SDK transports
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock the server - use inline function to avoid hoisting issues
vi.mock("../../src/server.js", () => ({
  createFizzyServer: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    tools: {},
  }),
}));

// Mock fetch for FizzyClient
global.fetch = vi.fn();

// Import after mocks are set up
import { startStdioTransport } from "../../src/transports/stdio.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFizzyServer } from "../../src/server.js";

describe("Stdio Transport", () => {
  let client: FizzyClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new FizzyClient({
      accessToken: "test-token",
      maxRetries: 0,
    });
  });

  describe("startStdioTransport", () => {
    it("should create a FizzyServer with the provided client", async () => {
      const connection = await startStdioTransport({ client });

      expect(createFizzyServer).toHaveBeenCalledWith(client);
      expect(connection.server).toBeDefined();
    });

    it("should create a StdioServerTransport", async () => {
      const connection = await startStdioTransport({ client });

      expect(StdioServerTransport).toHaveBeenCalled();
      expect(connection.transport).toBeDefined();
    });

    it("should connect server to transport", async () => {
      const connection = await startStdioTransport({ client });

      // Get the server mock that was returned
      const serverMock = (createFizzyServer as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(serverMock.connect).toHaveBeenCalled();
    });

    it("should return a connection object with close method", async () => {
      const connection = await startStdioTransport({ client });

      expect(connection.close).toBeDefined();
      expect(typeof connection.close).toBe("function");
    });

    it("should close transport when close is called", async () => {
      const connection = await startStdioTransport({ client });

      await connection.close();

      expect(connection.transport.close).toHaveBeenCalled();
    });
  });

  describe("Configuration", () => {
    it("should use the client provided in options", async () => {
      const customClient = new FizzyClient({
        accessToken: "custom-token",
        baseUrl: "https://custom.fizzy.do",
        maxRetries: 0,
      });

      await startStdioTransport({ client: customClient });

      expect(createFizzyServer).toHaveBeenCalledWith(customClient);
    });
  });
});
