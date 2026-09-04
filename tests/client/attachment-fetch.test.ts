/**
 * Reading an attachment back, exercised against a stubbed `fetch`.
 *
 * The assertion this file exists for is the one no API error would ever
 * reveal: the Fizzy bearer token must reach the API host and must NOT reach
 * whatever host the API's redirect names. Everything is asserted on behaviour —
 * hop 2 goes wherever hop 1's `Location` pointed, carrying no `Authorization` —
 * rather than on any particular storage hostname, which is configurable and
 * deployment-specific.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FizzyClient } from "../../src/client/fizzy-client.js";
import {
  FizzyAttachmentTooLargeError,
  FizzyAuthError,
  FizzyNotFoundError,
} from "../../src/utils/errors.js";

const BASE_URL = "https://fizzy.example.com";
const ACCOUNT = "/1234567";
const STORAGE_URL = "https://blobs.storage.example/download/abc?signature=xyz";

const SIGNED_ID =
  "eyJfcmFpbHMiOnsiZGF0YSI6ImV4YW1wbGVibG9iaWQiLCJwdXIiOiJibG9iX2lkIn19--1111111111111111111111111111111111111111";
const VARIATION =
  "eyJfcmFpbHMiOnsiZGF0YSI6InJlc2l6ZV90b19saW1pdCIsInB1ciI6InZhcmlhdGlvbiJ9fQ==--3333333333333333333333333333333333333333";

const REF = { signedId: SIGNED_ID, filename: "screenshot.png" };
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  redirect: string | undefined;
}

let calls: RecordedCall[];
const originalFetch = globalThis.fetch;

function stubFetch(handler: (call: RecordedCall, index: number) => Response) {
  globalThis.fetch = vi.fn(async (url: unknown, init: Record<string, unknown> = {}) => {
    const call: RecordedCall = {
      url: String(url),
      method: (init.method as string) ?? "GET",
      headers: (init.headers as Record<string, string>) ?? {},
      redirect: init.redirect as string | undefined,
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as unknown as typeof fetch;
}

function redirectTo(location: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: location } });
}

function binaryResponse(
  bytes: Uint8Array,
  contentType: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.length),
      ...extraHeaders,
    },
  });
}

function client(overrides: Record<string, unknown> = {}): FizzyClient {
  // Retries off and a short timeout: a retrying client would blur which
  // request actually carried which headers.
  return new FizzyClient({
    accessToken: "test-token",
    baseUrl: BASE_URL,
    maxRetries: 0,
    ...overrides,
  });
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchAttachment: the two hops and their credentials", () => {
  it("authenticates hop 1 and sends nothing to the host hop 1 redirects to", async () => {
    stubFetch((_call, index) =>
      index === 0 ? redirectTo(STORAGE_URL) : binaryResponse(PNG_BYTES, "image/png")
    );

    const result = await client().fetchAttachment(ACCOUNT, REF, {
      maxBytes: 1024 * 1024,
    });

    expect(calls).toHaveLength(2);

    const [apiCall, storageCall] = calls;
    expect(apiCall.url).toBe(
      `${BASE_URL}/1234567/rails/active_storage/blobs/redirect/${SIGNED_ID}/screenshot.png`
    );
    expect(apiCall.headers.Authorization).toBe("Bearer test-token");

    // Hop 2 goes wherever hop 1 pointed, and goes there bare.
    expect(storageCall.url).toBe(STORAGE_URL);
    expect(storageCall.headers.Authorization).toBeUndefined();
    expect(
      Object.keys(storageCall.headers).map((name) => name.toLowerCase())
    ).not.toContain("authorization");
    expect(
      JSON.stringify(storageCall.headers).includes("test-token")
    ).toBe(false);

    expect(result.contentType).toBe("image/png");
    expect(result.bytes).toEqual(PNG_BYTES);
    expect(result.byteSize).toBe(PNG_BYTES.length);
  });

  it("never lets the runtime follow the redirect on its own", async () => {
    // Auto-follow would decide for itself whether to keep the Authorization
    // header across origins, and that decision differs between undici and
    // Workers. Both hops must be issued with redirect: "manual".
    stubFetch((_call, index) =>
      index === 0 ? redirectTo(STORAGE_URL) : binaryResponse(PNG_BYTES, "image/png")
    );

    await client().fetchAttachment(ACCOUNT, REF, { maxBytes: 1024 * 1024 });

    expect(calls.map((call) => call.redirect)).toEqual(["manual", "manual"]);
  });

  it("keeps the token on a redirect that stays on the Fizzy origin", async () => {
    // A variant that is not yet processed can redirect within the API host
    // first; that hop still needs the credential, which is why the decision is
    // per-origin rather than per-hop-number.
    const sameOrigin = `${BASE_URL}/1234567/rails/active_storage/representations/proxy/${SIGNED_ID}/${VARIATION}/screenshot.png`;
    stubFetch((_call, index) => {
      if (index === 0) return redirectTo(sameOrigin);
      if (index === 1) return redirectTo(STORAGE_URL);
      return binaryResponse(PNG_BYTES, "image/png");
    });

    await client().fetchAttachment(ACCOUNT, REF, { maxBytes: 1024 * 1024 });

    expect(calls).toHaveLength(3);
    expect(calls[0].headers.Authorization).toBe("Bearer test-token");
    expect(calls[1].headers.Authorization).toBe("Bearer test-token");
    expect(calls[2].headers.Authorization).toBeUndefined();
  });

  it("resolves a relative Location against the URL that returned it", async () => {
    stubFetch((_call, index) =>
      index === 0
        ? redirectTo("/1234567/elsewhere/screenshot.png")
        : binaryResponse(PNG_BYTES, "image/png")
    );

    await client().fetchAttachment(ACCOUNT, REF, { maxBytes: 1024 * 1024 });

    expect(calls[1].url).toBe(`${BASE_URL}/1234567/elsewhere/screenshot.png`);
    expect(calls[1].headers.Authorization).toBe("Bearer test-token");
  });

  it("serves the blob directly when there is no redirect at all", async () => {
    stubFetch(() => binaryResponse(PNG_BYTES, "image/png"));

    const result = await client().fetchAttachment(ACCOUNT, REF, {
      maxBytes: 1024 * 1024,
    });

    expect(calls).toHaveLength(1);
    expect(result.bytes).toEqual(PNG_BYTES);
  });
});

describe("fetchAttachment: what it refuses to follow", () => {
  it("refuses a redirect to a non-http scheme", async () => {
    stubFetch(() => redirectTo("file:///etc/passwd"));

    await expect(
      client().fetchAttachment(ACCOUNT, REF, { maxBytes: 1024 })
    ).rejects.toThrow(/only http and https/i);

    expect(calls).toHaveLength(1);
  });

  it("reports a redirect to sign-in as the authentication failure it is", async () => {
    stubFetch(() => redirectTo(`${BASE_URL}/session/new`));

    await expect(
      client().fetchAttachment(ACCOUNT, REF, { maxBytes: 1024 })
    ).rejects.toBeInstanceOf(FizzyAuthError);

    // The sign-in page is never fetched, so an HTML login form can never come
    // back typed as the caller's attachment.
    expect(calls).toHaveLength(1);
  });

  it("stops a redirect loop rather than looping forever", async () => {
    stubFetch((call) => redirectTo(`${call.url}x`));

    await expect(
      client().fetchAttachment(ACCOUNT, REF, { maxBytes: 1024 })
    ).rejects.toThrow(/redirected more than/i);

    expect(calls.length).toBeLessThanOrEqual(6);
  });

  it("surfaces a 3xx with no Location rather than hanging on it", async () => {
    stubFetch(() => new Response(null, { status: 302 }));

    await expect(
      client().fetchAttachment(ACCOUNT, REF, { maxBytes: 1024 })
    ).rejects.toThrow(/no Location header/i);
  });

  it("maps an API error status onto the usual error classes", async () => {
    stubFetch(() => new Response("no such blob", { status: 404 }));

    await expect(
      client().fetchAttachment(ACCOUNT, REF, { maxBytes: 1024 })
    ).rejects.toBeInstanceOf(FizzyNotFoundError);
  });
});

describe("fetchAttachment: paths it builds", () => {
  it("builds the representation path when a variation is given", async () => {
    stubFetch(() => binaryResponse(PNG_BYTES, "image/png"));

    await client().fetchAttachment(
      ACCOUNT,
      { ...REF, variation: VARIATION },
      { maxBytes: 1024 * 1024 }
    );

    expect(calls[0].url).toBe(
      `${BASE_URL}/1234567/rails/active_storage/representations/redirect/` +
        `${SIGNED_ID}/${VARIATION}/screenshot.png`
    );
  });

  it("percent-encodes the filename segment", async () => {
    stubFetch(() => binaryResponse(PNG_BYTES, "image/png"));

    await client().fetchAttachment(
      ACCOUNT,
      { signedId: SIGNED_ID, filename: "a b&c.png" },
      { maxBytes: 1024 * 1024 }
    );

    expect(calls[0].url).toContain("/a%20b%26c.png");
  });

  it("accepts an account slug with or without its leading slash", async () => {
    stubFetch(() => binaryResponse(PNG_BYTES, "image/png"));

    await client().fetchAttachment("1234567", REF, { maxBytes: 1024 * 1024 });

    expect(calls[0].url).toContain(`${BASE_URL}/1234567/rails/`);
  });
});

describe("fetchAttachment: size and body handling", () => {
  it("skips the body entirely when the caller does not want this type", async () => {
    const zip = new Uint8Array(64);
    stubFetch((_call, index) =>
      index === 0
        ? redirectTo(STORAGE_URL)
        : new Response(zip, {
            status: 200,
            headers: {
              "Content-Type": "application/zip",
              "Content-Length": "40000000",
            },
          })
    );

    const result = await client().fetchAttachment(ACCOUNT, REF, {
      maxBytes: 1024,
      shouldReadBody: (contentType) => contentType.startsWith("image/"),
    });

    // 40 MB declared, well over maxBytes, and still no error: the cap applies
    // to bytes read, and nothing wanted these.
    expect(result.contentType).toBe("application/zip");
    expect(result.bytes).toBeUndefined();
    expect(result.byteSize).toBe(40000000);
  });

  it("refuses an oversized attachment on its declared length, before reading", async () => {
    stubFetch(() =>
      new Response(PNG_BYTES, {
        status: 200,
        headers: { "Content-Type": "image/png", "Content-Length": "9999999" },
      })
    );

    await expect(
      client().fetchAttachment(ACCOUNT, REF, { maxBytes: 1024 })
    ).rejects.toBeInstanceOf(FizzyAttachmentTooLargeError);
  });

  it("still refuses when the response declares no length", async () => {
    const big = new Uint8Array(4096);
    stubFetch(
      () => new Response(big, { status: 200, headers: { "Content-Type": "image/png" } })
    );

    await expect(
      client().fetchAttachment(ACCOUNT, REF, { maxBytes: 1024 })
    ).rejects.toBeInstanceOf(FizzyAttachmentTooLargeError);
  });

  it("strips parameters from the content type", async () => {
    stubFetch(() => binaryResponse(PNG_BYTES, "IMAGE/PNG; charset=binary"));

    const result = await client().fetchAttachment(ACCOUNT, REF, { maxBytes: 4096 });

    expect(result.contentType).toBe("image/png");
  });
});

/**
 * Bodies that nobody wants must not be paid for.
 *
 * The success path is bounded by `maxBytes`, but a redirect body and a
 * non-2xx error body are read on different paths — and those are the hops most
 * likely to come from a host other than Fizzy. Both are asserted on behaviour:
 * the stream is cancelled, and only a bounded prefix is ever pulled.
 */
describe("fetchAttachment body bounding on non-success paths", () => {
  /** A stream that reports how much of it was actually consumed. */
  function countingStream(chunk: Uint8Array, repeats: number) {
    const state = { pulled: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (state.pulled >= repeats) {
          controller.close();
          return;
        }
        state.pulled += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        state.cancelled = true;
      },
    });
    return { stream, state };
  }

  it("cancels a redirect's body instead of leaving it dangling", async () => {
    const { stream, state } = countingStream(new Uint8Array(1024), 512);
    stubFetch((_call, index) => {
      if (index === 0) {
        return new Response(stream, {
          status: 302,
          headers: { Location: STORAGE_URL },
        });
      }
      return binaryResponse(PNG_BYTES);
    });

    const result = await client().fetchAttachment(ACCOUNT, REF, { maxBytes: 4096 });

    expect(result.bytes).toEqual(PNG_BYTES);
    expect(state.cancelled).toBe(true);
  });

  it("cancels the body of a redirect it refuses to follow", async () => {
    // A sign-in redirect is rejected inside the resolver rather than followed,
    // so its body is released on the throw path rather than the continue path.
    const { stream, state } = countingStream(new Uint8Array(1024), 512);
    stubFetch(
      () =>
        new Response(stream, {
          status: 302,
          headers: { Location: `${BASE_URL}/session/new` },
        })
    );

    await expect(
      client().fetchAttachment(ACCOUNT, REF, { maxBytes: 4096 })
    ).rejects.toBeInstanceOf(FizzyAuthError);

    expect(state.cancelled).toBe(true);
  });

  it("reads only a bounded prefix of an unbounded error body", async () => {
    // 8 MB available, no Content-Length: `.text()` would have buffered all of
    // it just to build the error message, past the 4 KB cap on the success path.
    const { stream, state } = countingStream(new Uint8Array(64 * 1024), 128);
    stubFetch(() => new Response(stream, { status: 500, statusText: "Server Error" }));

    await expect(
      client().fetchAttachment(ACCOUNT, REF, { maxBytes: 4096 })
    ).rejects.toThrow();

    expect(state.cancelled).toBe(true);
    // A handful of 64 KB chunks at most — not the whole 8 MB.
    expect(state.pulled).toBeLessThan(8);
  });
});
