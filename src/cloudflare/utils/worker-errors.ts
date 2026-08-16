/**
 * Top-level Worker error envelope construction.
 *
 * Deliberately kept out of `index.ts` (and out of `cloudflare/utils/index.ts`,
 * which re-exports `RateLimiterDO` and therefore transitively imports
 * `cloudflare:workers`). This file imports nothing Workers-specific, so it can
 * be unit tested under plain Node vitest without a Workers runtime.
 *
 * When an exception escapes the top-level `fetch` handler uncaught, Cloudflare
 * renders an opaque error 1101 ("Worker threw exception") with a response body
 * that claims `"retryable": false` — which is misleading for the failure mode
 * this was written for (a Durable Object killed for exceeding its memory/CPU
 * budget rejects `doStub.fetch()`, and that rejection *is* transient/retryable).
 * Converting it into a diagnosable JSON-RPC error here means clients get a
 * real, retryable error instead of a generic platform failure page.
 */

/** JSON-RPC 2.0 error envelope, per https://www.jsonrpc.org/specification#error_object */
export interface JsonRpcErrorBody {
  jsonrpc: "2.0";
  id: null;
  error: { code: number; message: string };
}

/** Plain `{ error }` shape used by `errorResponse()` elsewhere in this module. */
export interface PlainErrorBody {
  error: string;
}

export interface WorkerErrorEnvelope {
  status: number;
  body: JsonRpcErrorBody | PlainErrorBody;
}

/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * Never throws, and always returns an actual `string` (not just a value
 * typed as one): reading `.message` off an `Error`, and the `String()`
 * fallback for everything else, are both inside the same try/catch — either
 * can throw on a hostile value, such as an `Error` with a poisoned `message`
 * getter, or a plain object with a poisoned `toString()`. JS also doesn't
 * enforce that `Error.message` itself is a string, so a hostile instance
 * could hand back a BigInt or a cyclic object without ever throwing; the
 * `typeof` check below catches that case too and coerces it with `String()`
 * — otherwise a non-string "message" would sail through here only to make
 * `JSON.stringify` throw later, at the call site building the response body.
 * Any failure along the way falls back to a fixed message rather than
 * propagating a second exception out of an error handler.
 */
export function getErrorMessage(error: unknown): string {
  try {
    const value = error instanceof Error ? error.message : error;
    return typeof value === "string" ? value : String(value);
  } catch {
    return "Unknown error";
  }
}

/**
 * Build the status code and JSON body for an error that escaped the
 * top-level Worker `fetch` handler.
 *
 * `/mcp` requests get a JSON-RPC 2.0 error envelope (`code: -32603`, Internal
 * error, matching the convention in `mcp-session.ts`'s `jsonError`) with
 * `id: null` since the original JSON-RPC request id may never have been
 * parsed. Every other path gets the same plain `{ error }` shape used by this
 * module's `errorResponse()` helper. Both cases use HTTP 500.
 */
export function buildWorkerErrorEnvelope(path: string, error: unknown): WorkerErrorEnvelope {
  const message = getErrorMessage(error);

  if (path === "/mcp") {
    return {
      status: 500,
      body: {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message },
      },
    };
  }

  return {
    status: 500,
    body: { error: message },
  };
}
