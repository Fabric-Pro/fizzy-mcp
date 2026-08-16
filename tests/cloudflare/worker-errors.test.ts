/**
 * Worker Error Envelope Tests
 *
 * `buildWorkerErrorEnvelope` builds the response body for the top-level
 * Worker `fetch` handler's error boundary — see `src/cloudflare/index.ts`.
 * It's kept in its own file, importing nothing from `cloudflare:workers`, so
 * it can be exercised here under plain Node vitest.
 */

import { describe, it, expect } from "vitest";
import { buildWorkerErrorEnvelope, getErrorMessage } from "../../src/cloudflare/utils/worker-errors.js";

describe("buildWorkerErrorEnvelope", () => {
  it("returns a JSON-RPC -32603 envelope with id: null for /mcp", () => {
    const { status, body } = buildWorkerErrorEnvelope("/mcp", new Error("Durable Object exceeded memory budget"));

    expect(status).toBe(500);
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32603,
        message: "Durable Object exceeded memory budget",
      },
    });
  });

  it("returns the plain { error } shape for a non-/mcp path", () => {
    const { status, body } = buildWorkerErrorEnvelope("/health", new Error("boom"));

    expect(status).toBe(500);
    expect(body).toEqual({ error: "boom" });
  });

  it("returns the plain { error } shape for an empty/unparsed path", () => {
    const { status, body } = buildWorkerErrorEnvelope("", new Error("URL parse failed"));

    expect(status).toBe(500);
    expect(body).toEqual({ error: "URL parse failed" });
  });

  it("stringifies a non-Error thrown value without throwing", () => {
    expect(() => buildWorkerErrorEnvelope("/mcp", "just a string")).not.toThrow();
    const { body } = buildWorkerErrorEnvelope("/mcp", "just a string");
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: "just a string" },
    });
  });

  it("stringifies a thrown value with a poisoned toString() without throwing", () => {
    const poisoned = {
      toString() {
        throw new Error("cannot stringify");
      },
    };

    expect(() => buildWorkerErrorEnvelope("/mcp", poisoned)).not.toThrow();
    const { body } = buildWorkerErrorEnvelope("/mcp", poisoned);
    expect((body as { error: { message: string } }).error.message).toBe("Unknown error");
  });

  it("handles a real Error instance with a poisoned message getter without throwing", () => {
    // Regression case: the `instanceof Error` branch reads `error.message`,
    // which is not covered by a `String()` try/catch alone — this must be
    // guarded independently of the non-Error poisoned-toString() case above.
    const poisonedError = new Error("original message");
    Object.defineProperty(poisonedError, "message", {
      get() {
        throw new Error("poisoned message getter");
      },
    });

    expect(() => buildWorkerErrorEnvelope("/mcp", poisonedError)).not.toThrow();
    const { body } = buildWorkerErrorEnvelope("/mcp", poisonedError);
    expect((body as { error: { message: string } }).error.message).toBe("Unknown error");
  });

  it("stringifies a plain object thrown value", () => {
    const { body } = buildWorkerErrorEnvelope("/other", { reason: "config missing" });
    expect(body).toEqual({ error: "[object Object]" });
  });

  it("coerces a non-string Error.message (BigInt) so the body survives JSON.stringify", () => {
    // JS doesn't enforce that Error.message is a string. A hostile instance
    // handing back a BigInt would make `JSON.stringify(body)` throw at the
    // call site (index.ts's catch block) if it weren't coerced here first.
    const weirdError = new Error("will be overridden");
    Object.defineProperty(weirdError, "message", {
      get() {
        return 123n;
      },
    });

    expect(() => buildWorkerErrorEnvelope("/mcp", weirdError)).not.toThrow();
    const { body } = buildWorkerErrorEnvelope("/mcp", weirdError);
    const message = (body as { error: { message: string } }).error.message;
    expect(typeof message).toBe("string");
    expect(message).toBe("123");
    expect(() => JSON.stringify(body)).not.toThrow();
  });

  it("coerces a non-string Error.message (cyclic object) so the body survives JSON.stringify", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    const weirdError = new Error("will be overridden");
    Object.defineProperty(weirdError, "message", {
      get() {
        return cyclic;
      },
    });

    expect(() => buildWorkerErrorEnvelope("/mcp", weirdError)).not.toThrow();
    const { body } = buildWorkerErrorEnvelope("/mcp", weirdError);
    const message = (body as { error: { message: string } }).error.message;
    expect(typeof message).toBe("string");
    expect(() => JSON.stringify(body)).not.toThrow();
  });
});

describe("getErrorMessage", () => {
  it("returns the message of an Error instance", () => {
    expect(getErrorMessage(new TypeError("nope"))).toBe("nope");
  });

  it("never throws, even for values that can't be stringified", () => {
    const poisoned = {
      toString() {
        throw new Error("cannot stringify");
      },
    };
    expect(() => getErrorMessage(poisoned)).not.toThrow();
    expect(getErrorMessage(poisoned)).toBe("Unknown error");
  });

  it("never throws for a real Error with a poisoned message getter", () => {
    const poisonedError = new Error("original message");
    Object.defineProperty(poisonedError, "message", {
      get() {
        throw new Error("poisoned message getter");
      },
    });

    expect(() => getErrorMessage(poisonedError)).not.toThrow();
    expect(getErrorMessage(poisonedError)).toBe("Unknown error");
  });

  it("always returns a real string, even when Error.message is a non-string value", () => {
    const bigintError = new Error("will be overridden");
    Object.defineProperty(bigintError, "message", { get: () => 123n });
    expect(typeof getErrorMessage(bigintError)).toBe("string");
    expect(getErrorMessage(bigintError)).toBe("123");

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const cyclicError = new Error("will be overridden");
    Object.defineProperty(cyclicError, "message", { get: () => cyclic });
    expect(typeof getErrorMessage(cyclicError)).toBe("string");
  });
});
