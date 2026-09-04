/**
 * fizzy_get_attachment: the argument validation that is the tool's security
 * boundary, and the content blocks it returns.
 *
 * The validation tests matter disproportionately because the Cloudflare
 * transport dispatches raw arguments with no Zod validation at all — the
 * handler is the only enforcement point on that path, so every case here is
 * driven through the handler rather than through a schema.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { FizzyClient } from "../../src/client/fizzy-client.js";
import { createFizzyServer } from "../../src/server.js";
import { FizzyClient as RealFizzyClient } from "../../src/client/fizzy-client.js";
import { toolHandlers, toMcpContent } from "../../src/tools/handlers.js";
import { MAX_INLINE_IMAGE_BYTES } from "../../src/utils/attachments.js";
import { FizzyAttachmentTooLargeError } from "../../src/utils/errors.js";
import { bytesToBase64 } from "../../src/utils/base64.js";

const SIGNED_ID =
  "eyJfcmFpbHMiOnsiZGF0YSI6ImV4YW1wbGVibG9iaWQiLCJwdXIiOiJibG9iX2lkIn19--1111111111111111111111111111111111111111";
const VARIATION =
  "eyJfcmFpbHMiOnsiZGF0YSI6InJlc2l6ZV90b19saW1pdCIsInB1ciI6InZhcmlhdGlvbiJ9fQ==--3333333333333333333333333333333333333333";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

const VALID_ARGS = {
  account_slug: "1234567",
  signed_id: SIGNED_ID,
  filename: "screenshot.png",
};

interface FetchCall {
  accountSlug: string;
  ref: { signedId: string; filename: string; variation?: string };
  options: {
    maxBytes: number;
    shouldReadBody?: (contentType: string) => boolean;
  };
}

let fetchCalls: FetchCall[];

function mockClient(
  result: unknown = { contentType: "image/png", bytes: PNG_BYTES, byteSize: PNG_BYTES.length }
): FizzyClient {
  return {
    getBaseUrl: () => "https://fizzy.example.com",
    fetchAttachment: vi.fn(async (accountSlug, ref, options) => {
      fetchCalls.push({ accountSlug, ref, options } as FetchCall);
      if (result instanceof Error) throw result;
      return result;
    }),
  } as unknown as FizzyClient;
}

const getAttachment = (client: FizzyClient, args: Record<string, unknown>) =>
  toolHandlers.fizzy_get_attachment(client, args);

beforeEach(() => {
  fetchCalls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fizzy_get_attachment: never takes a URL", () => {
  it.each(["url", "preview_url", "blob_url", "attachment_url", "src"])(
    "rejects a caller-supplied %s outright",
    async (key) => {
      await expect(
        getAttachment(mockClient(), {
          ...VALID_ARGS,
          [key]: "https://attacker.example/collect",
        })
      ).rejects.toThrow(/does not take a URL/i);

      // Rejected before any request: a URL argument must never reach a fetch
      // that carries the Fizzy token.
      expect(fetchCalls).toHaveLength(0);
    }
  );

  it("rejects a URL passed in place of the signed id", async () => {
    await expect(
      getAttachment(mockClient(), {
        ...VALID_ARGS,
        signed_id: "https://attacker.example/steal",
      })
    ).rejects.toThrow(/signed_id/i);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("fizzy_get_attachment: path components", () => {
  it.each([
    ["a directory separator", "../../etc/passwd"],
    ["a nested path", "images/screenshot.png"],
    ["a Windows separator", "..\\..\\secrets.txt"],
    ["a bare parent segment", ".."],
    ["a bare current segment", "."],
  ])("rejects a filename that is %s", async (_label, filename) => {
    await expect(
      getAttachment(mockClient(), { ...VALID_ARGS, filename })
    ).rejects.toThrow();
    expect(fetchCalls).toHaveLength(0);
  });

  it.each([
    ["a slash", `${SIGNED_ID}/../../admin`],
    ["a backslash", `${SIGNED_ID}\\x`],
    ["a percent escape", `${SIGNED_ID}%2F..%2Fadmin`],
    ["a parent segment", ".."],
    ["a space", `${SIGNED_ID} extra`],
  ])("rejects a signed_id containing %s", async (_label, signedId) => {
    await expect(
      getAttachment(mockClient(), { ...VALID_ARGS, signed_id: signedId })
    ).rejects.toThrow(/signed_id/i);
    expect(fetchCalls).toHaveLength(0);
  });

  it("rejects a variation token containing a separator", async () => {
    await expect(
      getAttachment(mockClient(), { ...VALID_ARGS, variation: "../other" })
    ).rejects.toThrow(/variation/i);
    expect(fetchCalls).toHaveLength(0);
  });

  it.each([
    ["a path", "1234567/../9999999"],
    ["a URL", "https://attacker.example"],
    ["a parent segment", ".."],
  ])("rejects an account_slug that is %s", async (_label, slug) => {
    await expect(
      getAttachment(mockClient(), { ...VALID_ARGS, account_slug: slug })
    ).rejects.toThrow(/account_slug/i);
    expect(fetchCalls).toHaveLength(0);
  });

  it("accepts an account slug written with its leading slash", async () => {
    await getAttachment(mockClient(), { ...VALID_ARGS, account_slug: "/1234567" });
    expect(fetchCalls[0].accountSlug).toBe("1234567");
  });

  it.each(["account_slug", "signed_id", "filename"])(
    "requires %s",
    async (key) => {
      const args = { ...VALID_ARGS } as Record<string, unknown>;
      delete args[key];
      await expect(getAttachment(mockClient(), args)).rejects.toThrow(
        new RegExp(key, "i")
      );
    }
  );

  it("passes the validated parts through unchanged", async () => {
    await getAttachment(mockClient(), { ...VALID_ARGS, variation: VARIATION });

    expect(fetchCalls[0].ref).toEqual({
      signedId: SIGNED_ID,
      filename: "screenshot.png",
      variation: VARIATION,
    });
  });
});

describe("fizzy_get_attachment: what it returns", () => {
  it("returns an image content block a model can actually see", async () => {
    const result = await getAttachment(mockClient(), VALID_ARGS);

    const content = toMcpContent(result);
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({
      type: "text",
      text: JSON.stringify(
        {
          filename: "screenshot.png",
          content_type: "image/png",
          byte_size: PNG_BYTES.length,
          variant: "original",
        },
        null,
        2
      ),
    });
    expect(content[1]).toEqual({
      type: "image",
      data: bytesToBase64(PNG_BYTES),
      mimeType: "image/png",
    });
  });

  it("labels a variation fetch as the preview", async () => {
    const result = await getAttachment(mockClient(), {
      ...VALID_ARGS,
      variation: VARIATION,
    });

    const [summary] = toMcpContent(result);
    expect(summary.type).toBe("text");
    expect(JSON.parse((summary as { text: string }).text).variant).toBe("preview");
  });

  it("caps what it will inline well below the upload limit", async () => {
    await getAttachment(mockClient(), VALID_ARGS);
    expect(fetchCalls[0].options.maxBytes).toBe(MAX_INLINE_IMAGE_BYTES);
    expect(MAX_INLINE_IMAGE_BYTES).toBeLessThan(10 * 1024 * 1024);
  });

  it("only asks for the bytes of types a model can decode", async () => {
    await getAttachment(mockClient(), VALID_ARGS);
    const shouldReadBody = fetchCalls[0].options.shouldReadBody!;

    expect(shouldReadBody("image/png")).toBe(true);
    expect(shouldReadBody("image/jpeg")).toBe(true);
    expect(shouldReadBody("image/gif")).toBe(true);
    expect(shouldReadBody("image/webp")).toBe(true);
    // Not renderable by a vision model, so not worth downloading either.
    expect(shouldReadBody("image/svg+xml")).toBe(false);
    expect(shouldReadBody("application/zip")).toBe(false);
    expect(shouldReadBody("application/pdf")).toBe(false);
    expect(shouldReadBody("")).toBe(false);
  });

  it("reports a non-renderable type as metadata instead of base64", async () => {
    const client = mockClient({
      contentType: "application/zip",
      byteSize: 40_000_000,
    });

    const result = await getAttachment(client, { ...VALID_ARGS, filename: "logs.zip" });

    expect(result).toEqual({
      filename: "logs.zip",
      content_type: "application/zip",
      byte_size: 40_000_000,
      variant: "original",
      renderable: false,
      note: expect.stringContaining("cannot be shown as an image"),
    });
    // Formatted as ordinary JSON text — no image block, no megabytes of base64.
    const content = toMcpContent(result);
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
  });

  it("falls back to a generic type when the server names none", async () => {
    const client = mockClient({ contentType: "", byteSize: 12 });
    const result = (await getAttachment(client, VALID_ARGS)) as Record<string, unknown>;

    expect(result.content_type).toBe("application/octet-stream");
    expect(result.renderable).toBe(false);
  });
});

describe("fizzy_get_attachment: oversized attachments", () => {
  it("points an oversized original at its preview variation", async () => {
    const client = mockClient(
      new FizzyAttachmentTooLargeError(
        "screenshot.png is 9000000 bytes, over the 3145728-byte limit for an inlined attachment",
        3145728,
        9000000
      )
    );

    await expect(getAttachment(client, VALID_ARGS)).rejects.toThrow(
      /preview_variation/
    );
  });

  it("does not suggest the preview when the preview is what was already asked for", async () => {
    const client = mockClient(
      new FizzyAttachmentTooLargeError("too big", 3145728, 9000000)
    );

    await expect(
      getAttachment(client, { ...VALID_ARGS, variation: VARIATION })
    ).rejects.toThrow(/^too big$/);
  });
});

describe("fizzy_get_attachment over a real MCP connection", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("delivers the image block through the standard server's formatter", async () => {
    // The transports used to hardcode a single text block; this proves the
    // image survives the whole path, not just the handler.
    globalThis.fetch = vi.fn(async () =>
      new Response(PNG_BYTES, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(PNG_BYTES.length),
        },
      })
    ) as unknown as typeof fetch;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createFizzyServer(
      new RealFizzyClient({
        accessToken: "test-token",
        baseUrl: "https://fizzy.example.com",
        maxRetries: 0,
      })
    );
    await server.connect(serverTransport);
    const client = new Client({ name: "attachment-test", version: "1.0.0" });
    await client.connect(clientTransport);

    const result = (await client.callTool({
      name: "fizzy_get_attachment",
      arguments: VALID_ARGS,
    })) as { content: Array<Record<string, unknown>> };
    await client.close();

    expect(result.content).toHaveLength(2);
    expect(result.content[1]).toEqual({
      type: "image",
      data: bytesToBase64(PNG_BYTES),
      mimeType: "image/png",
    });
  });
});

describe("toMcpContent", () => {
  it("serializes ordinary results exactly as before", () => {
    expect(toMcpContent("Card 42 pinned")).toEqual([
      { type: "text", text: "Card 42 pinned" },
    ]);
    expect(toMcpContent({ id: "1" })).toEqual([
      { type: "text", text: JSON.stringify({ id: "1" }, null, 2) },
    ]);
  });

  it("does not mistake API data that happens to carry an mcp_content key", () => {
    // The marker is shape-checked, not just present-checked, so a payload that
    // borrows the name is still serialized as data.
    const payload = { mcp_content: ["not", "blocks"] };
    expect(toMcpContent(payload)).toEqual([
      { type: "text", text: JSON.stringify(payload, null, 2) },
    ]);

    const emptyish = { mcp_content: [] };
    expect(toMcpContent(emptyish)).toEqual([
      { type: "text", text: JSON.stringify(emptyish, null, 2) },
    ]);
  });
});
