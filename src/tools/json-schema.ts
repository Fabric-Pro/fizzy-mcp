/**
 * Zod → JSON Schema conversion for MCP tool definitions
 *
 * MCP declares tool `inputSchema` to be JSON Schema draft 2020-12. Strict clients
 * validate it — the Anthropic Messages API rejects the *entire* request with
 * `tools.N.custom.input_schema: JSON schema is invalid` when any single tool schema
 * carries a legacy draft-04 keyword. One bad schema therefore takes down every tool
 * in the list, so the conversion lives here behind a regression test rather than
 * being inlined per transport.
 *
 * @see tests/tools/json-schema.test.ts
 */

import { z } from "zod";
import { ALL_TOOLS, type ToolDefinition } from "./definitions.js";

/**
 * A tool as served over the wire by `tools/list`.
 */
export interface McpToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
}

/**
 * Convert a tool's Zod schema into the JSON Schema published to clients.
 *
 * Zod 4 converts natively, and emits *numeric* `exclusiveMinimum` /
 * `exclusiveMaximum` for every target it supports — the draft-04 boolean flag that
 * took down whole tool lists under Zod 3's converter can no longer appear.
 *
 * `io: "input"` is the one option here that departs from Zod's defaults, and it is
 * the correct one for an argument schema: it converts the schema as arguments
 * arrive rather than as they come out of `parse`, which is the difference between
 * `.default()` publishing as an optional property and publishing as a required one.
 * It also suppresses the `additionalProperties: false` that Zod adds on the output
 * side, which is why strict mode is still applied by hand below.
 *
 * `target` and `reused` restate Zod's current defaults rather than change them.
 * They are passed explicitly so that a Zod release changing a default cannot
 * silently rewrite every published schema: 2020-12 is the draft MCP declares, and
 * inlining every definition keeps `$ref` / `$defs` out of what clients receive.
 * `unrepresentable` is left alone at `"throw"` — nothing in schemas.ts is
 * unrepresentable in JSON Schema today, and a schema that becomes so should fail
 * the build here rather than ship a tool the client cannot validate.
 *
 * The `override` hook does one thing: move `description` to the end of each schema
 * object. Zod emits it first on anything behind a modifier, and
 * `.optional().describe(...)` is the prevailing style in schemas.ts, so without
 * this the keys of nearly every published property reorder. Key order means
 * nothing in JSON Schema, but it is what goes over the wire, and this migration
 * changes no published byte.
 */
export function toolInputJsonSchema(
  schema: ToolDefinition["schema"]
): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
    reused: "inline",
    override: ({ jsonSchema }) => {
      if ("description" in jsonSchema) {
        const { description } = jsonSchema;
        delete jsonSchema.description;
        jsonSchema.description = description;
      }
    },
  }) as Record<string, unknown>;

  // Remove $schema field (MCP defaults to 2020-12)
  if ("$schema" in jsonSchema) {
    delete jsonSchema.$schema;
  }

  // Add strict mode (additionalProperties: false)
  if (jsonSchema.type === "object") {
    jsonSchema.additionalProperties = false;
  }

  return jsonSchema;
}

/**
 * Build the full tool list served by `tools/list`.
 */
export function buildMcpToolDefinitions(): McpToolDefinition[] {
  return ALL_TOOLS.map((toolDef) => ({
    name: toolDef.name,
    title: toolDef.title,
    description: toolDef.description,
    inputSchema: toolInputJsonSchema(toolDef.schema),
    annotations: toolDef.annotations,
  }));
}
