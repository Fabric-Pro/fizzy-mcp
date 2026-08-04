/**
 * The implementation in src/utils/md5.ts is hand-written so that the shared
 * client does not depend on `node:crypto` being present (it is not, on
 * Workers). These tests are what make that trade safe: the RFC 1321 vectors pin
 * it to the published standard, and the differential test pins it to a
 * battle-tested implementation across every length where MD5 padding bugs live.
 */

import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { md5, md5Base64 } from "../../src/utils/md5.js";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("md5", () => {
  // RFC 1321, Appendix A.5 "Test suite" — verbatim.
  const RFC_1321_VECTORS: Array<[string, string]> = [
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    [
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      "d174ab98d277d9f5a5611c2c9f419d9f",
    ],
    [
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      "57edf4a22be3c955ac49da2e2107b67a",
    ],
  ];

  it.each(RFC_1321_VECTORS)("matches the RFC 1321 vector for %j", (input, expected) => {
    expect(hex(md5(utf8(input)))).toBe(expected);
  });

  // 55/56 and 63/64/65 straddle the padding boundaries: 56 bytes is the largest
  // message whose length field still fits in its own block, so an off-by-one in
  // the padding arithmetic shows up here and almost nowhere else.
  const BOUNDARY_LENGTHS = [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000];

  it.each(BOUNDARY_LENGTHS)("agrees with node:crypto at %i bytes", (length) => {
    const bytes = new Uint8Array(randomBytes(length));
    const expected = createHash("md5").update(bytes).digest("hex");
    expect(hex(md5(bytes))).toBe(expected);
  });

  it("agrees with node:crypto on a payload larger than one megabyte", () => {
    const bytes = new Uint8Array(randomBytes(1024 * 1024 + 7));
    expect(hex(md5(bytes))).toBe(createHash("md5").update(bytes).digest("hex"));
  });

  it("handles bytes outside the ASCII range", () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0xfe, 0x01]);
    expect(hex(md5(bytes))).toBe(createHash("md5").update(bytes).digest("hex"));
  });
});

describe("md5Base64", () => {
  it("produces the Base64 encoding Fizzy's checksum field expects, not hex", () => {
    const bytes = utf8("abc");
    expect(md5Base64(bytes)).toBe(createHash("md5").update(bytes).digest("base64"));
    expect(md5Base64(bytes)).toBe("kAFQmDzST7DWlj99KOF/cg==");
    // The trap this guards: hex is accepted by the type system and rejected by
    // the API, with an error that does not explain why.
    expect(md5Base64(bytes)).not.toBe(hex(md5(bytes)));
  });

  it("agrees with node:crypto over random inputs", () => {
    for (const length of [1, 16, 64, 1024]) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(md5Base64(bytes)).toBe(createHash("md5").update(bytes).digest("base64"));
    }
  });
});
