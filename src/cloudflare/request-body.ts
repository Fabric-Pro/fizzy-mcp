/**
 * Bounded JSON-RPC body parsing for the session Durable Object.
 *
 * Kept out of `mcp-session.ts`, which imports `cloudflare:workers`, so it can be
 * unit tested under plain Node vitest without a Workers runtime.
 *
 * The body is read with the SDK's `readRequestBody`, the same reader its
 * Streamable HTTP transport uses, capped at the ceiling the Node HTTP transport
 * passes as `maxRequestBodySize`. An unbounded `request.json()` would buffer
 * whatever the platform lets through before the session could refuse it.
 */

import {
  readRequestBody,
  requestBodyTooLargeMessage,
} from "@modelcontextprotocol/sdk/server/requestBody.js";
import { MAX_REQUEST_BODY_BYTES } from "../utils/attachments.js";

export type ParsedBody =
  | { ok: true; message: unknown }
  | { ok: false; status: 400 | 413; code: number; message: string };

/**
 * Reads and parses a JSON request body, refusing one over `maxBytes` with 413
 * (on a declared `Content-Length` before reading, otherwise as soon as the
 * stream passes the limit) and invalid JSON with 400. Stream failures propagate.
 */
export async function parseJsonBody(
  request: Request,
  maxBytes: number = MAX_REQUEST_BODY_BYTES
): Promise<ParsedBody> {
  const body = await readRequestBody(request, maxBytes);
  if (body.tooLarge) {
    return { ok: false, status: 413, code: -32000, message: requestBodyTooLargeMessage(maxBytes) };
  }
  try {
    return { ok: true, message: JSON.parse(body.text) };
  } catch {
    return { ok: false, status: 400, code: -32700, message: "Parse error" };
  }
}
