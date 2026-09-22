/**
 * Guards the parameter list every tool publishes to clients.
 *
 * McpServer reads a tool's fields off its schema's shape. Under Zod 3 a
 * `.refine()`d schema was a ZodEffects, which has no shape, so the SDK fell back
 * to `{"type":"object","properties":{}}` and the tool arrived at the client with
 * no discoverable arguments. It still executed — the SDK validates against the
 * unwrapped schema at call time — so nothing failed loudly, and two tools shipped
 * that way unnoticed.
 *
 * Zod 4 removed ZodEffects and a refined object keeps its shape, so `.refine()`
 * no longer does this; `.transform()` still wraps, as a ZodPipe, and would.
 *
 * These tests assert the property list directly rather than trusting that a
 * schema "looks fine", because the failure is invisible in the schema source.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ALL_TOOLS } from "../../src/tools/definitions.js";
import * as schemas from "../../src/tools/schemas.js";
import { buildMcpToolDefinitions } from "../../src/tools/json-schema.js";

/** What McpServer.registerTool can read fields from. */
function publishesItsFields(schema: unknown): boolean {
  return schema instanceof z.ZodObject;
}

describe("published tool schemas", () => {
  it("every tool exposes a shape the MCP server can read fields from", () => {
    const unreadable = ALL_TOOLS.filter((tool) => !publishesItsFields(tool.schema)).map(
      (tool) => tool.name
    );

    expect(unreadable).toEqual([]);
  });

  it("no exported schema is a transform pipe, which would hide its shape", () => {
    const wrapped = Object.entries(schemas)
      .filter(([, schema]) => schema instanceof z.ZodPipe)
      .map(([name]) => name);

    // Refinements belong in the handlers, which must own them anyway: the
    // Cloudflare transport dispatches raw arguments and never runs Zod.
    expect(wrapped).toEqual([]);
  });

  it("only the genuinely argument-less tools publish an empty property list", () => {
    const empty = ALL_TOOLS.filter((tool) => {
      const shape = (tool.schema as z.ZodObject<z.ZodRawShape>).shape;
      return !shape || Object.keys(shape).length === 0;
    }).map((tool) => tool.name);

    // These two take no arguments at all, so empty is correct for them. Naming
    // them rather than allowing any empty tool keeps the check meaningful: a
    // tool that loses its parameters still fails here.
    expect(empty.sort()).toEqual(["fizzy_get_accounts", "fizzy_get_identity"]);
  });

  it("the two tools that regressed publish their full parameter lists", () => {
    // Read off the Zod shape, which is the thing McpServer reads. Asserting the
    // Cloudflare JSON Schema here would prove nothing: its converter (then
    // zod-to-json-schema) unwrapped ZodEffects by default, so it emitted the
    // full list even while the bug was live.
    const shapeOf = (name: string) =>
      Object.keys(
        ((ALL_TOOLS.find((t) => t.name === name)!.schema as z.ZodObject<z.ZodRawShape>) ?? {})
          .shape ?? {}
      );

    expect(shapeOf("fizzy_create_comment")).toEqual([
      "account_slug",
      "card_id",
      "card_number",
      "body",
    ]);
    expect(shapeOf("fizzy_get_card_comments")).toEqual([
      "account_slug",
      "card_id",
      "card_number",
      "fields",
      "include_attachments",
    ]);
  });

  it("keeps documenting that card_id and card_number are alternatives", () => {
    // The rule left the schema as a refinement, so the descriptions are now the
    // only place a model learns it before calling.
    const shape = (
      ALL_TOOLS.find((t) => t.name === "fizzy_create_comment")!
        .schema as z.ZodObject<z.ZodRawShape>
    ).shape;

    expect(shape.card_id.description).toMatch(/either card_id or card_number/i);
    expect(shape.card_number.description).toMatch(/either card_id or card_number/i);
  });

  it("the Cloudflare path was never affected and still publishes everything", () => {
    // Recorded deliberately: this path unwrapped ZodEffects under Zod 3, so it
    // stayed correct throughout. It is here to catch a regression in the other direction, not
    // to guard the bug this file is about.
    const published = new Map(
      buildMcpToolDefinitions().map((tool) => [
        tool.name,
        Object.keys((tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}),
      ])
    );

    expect(published.get("fizzy_create_comment")).toEqual([
      "account_slug",
      "card_id",
      "card_number",
      "body",
    ]);
  });
});
