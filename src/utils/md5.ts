/**
 * MD5, implemented here rather than taken from a runtime.
 *
 * Fizzy's direct-upload endpoint requires a Base64-encoded MD5 of the file as
 * its `checksum`. WebCrypto offers only SHA-family digests, so the alternative
 * would be `node:crypto` — which ties this shared code path to the
 * `nodejs_compat` flag staying enabled and to workerd implementing MD5, neither
 * of which is verifiable from the Node test suite. A self-contained
 * implementation produces identical bytes in every runtime with no branch to get
 * wrong, and its correctness is pinned by the RFC 1321 test vectors plus a
 * differential test against `node:crypto` over block-boundary lengths.
 *
 * This is an upload integrity checksum, never a security primitive.
 *
 * @see https://www.ietf.org/rfc/rfc1321.txt
 * @see tests/utils/md5.test.ts
 */

import { bytesToBase64 } from "./base64.js";

/** Per-round left-rotation amounts (RFC 1321 §3.4). */
const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/**
 * Round constants, `floor(2^32 * abs(sin(i + 1)))`, written out rather than
 * derived: ECMAScript does not require `Math.sin` to be correctly rounded, so
 * deriving them could in principle differ by one ulp between engines and flip a
 * `floor`.
 */
const K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
  0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
  0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
  0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
  0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
  0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

/** Raw 16-byte MD5 digest. */
export function md5(input: Uint8Array): Uint8Array {
  // Message + a mandatory 0x80 byte + zero padding to 56 mod 64 + an 8-byte length.
  const paddedLength = (((input.length + 8) >>> 6) + 1) << 6;
  const block = new Uint8Array(paddedLength);
  block.set(input);
  block[input.length] = 0x80;

  const view = new DataView(block.buffer);

  // Length in bits, little-endian across two 32-bit words. `Math.floor(bits /
  // 2^32)` stays exact because a byte length large enough to overflow it would
  // long since have exhausted memory.
  const bitLength = input.length * 8;
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const words = new Int32Array(16);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) {
      words[i] = view.getInt32(offset + i * 4, true);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;

      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const rotated = (f + a + K[i] + words[g]) | 0;
      const shift = SHIFTS[i];

      a = d;
      d = c;
      c = b;
      b = (b + (((rotated << shift) | (rotated >>> (32 - shift))) | 0)) | 0;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const digest = new Uint8Array(16);
  const digestView = new DataView(digest.buffer);
  digestView.setInt32(0, a0, true);
  digestView.setInt32(4, b0, true);
  digestView.setInt32(8, c0, true);
  digestView.setInt32(12, d0, true);
  return digest;
}

/**
 * MD5 digest as Base64 — the encoding Fizzy's direct-upload `checksum` expects.
 * A hex digest is rejected there with an error that does not say why.
 */
export function md5Base64(input: Uint8Array): string {
  return bytesToBase64(md5(input));
}
