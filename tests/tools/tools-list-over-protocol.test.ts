/**
 * Asks a real McpServer for its tool list over a real MCP connection.
 *
 * Every other transport test in this repo mocks `@modelcontextprotocol/sdk`
 * and invokes the stored callback directly, which skips the very machinery that
 * produced this bug: `McpServer` reads a tool's fields off its schema's shape,
 * and a refined schema has none, so `tools/list` served
 * `{"type":"object","properties":{}}` while every mocked test stayed green.
 *
 * This file deliberately does not mock the SDK. It connects the actual server to
 * the actual client over an in-memory transport pair, so what it asserts is what
 * a client on the wire would receive.
 */

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFizzyServer } from "../../src/server.js";
import type { FizzyClient } from "../../src/client/fizzy-client.js";

/** No tool is invoked here; only the published tool list is read. */
const unusedClient = {} as FizzyClient;

async function listToolsOverProtocol() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const server = createFizzyServer(unusedClient);
  await server.connect(serverTransport);

  const client = new Client({ name: "published-schema-test", version: "1.0.0" });
  await client.connect(clientTransport);

  const { tools } = await client.listTools();
  await client.close();

  return new Map(
    tools.map((tool) => [
      tool.name,
      Object.keys(
        (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
      ),
    ])
  );
}

describe("tools/list over a real MCP connection", () => {
  it("serves the full parameter list for the two tools that regressed", async () => {
    const published = await listToolsOverProtocol();

    expect(published.get("fizzy_create_comment")).toEqual([
      "account_slug",
      "card_id",
      "card_number",
      "body",
    ]);
    expect(published.get("fizzy_get_card_comments")).toEqual([
      "account_slug",
      "card_id",
      "card_number",
      "fields",
    ]);
  });

  it("serves a non-empty parameter list for every tool that takes arguments", async () => {
    const published = await listToolsOverProtocol();

    const empty = [...published.entries()]
      .filter(([, properties]) => properties.length === 0)
      .map(([name]) => name)
      .sort();

    // Only these two genuinely take no arguments.
    expect(empty).toEqual(["fizzy_get_accounts", "fizzy_get_identity"]);
  });

  it("carries the field descriptions a model relies on", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createFizzyServer(unusedClient);
    await server.connect(serverTransport);
    const client = new Client({ name: "published-schema-test", version: "1.0.0" });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    await client.close();

    const properties = (
      tools.find((t) => t.name === "fizzy_create_comment")!.inputSchema as {
        properties: Record<string, { description?: string }>;
      }
    ).properties;

    expect(properties.card_id.description).toMatch(/either card_id or card_number/i);
    expect(properties.body.description).toMatch(/comment content/i);
  });
});
