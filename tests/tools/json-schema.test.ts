/**
 * Tool JSON Schema Tests
 *
 * MCP publishes tool `inputSchema` as JSON Schema draft 2020-12, and strict clients
 * validate it. The Anthropic Messages API rejects the *whole* request — every tool,
 * not just the offending one — with `tools.N.custom.input_schema: JSON schema is
 * invalid` when a schema carries a pre-2019 keyword. A single bad Zod modifier is
 * therefore a total outage for that client, so every tool is swept here.
 *
 * Regression: `page: z.number().int().positive()` on fizzy_get_cards rendered as the
 * draft-04 `exclusiveMinimum: true`, which broke tools/list for Claude clients.
 */

import { describe, it, expect } from "vitest";
import { ALL_TOOLS } from "../../src/tools/definitions.js";
import {
  buildMcpToolDefinitions,
  toolInputJsonSchema,
} from "../../src/tools/json-schema.js";

const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

const VALID_TYPES = new Set([
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);

/** Keywords that a draft 2020-12 validator rejects or silently ignores. */
function findLegacyKeywords(node: unknown, path: string): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => findLegacyKeywords(item, `${path}[${i}]`));
  }
  if (node === null || typeof node !== "object") {
    return [];
  }

  const schema = node as Record<string, unknown>;
  const problems: string[] = [];
  const at = path || "<root>";

  for (const keyword of ["exclusiveMinimum", "exclusiveMaximum"]) {
    if (typeof schema[keyword] === "boolean") {
      problems.push(
        `${at}: "${keyword}" is a boolean (draft-04); draft 2020-12 requires a number`
      );
    }
  }
  if (Array.isArray(schema.items)) {
    problems.push(`${at}: "items" is a tuple (draft-07); use "prefixItems"`);
  }
  if ("additionalItems" in schema) {
    problems.push(`${at}: "additionalItems" was removed in draft 2020-12`);
  }
  if ("definitions" in schema) {
    problems.push(`${at}: "definitions" is draft-07; draft 2020-12 uses "$defs"`);
  }
  if ("dependencies" in schema) {
    problems.push(
      `${at}: "dependencies" was split into "dependentSchemas"/"dependentRequired"`
    );
  }
  if (typeof schema.$schema === "string" && schema.$schema !== DRAFT_2020_12) {
    problems.push(`${at}: "$schema" declares ${schema.$schema}`);
  }
  if (typeof schema.required === "boolean") {
    problems.push(`${at}: "required" is a boolean (draft-03)`);
  }

  const declaredType = schema.type;
  const types =
    typeof declaredType === "string"
      ? [declaredType]
      : Array.isArray(declaredType)
        ? declaredType
        : [];
  for (const type of types) {
    if (typeof type !== "string" || !VALID_TYPES.has(type)) {
      problems.push(`${at}: invalid type ${JSON.stringify(type)}`);
    }
  }

  for (const [key, value] of Object.entries(schema)) {
    if (
      (key === "properties" || key === "$defs" || key === "patternProperties") &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      for (const [child, childSchema] of Object.entries(
        value as Record<string, unknown>
      )) {
        problems.push(...findLegacyKeywords(childSchema, `${at}.${key}.${child}`));
      }
    } else if (value !== null && typeof value === "object") {
      problems.push(...findLegacyKeywords(value, `${at}.${key}`));
    }
  }

  return problems;
}

describe("Tool JSON Schema — draft 2020-12 compliance", () => {
  const tools = buildMcpToolDefinitions();

  it("publishes one schema per registered tool", () => {
    expect(tools).toHaveLength(ALL_TOOLS.length);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("emits no pre-2019 JSON Schema keywords in any tool", () => {
    const problems = tools.flatMap((tool) =>
      findLegacyKeywords(tool.inputSchema, "").map(
        (problem) => `${tool.name} ${problem}`
      )
    );

    expect(problems).toEqual([]);
  });

  it.each(ALL_TOOLS.map((tool) => tool.name))(
    "%s publishes a strict object schema",
    (name) => {
      const tool = tools.find((candidate) => candidate.name === name);

      expect(tool).toBeDefined();
      expect(tool!.inputSchema.type).toBe("object");
      expect(tool!.inputSchema.additionalProperties).toBe(false);
      expect(tool!.inputSchema.$schema).toBeUndefined();
    }
  );
});

describe("Tool JSON Schema — fizzy_get_cards pagination", () => {
  const pageSchema = () => {
    const tool = buildMcpToolDefinitions().find(
      (candidate) => candidate.name === "fizzy_get_cards"
    );
    const properties = tool!.inputSchema.properties as Record<string, unknown>;
    return properties.page as Record<string, unknown>;
  };

  it("bounds page with an inclusive numeric minimum", () => {
    const page = pageSchema();

    expect(page.type).toBe("integer");
    expect(page.minimum).toBe(1);
    expect(page).not.toHaveProperty("exclusiveMinimum");
  });

  it("keeps the upper bound inclusive and numeric", () => {
    const page = pageSchema();

    expect(page.maximum).toBe(Number.MAX_SAFE_INTEGER);
    expect(page).not.toHaveProperty("exclusiveMaximum");
  });

  it("still rejects page 0 and accepts page 1 at the Zod layer", () => {
    const schema = ALL_TOOLS.find(
      (tool) => tool.name === "fizzy_get_cards"
    )!.schema;

    expect(
      schema.safeParse({ account_slug: "123456", page: 0 }).success
    ).toBe(false);
    expect(
      schema.safeParse({ account_slug: "123456", page: 1 }).success
    ).toBe(true);
  });
});

describe("toolInputJsonSchema", () => {
  it("strips $schema and enforces additionalProperties on every tool", () => {
    for (const tool of ALL_TOOLS) {
      const schema = toolInputJsonSchema(tool.schema);

      expect(schema).not.toHaveProperty("$schema");
      expect(schema.additionalProperties).toBe(false);
    }
  });
});
