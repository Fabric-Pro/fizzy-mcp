/**
 * Request-body ceiling in the session Durable Object.
 *
 * Exercises the parser the Durable Object calls, with real `Request` objects,
 * since the Durable Object itself imports `cloudflare:workers`.
 */
import { describe, it, expect } from "vitest";
import { parseJsonBody } from "../../src/cloudflare/request-body.js";
import { MAX_ATTACHMENT_BYTES, MAX_REQUEST_BODY_BYTES } from "../../src/utils/attachments.js";

const URL_ = "https://worker.example/mcp";
const CHUNK = 1024 * 1024;

/** A body streamed in 1 MiB chunks, with no Content-Length, that counts what was pulled. */
function streamedRequest(totalBytes: number): { request: Request; pulled: () => number } {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(CHUNK, totalBytes - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size).fill(0x61));
    },
    // No prefetch: a chunk is produced only when the reader asks for one.
  }, { highWaterMark: 0 });
  const request = new Request(URL_, { method: "POST", body, duplex: "half" } as RequestInit);
  return { request, pulled: () => sent };
}

describe("parseJsonBody", () => {
  it("parses a JSON-RPC message", async () => {
    const request = new Request(URL_, {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(await parseJsonBody(request)).toEqual({
      ok: true,
      message: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
  });

  it("accepts a maximum-size fizzy_upload_file call, line-wrapped", async () => {
    // Same shape as the HTTP transport test: the largest body line-wrapped
    // Base64 can produce for a maximum-size attachment.
    const wrapped = Buffer.alloc(MAX_ATTACHMENT_BYTES).toString("base64").match(/.{1,16}/g)!.join("\n");
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "fizzy_upload_file",
        arguments: { account_slug: "123456", base64_data: wrapped, filename: "screenshot.png" },
      },
    });
    expect(Buffer.byteLength(body)).toBeGreaterThan(4 * 1024 * 1024);

    const result = await parseJsonBody(new Request(URL_, { method: "POST", body }));
    expect(result.ok).toBe(true);
  });

  it("refuses a declared body over the ceiling with 413 without reading it", async () => {
    const { request, pulled } = streamedRequest(64);
    request.headers.set("content-length", String(MAX_REQUEST_BODY_BYTES + 1));

    expect(await parseJsonBody(request)).toEqual({
      ok: false,
      status: 413,
      code: -32000,
      message: `Payload Too Large: Request body must not exceed ${MAX_REQUEST_BODY_BYTES} bytes`,
    });
    expect(request.bodyUsed).toBe(false);
    expect(pulled()).toBe(0);
  });

  it("stops reading an undeclared body once it passes the ceiling", async () => {
    const total = MAX_REQUEST_BODY_BYTES + 8 * CHUNK;
    const { request, pulled } = streamedRequest(total);
    expect(request.headers.get("content-length")).toBeNull();

    const result = await parseJsonBody(request);
    expect(result).toMatchObject({ ok: false, status: 413, code: -32000 });
    // Stopped within a chunk or two of the ceiling, not at the end of the stream.
    expect(pulled()).toBeLessThan(MAX_REQUEST_BODY_BYTES + 3 * CHUNK);
  });

  it("answers invalid JSON with a 400 parse error", async () => {
    const request = new Request(URL_, { method: "POST", body: "{not json" });
    expect(await parseJsonBody(request)).toEqual({
      ok: false,
      status: 400,
      code: -32700,
      message: "Parse error",
    });
  });
});
