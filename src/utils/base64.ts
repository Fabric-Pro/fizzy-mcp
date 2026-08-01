/**
 * Base64 helpers that behave identically on Node and Cloudflare Workers.
 *
 * `btoa`/`atob` are the only encoders both runtimes ship natively — `Buffer`
 * exists on Workers solely behind the `nodejs_compat` flag, and this module is
 * reached from the shared client, so it must not depend on that flag staying on.
 */

/** Chunked to keep large inputs off the argument stack of `String.fromCharCode`. */
const CHUNK_SIZE = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

/** base64url characters mapped to their standard equivalents; whitespace drops. */
const BASE64URL_REPLACEMENTS: Record<string, string> = { "-": "+", _: "/" };

/** Stateless (no /g), so `.test` does not carry lastIndex between calls. */
const WHITESPACE = /\s/;

/** Bytes a normalized, unpadded base64 string decodes to: 4 characters carry 3. */
function decodedLength(unpaddedBase64: string): number {
  return Math.floor((unpaddedBase64.length * 3) / 4);
}

/**
 * How many characters actually encode data, counted without building a copy of
 * the input: whitespace is dropped by normalization, `=` is padding, and the
 * base64url swaps are one-for-one. Excluding `=` matters — counting it would
 * overestimate by up to two bytes and reject a payload sitting exactly on the
 * limit.
 */
function significantLength(input: string): number {
  let count = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char !== "=" && !WHITESPACE.test(char)) count++;
  }
  return count;
}

/**
 * Decode base64 to bytes, accepting the base64url alphabet and missing padding
 * as well — MCP clients produce both, and rejecting them would surface as an
 * opaque "invalid base64" for input that is perfectly recoverable.
 *
 * `maxBytes` bounds the work this function does, not merely its result. Every
 * step here allocates something proportional to the input — normalization copies
 * the string, `atob` materializes the output, and the loop below materializes it
 * again as bytes — so the limit is enforced ahead of all of them. Sizes come from
 * character counts, which are exact for base64 and need no allocation.
 *
 * @throws Error when the input is not decodable, or would exceed `maxBytes`.
 */
export function base64ToBytes(input: string, maxBytes?: number): Uint8Array {
  // Reject before normalizing, not just before decoding: normalization copies the
  // whole input, so a check placed after it would still let a caller force an
  // allocation the size of their payload. The length comparison clears every
  // input that cannot possibly be over the limit, so only suspiciously long ones
  // pay for the counting scan, which allocates nothing.
  if (maxBytes !== undefined && input.length > Math.ceil(maxBytes / 3) * 4) {
    const decoded = Math.floor((significantLength(input) * 3) / 4);
    if (decoded > maxBytes) {
      throw new Error(
        `base64_data decodes to ${decoded} bytes, over the ${maxBytes}-byte upload limit`
      );
    }
  }

  // One pass: each additional pass copies the whole string, which is precisely
  // the allocation this function is trying not to make on hostile input.
  const normalized = input.replace(
    /\s+|[-_]/g,
    (match) => BASE64URL_REPLACEMENTS[match] ?? ""
  );
  const unpadded = normalized.replace(/=+$/, "");

  if (maxBytes !== undefined && decodedLength(unpadded) > maxBytes) {
    throw new Error(
      `base64_data decodes to ${decodedLength(unpadded)} bytes, over the ${maxBytes}-byte upload limit`
    );
  }

  const padded = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, "=");

  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("base64_data is not valid base64");
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
