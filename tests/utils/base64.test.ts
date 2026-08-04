import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { base64ToBytes, bytesToBase64, maxEncodedLength } from "../../src/utils/base64.js";

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

      try {
        expect(() => base64ToBytes(oversized, 1000)).toThrow(/over the 1000-byte upload limit/);
        expect(atobSpy).not.toHaveBeenCalled();
      } finally {
        // In a finally so a failing assertion above cannot leave the global spied.
        atobSpy.mockRestore();
      }
    });

    // The guard has to bound its own cost, not just the decode: normalization
    // copies the whole input, so an over-limit payload must be refused before it.
    it("rejects an oversized payload without normalizing it first", () => {
      const replaceSpy = vi.spyOn(String.prototype, "replace");

      try {
        expect(() => base64ToBytes("A".repeat(4000), 1000)).toThrow(/upload limit/);
        expect(replaceSpy).not.toHaveBeenCalled();
      } finally {
        replaceSpy.mockRestore();
      }
    });

    // Realistic wrapping — a client folding long values at a fixed column — must
    // still fit comfortably inside the raw cap and decode successfully.
    it("decodes realistic line-wrapped base64 within the raw cap", () => {
      const bytes = new Uint8Array(randomBytes(900));
      const encoded = bytesToBase64(bytes);
      const wrapped = (encoded.match(/.{1,64}/g) ?? []).join("\r\n");

      expect(Array.from(base64ToBytes(wrapped, 1000))).toEqual(Array.from(bytes));
    });

    // Whitespace collapses away, so a payload that is mostly blank decodes to
    // something tiny — but the raw cap bounds the function's own cost before
    // that collapse happens, so an input built to be far larger than any
    // legitimate wrapping must still be rejected, without normalizing it first.
    it("rejects a payload padded with far more whitespace than real wrapping ever needs, without normalizing it first", () => {
      const padded = " ".repeat(100000) + Buffer.from("hi", "utf8").toString("base64");
      const replaceSpy = vi.spyOn(String.prototype, "replace");

      try {
        expect(() => base64ToBytes(padded, 1000)).toThrow(/upload limit/);
        expect(replaceSpy).not.toHaveBeenCalled();
      } finally {
        replaceSpy.mockRestore();
      }
    });

    // '=' is padding, not data, and is skipped by the significant-length count —
    // but the raw cap still has to catch a flood of it before any scan runs.
    it("rejects a flood of padding characters on raw length alone", () => {
      const flooded = "A".repeat(4) + "=".repeat(100000);
      const replaceSpy = vi.spyOn(String.prototype, "replace");

      try {
        expect(() => base64ToBytes(flooded, 1000)).toThrow(/upload limit/);
        expect(replaceSpy).not.toHaveBeenCalled();
      } finally {
        replaceSpy.mockRestore();
      }
    });

    it("accepts a padded payload sitting exactly on the limit", () => {
      // 2 bytes encodes as "aGk=" — counting the '=' would overestimate by one
      // byte and reject this, so padding must be excluded from the estimate.
      for (const size of [998, 999, 1000]) {
        const bytes = new Uint8Array(randomBytes(size));
        expect(base64ToBytes(bytesToBase64(bytes), 1000).length).toBe(size);
      }
    });

    it("reports the decoded size it computed", () => {
      // Chosen to sit inside the raw cap (so the earlier length-only check does
      // not fire first) while still decoding over the limit, so the precise,
      // scan-computed size is what ends up in the error.
      expect(() => base64ToBytes("A".repeat(1400), 1000)).toThrow(/decodes to 1050 bytes/);
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

describe("maxEncodedLength", () => {
  it("computes the raw-length cap as data chars plus padding and wrapping allowance", () => {
    // maxBytes=1000 -> dataChars = ceil(1000/3)*4 = 1336; allowance = ceil(1336/16)+64 = 148.
    expect(maxEncodedLength(1000)).toBe(1484);
  });

  it("grows with maxBytes", () => {
    expect(maxEncodedLength(2000)).toBeGreaterThan(maxEncodedLength(1000));
  });
});
