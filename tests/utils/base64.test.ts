import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { base64ToBytes, bytesToBase64 } from "../../src/utils/base64.js";

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("bytesToBase64", () => {
  it("matches Buffer's encoding", () => {
    for (const length of [0, 1, 2, 3, 255, 4096]) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    }
  });

  it("encodes inputs larger than the chunking threshold", () => {
    // The chunk size is 0x8000; anything above it exercises the loop that keeps
    // String.fromCharCode off a 100k-argument spread.
    const bytes = new Uint8Array(randomBytes(0x8000 * 2 + 13));
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});

describe("base64ToBytes", () => {
  it("round-trips arbitrary bytes", () => {
    for (const length of [1, 2, 3, 17, 1024]) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it("accepts the base64url alphabet", () => {
    const bytes = new Uint8Array([0xfb, 0xef, 0xfe]);
    const standard = Buffer.from(bytes).toString("base64"); // "++/+"
    const urlSafe = standard.replace(/\+/g, "-").replace(/\//g, "_");

    expect(Array.from(base64ToBytes(urlSafe))).toEqual(Array.from(bytes));
  });

  it("accepts unpadded input", () => {
    const padded = Buffer.from(utf8("hi")).toString("base64"); // "aGk="
    expect(Array.from(base64ToBytes(padded.replace(/=+$/, "")))).toEqual([104, 105]);
  });

  it("ignores whitespace, which MCP clients introduce when wrapping long values", () => {
    const encoded = Buffer.from(utf8("hello world")).toString("base64");
    const wrapped = encoded.slice(0, 4) + "\n  " + encoded.slice(4);
    expect(new TextDecoder().decode(base64ToBytes(wrapped))).toBe("hello world");
  });

  it("rejects input that is not base64 with a message naming the argument", () => {
    expect(() => base64ToBytes("not valid base64!!")).toThrow(/base64_data is not valid base64/);
  });
});
