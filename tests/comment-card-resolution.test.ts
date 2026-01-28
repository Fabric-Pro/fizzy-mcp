import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFizzyServer } from "../src/server.js";
import { resolveCardNumber, type CardLookup } from "../src/utils/card-resolver.js";

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => {
  class MockMcpServer {
    tools: Record<string, { meta: unknown; handler: (...args: any[]) => any }> = {};
    constructor(_opts: unknown) {}
    registerTool(name: string, meta: unknown, handler: (...args: any[]) => any) {
      this.tools[name] = { meta, handler };
    }
  }

  return { McpServer: MockMcpServer };
});

describe("resolveCardNumber utility", () => {
  it("returns card_number directly if provided", async () => {
    const mockLookup: CardLookup = { getCard: vi.fn() };
    const result = await resolveCardNumber(mockLookup, "/123", undefined, "15");

    expect(result).toBe("15");
    expect(mockLookup.getCard).not.toHaveBeenCalled();
  });

  it("resolves card_id to number field", async () => {
    const mockLookup: CardLookup = {
      getCard: vi.fn().mockResolvedValue({
        number: 11,
        url: "https://app.fizzy.do/123/cards/11",
      }),
    };

    const result = await resolveCardNumber(mockLookup, "/123", "card-abc", undefined);

    expect(result).toBe("11");
    expect(mockLookup.getCard).toHaveBeenCalledWith("/123", "card-abc");
  });

  it("falls back to URL parsing when number is missing", async () => {
    const mockLookup: CardLookup = {
      getCard: vi.fn().mockResolvedValue({
        url: "https://app.fizzy.do/123/cards/20",
      }),
    };

    const result = await resolveCardNumber(mockLookup, "/123", "card-xyz", undefined);

    expect(result).toBe("20");
  });

  it("throws when neither card_id nor card_number provided", async () => {
    const mockLookup: CardLookup = { getCard: vi.fn() };

    await expect(
      resolveCardNumber(mockLookup, "/123", undefined, undefined)
    ).rejects.toThrow("card_id or card_number is required");
  });

  it("throws when card has no number and URL parsing fails", async () => {
    const mockLookup: CardLookup = {
      getCard: vi.fn().mockResolvedValue({
        url: "https://app.fizzy.do/123/some-other-path",
      }),
    };

    await expect(
      resolveCardNumber(mockLookup, "/123", "card-bad", undefined)
    ).rejects.toThrow("Unable to resolve card number for card_id card-bad");
  });
});

describe("Comment tool card resolution (integration)", () => {
  let client: {
    getCard: ReturnType<typeof vi.fn>;
    getCardComments: ReturnType<typeof vi.fn>;
    createCardComment: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    client = {
      getCard: vi.fn(),
      getCardComments: vi.fn(),
      createCardComment: vi.fn(),
    };
  });

  it("resolves card_id to number for fizzy_create_comment", async () => {
    client.getCard.mockResolvedValue({
      id: "card-123",
      number: 11,
      url: "https://app.fizzy.do/123/cards/11",
    });
    client.createCardComment.mockResolvedValue({ id: "comment-1" });

    const server = createFizzyServer(client as any) as any;
    const handler = server.tools["fizzy_create_comment"].handler;

    await handler({ account_slug: "/123", card_id: "card-123", body: "Test" });

    expect(client.getCard).toHaveBeenCalledWith("/123", "card-123");
    expect(client.createCardComment).toHaveBeenCalledWith("/123", "11", { body: "Test" });
  });

  it("uses card_number directly for fizzy_create_comment", async () => {
    client.createCardComment.mockResolvedValue({ id: "comment-2" });

    const server = createFizzyServer(client as any) as any;
    const handler = server.tools["fizzy_create_comment"].handler;

    await handler({ account_slug: "/123", card_number: "15", body: "Test" });

    expect(client.getCard).not.toHaveBeenCalled();
    expect(client.createCardComment).toHaveBeenCalledWith("/123", "15", { body: "Test" });
  });

  it("falls back to card URL when number is missing", async () => {
    client.getCard.mockResolvedValue({
      id: "card-456",
      url: "https://app.fizzy.do/123/cards/20",
    });
    client.createCardComment.mockResolvedValue({ id: "comment-3" });

    const server = createFizzyServer(client as any) as any;
    const handler = server.tools["fizzy_create_comment"].handler;

    await handler({ account_slug: "/123", card_id: "card-456", body: "Test" });

    expect(client.createCardComment).toHaveBeenCalledWith("/123", "20", { body: "Test" });
  });

  it("resolves card_id to number for fizzy_get_card_comments", async () => {
    client.getCard.mockResolvedValue({
      id: "card-789",
      number: 42,
      url: "https://app.fizzy.do/123/cards/42",
    });
    client.getCardComments.mockResolvedValue([{ id: "comment-1", body: "Hello" }]);

    const server = createFizzyServer(client as any) as any;
    const handler = server.tools["fizzy_get_card_comments"].handler;

    await handler({ account_slug: "/123", card_id: "card-789" });

    expect(client.getCard).toHaveBeenCalledWith("/123", "card-789");
    expect(client.getCardComments).toHaveBeenCalledWith("/123", "42");
  });
});
