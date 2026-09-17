/**
 * The card-CRUD tools accept `card_id` or `card_number` under either name.
 *
 * `fizzy_get_card`, `fizzy_update_card` and `fizzy_delete_card` took only
 * `card_id` while 24 sibling card tools take `card_number`, so a model working
 * through a card sent `card_number` here too. The argument then read back
 * `undefined`, reached `assertPathSegment` and threw "Cannot read properties of
 * undefined (reading 'length')" — a bare TypeError naming neither the tool nor
 * the argument (issue #96).
 *
 * That only ever surfaced in production because the Cloudflare transport
 * dispatches raw arguments and never runs Zod, so these drive `toolHandlers`
 * directly — the same entry point `cloudflare/mcp-session.ts` uses — rather than
 * going through the validating stdio path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FizzyClient } from "../../src/client/fizzy-client.js";
import { toolHandlers } from "../../src/tools/handlers.js";
import { selectCardIdentifier } from "../../src/utils/card-resolver.js";
import { buildMcpToolDefinitions } from "../../src/tools/json-schema.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const ACCOUNT = "123456";
const CARD_NUMBER = "2547";

const mockHeaders = () => ({ get: () => null });

const mockResponse = <T>(data: T, status = 200) => ({
  ok: true,
  status,
  headers: mockHeaders(),
  json: async () => data,
  text: async () => JSON.stringify(data),
});

const mockNoContent = () => ({
  ok: true,
  status: 204,
  headers: mockHeaders(),
  text: async () => "",
});

/** The path every mocked request was sent to, in call order. */
const requestedPaths = (): string[] =>
  mockFetch.mock.calls.map((call) => new URL(call[0] as string).pathname);

describe("selectCardIdentifier", () => {
  it("passes card_id through untouched", () => {
    expect(selectCardIdentifier("2547", undefined)).toBe("2547");
  });

  it("accepts card_number under its own name", () => {
    expect(selectCardIdentifier(undefined, "2547")).toBe("2547");
  });

  it("prefers card_id when both are given, so existing callers keep their request", () => {
    expect(selectCardIdentifier("2547", "9999")).toBe("2547");
  });

  it("names both arguments when neither is supplied", () => {
    expect(() => selectCardIdentifier(undefined, undefined)).toThrow(
      "card_id or card_number is required"
    );
  });
});

describe("card-CRUD tools accept either identifier", () => {
  let client: FizzyClient;

  beforeEach(() => {
    client = new FizzyClient({
      accessToken: "test-token",
      baseUrl: "https://app.fizzy.do",
      maxRetries: 0,
    });
    mockFetch.mockReset();
  });

  it("fizzy_get_card reads the card when only card_number is given", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ id: "0000000000000000000000abc", number: 2547, title: "A card" })
    );

    const result = await toolHandlers.fizzy_get_card(client, {
      account_slug: ACCOUNT,
      card_number: CARD_NUMBER,
    });

    expect(requestedPaths()).toEqual([`/${ACCOUNT}/cards/${CARD_NUMBER}`]);
    expect(result).toMatchObject({ number: 2547 });
  });

  it("fizzy_update_card writes the card when only card_number is given", async () => {
    mockFetch.mockResolvedValueOnce(mockNoContent());

    const result = await toolHandlers.fizzy_update_card(client, {
      account_slug: ACCOUNT,
      card_number: CARD_NUMBER,
      description: "Updated by the alias test",
    });

    expect(requestedPaths()).toEqual([`/${ACCOUNT}/cards/${CARD_NUMBER}`]);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: "PUT" });
    expect(result).toBe(`Card ${CARD_NUMBER} updated successfully`);
  });

  it("fizzy_delete_card deletes the card when only card_number is given", async () => {
    mockFetch.mockResolvedValueOnce(mockNoContent());

    const result = await toolHandlers.fizzy_delete_card(client, {
      account_slug: ACCOUNT,
      card_number: CARD_NUMBER,
    });

    expect(requestedPaths()).toEqual([`/${ACCOUNT}/cards/${CARD_NUMBER}`]);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
    expect(result).toBe(`Card ${CARD_NUMBER} deleted successfully`);
  });

  it("card_id still builds exactly the request it always did", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ id: "0000000000000000000000abc", number: 2547 })
    );

    await toolHandlers.fizzy_get_card(client, {
      account_slug: ACCOUNT,
      card_id: CARD_NUMBER,
    });

    expect(requestedPaths()).toEqual([`/${ACCOUNT}/cards/${CARD_NUMBER}`]);
  });

  it.each([
    ["fizzy_get_card", {}],
    ["fizzy_update_card", { description: "x" }],
    ["fizzy_delete_card", {}],
  ] as const)(
    "%s asks for an identifier instead of throwing a TypeError when neither is given",
    async (toolName, extraArgs) => {
      await expect(
        toolHandlers[toolName](client, { account_slug: ACCOUNT, ...extraArgs })
      ).rejects.toThrow("card_id or card_number is required");

      // The regression itself: the old code reached the client and died inside
      // assertPathSegment, so no request must be attempted at all.
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
});

/**
 * The alias only reaches a model if it is actually advertised. A tool whose
 * handler accepts `card_number` but whose published schema omits it is the same
 * bug wearing a different hat: the model still has no way to know the argument
 * exists, and stdio's own validation would reject it on the way in.
 */
describe("card-CRUD tools publish both identifiers", () => {
  const CARD_CRUD_TOOLS = [
    "fizzy_get_card",
    "fizzy_update_card",
    "fizzy_delete_card",
  ] as const;

  const published = () => {
    const byName = new Map(buildMcpToolDefinitions().map((tool) => [tool.name, tool]));
    return CARD_CRUD_TOOLS.map((name) => {
      const tool = byName.get(name);
      if (!tool) throw new Error(`${name} is not published at all`);
      return { name, schema: tool.inputSchema };
    });
  };

  it.each(CARD_CRUD_TOOLS)("%s advertises card_id and card_number", (name) => {
    const { schema } = published().find((tool) => tool.name === name)!;
    const properties = Object.keys(schema.properties ?? {});

    expect(properties).toContain("card_id");
    expect(properties).toContain("card_number");
  });

  it.each(CARD_CRUD_TOOLS)(
    "%s requires neither identifier, so either name is accepted",
    (name) => {
      const { schema } = published().find((tool) => tool.name === name)!;

      // Marking either one required would put the other permanently out of
      // reach; the "one of the two" rule is the handler's job instead.
      expect(schema.required ?? []).toEqual(["account_slug"]);
    }
  );
});
