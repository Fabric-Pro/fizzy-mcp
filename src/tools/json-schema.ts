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

import { zodToJsonSchema } from "zod-to-json-schema";
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
 * `target: "jsonSchema7"` is deliberate and load-bearing. It is the only target for
 * which zod-to-json-schema emits *numeric* `exclusiveMinimum` / `exclusiveMaximum`;
 * every other target — including "jsonSchema2019-09" — falls back to the draft-04
 * boolean flag (`exclusiveMinimum: true`), which is invalid under draft 2020-12.
 * The two drafts agree on everything else this codebase emits, and `$refStrategy:
 * "none"` inlines all definitions so the `definitions` / `$defs` naming difference
 * never surfaces.
 */
export function toolInputJsonSchema(
  schema: ToolDefinition["schema"]
): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(schema, {
    target: "jsonSchema7",
    $refStrategy: "none",
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
