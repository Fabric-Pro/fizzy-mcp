import { describe, it, expect, vi } from "vitest";
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

  describe("maxBytes", () => {
    // The guard exists to stop a remote caller forcing a large allocation, so it
    // has to reject BEFORE decoding — asserting the size alone would still pass
    // if the check were moved after atob().
    it("rejects before decoding, not after", () => {
      const oversized = "A".repeat(4000); // decodes to 3000 bytes
      const atobSpy = vi.spyOn(globalThis, "atob");

      expect(() => base64ToBytes(oversized, 1000)).toThrow(/over the 1000-byte upload limit/);
      expect(atobSpy).not.toHaveBeenCalled();

      atobSpy.mockRestore();
    });

    it("reports the decoded size it computed", () => {
      expect(() => base64ToBytes("A".repeat(4000), 1000)).toThrow(/decodes to 3000 bytes/);
    });

    it("accepts input exactly at the limit", () => {
      const bytes = new Uint8Array(randomBytes(999));
      const encoded = bytesToBase64(bytes);

      expect(base64ToBytes(encoded, 999).length).toBe(999);
    });

    it("does not count padding or whitespace toward the limit", () => {
      // 2 bytes encodes as "aGk=" — the '=' and any wrapping must not push it over.
      const encoded = Buffer.from("hi", "utf8").toString("base64");
      expect(base64ToBytes(encoded.slice(0, 2) + "\n " + encoded.slice(2), 2).length).toBe(2);
    });

    it("is unbounded when no limit is given", () => {
      expect(base64ToBytes("A".repeat(4000)).length).toBe(3000);
    });
  });
});
