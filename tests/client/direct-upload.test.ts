/**
 * The two-step ActionText direct-upload flow, exercised against a stubbed
 * `fetch`. The three assertions that matter are the ones whose failures the
 * real API reports unhelpfully: a hex checksum, headers that differ from the
 * ones storage signed, and — the one no API error would ever reveal — the Fizzy
 * bearer token being sent to a third-party storage host.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { FizzyClient } from "../../src/client/fizzy-client.js";

const ACCOUNT = "/6117483";
const STORAGE_URL = "https://storage.example.com/upload/abc?signature=xyz";
const ATTACHABLE_SGID = "eyJfcmFpbHMiOnsiZGF0YSI6ImdpZDovL2Zpenp5In19--attachable";
const BLOB_SIGNED_ID = "eyJfcmFpbHMiOnsiZGF0YSI6IjAzZ2wifX0=--blob-id";

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: RecordedCall[];
const originalFetch = globalThis.fetch;

function directUploadResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "abc123",
    key: "abc123def456",
    filename: "screenshot.png",
    content_type: "image/png",
    byte_size: 5,
    checksum: "ignored-by-client",
    attachable_sgid: ATTACHABLE_SGID,
    signed_id: BLOB_SIGNED_ID,
    direct_upload: {
      url: STORAGE_URL,
      headers: {
        // Three headers, not two: the real API also returns Content-Disposition,
        // which is why they are echoed wholesale rather than picked out by name.
        "Content-Type": "image/png",
        "Content-MD5": "GQ5SqLsM7ylnji0Wgd9wNA==",
        "Content-Disposition": 'inline; filename="screenshot.png"',
      },
    },
    ...overrides,
  };
}

function stubFetch(handler: (call: RecordedCall) => Response) {
  globalThis.fetch = vi.fn(async (url: unknown, init: Record<string, unknown> = {}) => {
    const call: RecordedCall = {
      url: String(url),
      method: (init.method as string) ?? "GET",
      headers: (init.headers as Record<string, string>) ?? {},
      body: init.body,
    };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function client(): FizzyClient {
  // Retries off: a retrying client would mask which request actually failed.
  return new FizzyClient({ accessToken: "test-token", maxRetries: 0 });
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("createDirectUpload", () => {
  it("posts the blob envelope to the account-scoped direct_uploads endpoint", async () => {
    stubFetch(() => jsonResponse(directUploadResponse()));

    await client().createDirectUpload(ACCOUNT, {
      filename: "screenshot.png",
      byte_size: 5,
      checksum: "GQ5SqLsM7ylnji0Wgd9wNA==",
      content_type: "image/png",
    });

    expect(calls).toHaveLength(1);
    // The leading slash on the account slug must be normalized away, as elsewhere.
    expect(calls[0].url).toBe(
      "https://app.fizzy.do/6117483/rails/active_storage/direct_uploads"
    );
    expect(calls[0].method).toBe("POST");
    expect(JSON.parse(calls[0].body as string)).toEqual({
      blob: {
        filename: "screenshot.png",
        byte_size: 5,
        checksum: "GQ5SqLsM7ylnji0Wgd9wNA==",
        content_type: "image/png",
      },
    });
  });
});

describe("uploadFile", () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);

  function stubHappyPath() {
    stubFetch((call) =>
      call.method === "POST" ? jsonResponse(directUploadResponse()) : new Response(null, { status: 204 })
    );
  }

  it("sends a Base64-encoded MD5 as the checksum, not hex", async () => {
    stubHappyPath();

    await client().uploadFile(ACCOUNT, {
      bytes,
      filename: "screenshot.png",
      contentType: "image/png",
    });

    const blob = JSON.parse(calls[0].body as string).blob;
    expect(blob.checksum).toBe(createHash("md5").update(bytes).digest("base64"));
    expect(blob.checksum).not.toBe(createHash("md5").update(bytes).digest("hex"));
    expect(blob.byte_size).toBe(5);
  });

  it("PUTs the bytes to the storage URL from step 1", async () => {
    stubHappyPath();

    await client().uploadFile(ACCOUNT, {
      bytes,
      filename: "screenshot.png",
      contentType: "image/png",
    });

    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe(STORAGE_URL);
    expect(calls[1].method).toBe("PUT");
    expect(Array.from(calls[1].body as Uint8Array)).toEqual(Array.from(bytes));
  });

  it("echoes step 1's headers back verbatim, adding nothing", async () => {
    stubHappyPath();

    await client().uploadFile(ACCOUNT, {
      bytes,
      filename: "screenshot.png",
      contentType: "image/png",
    });

    // Signed storage URLs verify the signature against exactly these headers and
    // reject any deviation with an error that never mentions headers. Asserting
    // equality (not containment) is the point: an extra header breaks it too.
    expect(calls[1].headers).toEqual({
      "Content-Type": "image/png",
      "Content-MD5": "GQ5SqLsM7ylnji0Wgd9wNA==",
      "Content-Disposition": 'inline; filename="screenshot.png"',
    });
  });

  it("never sends the Fizzy access token to the storage host", async () => {
    stubHappyPath();

    await client().uploadFile(ACCOUNT, {
      bytes,
      filename: "screenshot.png",
      contentType: "image/png",
    });

    const storageHeaderValues = Object.values(calls[1].headers).join(" ");
    expect(Object.keys(calls[1].headers)).not.toContain("Authorization");
    expect(storageHeaderValues).not.toContain("test-token");
    // The API call, by contrast, must still be authenticated.
    expect(calls[0].headers.Authorization).toBe("Bearer test-token");
  });

  it("returns both signed tokens, which are distinct and not interchangeable", async () => {
    stubHappyPath();

    const upload = await client().uploadFile(ACCOUNT, {
      bytes,
      filename: "screenshot.png",
      contentType: "image/png",
    });

    expect(upload.attachable_sgid).toBe(ATTACHABLE_SGID);
    expect(upload.signed_id).toBe(BLOB_SIGNED_ID);
    expect(upload.filename).toBe("screenshot.png");
  });

  it("surfaces a storage rejection instead of reporting success", async () => {
    stubFetch((call) =>
      call.method === "POST"
        ? jsonResponse(directUploadResponse())
        : new Response("SignatureDoesNotMatch", { status: 403 })
    );

    await expect(
      client().uploadFile(ACCOUNT, { bytes, filename: "a.png", contentType: "image/png" })
    ).rejects.toThrow();
  });

  it("does not attempt the upload when step 1 fails", async () => {
    stubFetch(() => jsonResponse({ error: "unprocessable" }, 422));

    await expect(
      client().uploadFile(ACCOUNT, { bytes, filename: "a.png", contentType: "image/png" })
    ).rejects.toThrow();

    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });
});
