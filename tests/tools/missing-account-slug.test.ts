/**
 * A tool call without `account_slug` gets a clear validation error.
 *
 * The Cloudflare transport dispatches raw arguments and never runs Zod, so a
 * call that omitted `account_slug` reached `normalizeAccountSlug` with
 * `undefined` and died on `.startsWith`: "Cannot read properties of undefined
 * (reading 'startsWith')", naming neither the tool nor the argument. These drive
 * `toolHandlers` directly — the handlers `cloudflare/mcp-session.ts` reaches
 * through `executeToolHandler` — rather than going through the validating stdio
 * path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FizzyClient } from "../../src/client/fizzy-client.js";
import { toolHandlers } from "../../src/tools/handlers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("tools called without account_slug", () => {
  let client: FizzyClient;

  beforeEach(() => {
    client = new FizzyClient({
      accessToken: "test-token",
      baseUrl: "https://app.fizzy.do",
      maxRetries: 0,
    });
    mockFetch.mockReset();
  });

  it.each([
    ["fizzy_get_boards", {}],
    ["fizzy_get_cards", {}],
    ["fizzy_get_card", { card_number: "42" }],
    ["fizzy_close_card", { card_number: "42" }],
  ] as const)(
    "%s says account_slug is required instead of throwing a TypeError",
    async (toolName, args) => {
      await expect(toolHandlers[toolName](client, { ...args })).rejects.toThrow(
        "account_slug is required and must be an account slug"
      );

      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
});
