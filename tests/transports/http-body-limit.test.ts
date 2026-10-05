/**
 * Request-body ceiling on the Streamable HTTP transport.
 *
 * Runs the real SDK transport over a real socket: the other HTTP transport
 * tests mock StreamableHTTPServerTransport, so they cannot see a body limit
 * the SDK applies while reading the request.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHTTPTransportServer, type HTTPTransportServer } from "../../src/transports/http.js";
import { MAX_ATTACHMENT_BYTES, MAX_REQUEST_BODY_BYTES } from "../../src/utils/attachments.js";

const TOKEN = "test-fizzy-token";

function post(
  port: number,
  body: string,
  headers: Record<string, string> = {},
  { sendBody = true, deadlineMs = 20000 }: { sendBody?: boolean; deadlineMs?: number } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    // Settle once, then drop the request: a header-only request never finishes
    // its declared body, and a failed one must not hold the server open.
    const finish = (fn: () => void, destroy: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn();
      if (destroy) req.destroy();
    };
    const fail = (err: Error) => finish(() => reject(err), true);
    const deadline = setTimeout(() => fail(new Error(`no response within ${deadlineMs}ms`)), deadlineMs);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () =>
          finish(() => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }), !sendBody)
        );
        res.on("aborted", () => fail(new Error("response aborted")));
        res.on("error", fail);
      }
    );
    // Errors after a complete response are the socket closing behind it.
    req.on("error", fail);
    if (sendBody) {
      req.end(body);
    } else {
      req.flushHeaders();
    }
  });
}

describe("HTTP transport request-body limit", () => {
  let server: HTTPTransportServer;
  let port: number;
  let sessionId: string;

  beforeAll(async () => {
    // The upload handler reaches the Fizzy API; keep it off the network.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network disabled in test")));

    server = createHTTPTransportServer({ port: 0 });
    await new Promise<void>((resolve) => server.server.listen(0, "127.0.0.1", () => resolve()));
    port = (server.server.address() as AddressInfo).port;

    const init = await post(
      port,
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "body-limit-test", version: "1.0.0" },
        },
      }),
      {},
      // Inside the 10s hook timeout.
      { deadlineMs: 5000 }
    );
    expect(init.status).toBe(200);
    sessionId = String(init.headers["mcp-session-id"]);
  });

  afterAll(async () => {
    await server.close();
    vi.unstubAllGlobals();
  });

  it("accepts a maximum-size fizzy_upload_file call, line-wrapped", async () => {
    // A newline every 16 characters spends the whitespace slack base64ToBytes
    // allows at this size, and JSON escapes each newline to two bytes: the
    // largest body line-wrapped Base64 can produce.
    const flat = Buffer.alloc(MAX_ATTACHMENT_BYTES).toString("base64");
    const wrapped = flat.match(/.{1,16}/g)!.join("\n");
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "fizzy_upload_file",
        arguments: { account_slug: "123456", base64_data: wrapped, filename: "screenshot.png" },
      },
    });

    // Well past the SDK's 4 MiB default, inside our ceiling.
    expect(Buffer.byteLength(body)).toBeGreaterThan(4 * 1024 * 1024);
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(MAX_REQUEST_BODY_BYTES);

    const res = await post(port, body, { "mcp-session-id": sessionId, "mcp-protocol-version": "2025-06-18" });
    expect(res.status).toBe(200);
    // The tool ran: it decoded the upload and failed only at the stubbed network.
    expect(res.text).toContain('"id":2');
    expect(res.text).toContain("network disabled in test");
  }, 30000);

  it("rejects a declared body over the ceiling with 413", async () => {
    // The transport refuses on Content-Length alone, so only headers are sent.
    const body = JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping", params: { pad: "" } });
    const oversized = body.replace('"pad":""', `"pad":"${"a".repeat(MAX_REQUEST_BODY_BYTES)}"`);

    const res = await post(
      port,
      oversized,
      { "mcp-session-id": sessionId, "mcp-protocol-version": "2025-06-18" },
      { sendBody: false, deadlineMs: 5000 }
    );
    expect(res.status).toBe(413);
  });
});
