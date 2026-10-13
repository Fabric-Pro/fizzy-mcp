/**
 * Checks the tool-argument element cap over a real MCP connection.
 *
 * The cap is enforced inside McpServer's tools/call handler, so mocking the SDK
 * would skip it. This connects the actual server and client in memory.
 */

import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFizzyServer, MAX_TOOL_INPUT_ELEMENTS } from "../../src/server.js";
import type { FizzyClient } from "../../src/client/fizzy-client.js";
import type { CardsPage } from "../../src/client/types.js";

const EMPTY_PAGE: CardsPage = {
  cards: [],
  page: 1,
  total_count: 0,
  has_more: false,
  next_page: null,
};

/** A client whose getCards records the tag IDs it was given. */
function recordingClient() {
  const calls: Array<string[] | undefined> = [];
  const client = {
    getCards: vi.fn(async (_slug: string, options?: { tag_ids?: string[] }) => {
      calls.push(options?.tag_ids);
      return EMPTY_PAGE;
    }),
  } as unknown as FizzyClient;
  return { client, calls };
}

/** Calls fizzy_get_cards with `tagCount` tag IDs plus `account_slug`. */
async function getCardsWithTags(tagCount: number) {
  const { client: fizzy, calls } = recordingClient();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createFizzyServer(fizzy);
  await server.connect(serverTransport);
  const client = new Client({ name: "element-cap-test", version: "1.0.0" });
  await client.connect(clientTransport);

  const result = (await client.callTool({
    name: "fizzy_get_cards",
    arguments: {
      account_slug: "123456",
      tag_ids: Array.from({ length: tagCount }, (_, i) => `tag${i}`),
    },
  })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
  await client.close();

  return { result, calls };
}

// account_slug and tag_ids are two members; each tag ID is one element.
const TAGS_AT_LIMIT = MAX_TOOL_INPUT_ELEMENTS - 2;

describe("tool-argument element cap", () => {
  it("runs a call that sits exactly at the cap", async () => {
    const { result, calls } = await getCardsWithTags(TAGS_AT_LIMIT);

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text!)).toEqual(EMPTY_PAGE);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(TAGS_AT_LIMIT);
  });

  it("refuses a call one element over the cap before the handler runs", async () => {
    const { result, calls } = await getCardsWithTags(TAGS_AT_LIMIT + 1);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      `more than the maximum of ${MAX_TOOL_INPUT_ELEMENTS} elements`
    );
    expect(calls).toEqual([]);
  });
});
