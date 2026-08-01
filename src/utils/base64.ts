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

/**
 * Decode base64 to bytes, accepting the base64url alphabet and missing padding
 * as well — MCP clients produce both, and rejecting them would surface as an
 * opaque "invalid base64" for input that is perfectly recoverable.
 *
 * @throws Error when the input is not decodable as base64.
 */
export function base64ToBytes(input: string): Uint8Array {
  const normalized = input.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

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
