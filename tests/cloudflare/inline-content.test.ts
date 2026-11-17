import { vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
import { McpSessionDO } from "../../src/cloudflare/mcp-session.js";
import type { Env } from "../../src/cloudflare/types.js";
import { setInlineContentLimits } from "../../src/utils/inline-content.js";
afterEach(() => setInlineContentLimits());
it("Worker forwards resource and rejects invalid limits", async () => {
  const env: Env = { LOG_LEVEL: "error" };
  const session = new McpSessionDO({ id: { toString: () => "example" } } as never, env);
  const internal = session as unknown as { client: unknown; handleToolCall(id: number, params: unknown): Promise<unknown> };
  internal.client = { fetchAttachment: async () => ({ contentType: "text/plain", bytes: new TextEncoder().encode("example"), byteSize: 7 }) };
  const args = { name: "fizzy_get_attachment", arguments: { account_slug: "123456", signed_id: "example--1111111111111111111111111111111111111111", filename: "example.txt", include_content: true } };
  const result = await internal.handleToolCall(1, args) as { result: { content: unknown[] } };
  expect(result.result.content[1]).toEqual({ type: "resource", resource: { uri: "fizzy-attachment:///example.txt", mimeType: "text/plain", text: "example" } });
  for (const name of ["FIZZY_MAX_INLINE_TEXT_BYTES", "FIZZY_MAX_INLINE_BINARY_BYTES"] as const) {
    env[name] = "0";
    expect(JSON.stringify(await internal.handleToolCall(2, args))).toContain(name);
    delete env[name];
  }
});
