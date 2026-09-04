/**
 * Client authentication (`MCP_AUTH_TOKEN`)
 *
 * Shared by the Node transports (`utils/security.ts`) and the Cloudflare Worker
 * (`cloudflare/security.ts`) so both deployments name the same header and
 * report the same errors.
 *
 * `MCP_AUTH_TOKEN` is a *server-level* shared secret that decides which clients
 * may connect at all. It is not the per-user Fizzy Personal Access Token, which
 * travels on `Authorization: Bearer <fizzy-pat>` and authenticates the caller
 * against the Fizzy API.
 *
 * Those two layers only stay independent if they use different headers, so
 * client auth gets a dedicated one: `X-MCP-Auth-Token`, carrying the bare token
 * with no `Bearer ` prefix. Putting it on `Authorization` instead would make the
 * layers mutually exclusive — the Worker reads that header as the Fizzy PAT
 * (`cloudflare/index.ts`), so every client sending its own PAT would be
 * rejected as an invalid client token. The Node transports have exactly that
 * collision today; they keep accepting `Authorization: Bearer <MCP_AUTH_TOKEN>`
 * for compatibility, but the dedicated header takes precedence there and is the
 * only mode the Worker accepts.
 */

/** Header carrying the client-auth token (bare value, no `Bearer ` prefix). */
export const CLIENT_AUTH_HEADER = "X-MCP-Auth-Token";

/**
 * Lowercased spelling of {@link CLIENT_AUTH_HEADER}.
 *
 * Node's `IncomingMessage.headers` is keyed by lowercased name, unlike the
 * Fetch `Headers` object the Worker uses, which is case-insensitive.
 */
export const CLIENT_AUTH_HEADER_LOWER = "x-mcp-auth-token";

/** No client token was presented while `MCP_AUTH_TOKEN` is configured. */
export const CLIENT_AUTH_REQUIRED_ERROR = "Client authentication required";

/**
 * A client token was presented in a shape this server cannot read.
 *
 * Only reachable through the Node transports' legacy `Authorization` fallback —
 * the dedicated header carries a bare value, so there is no format to get wrong.
 */
export const CLIENT_AUTH_FORMAT_ERROR =
  "Invalid client authentication format. Expected: Bearer <token>";

/** A client token was presented but does not match `MCP_AUTH_TOKEN`. */
export const CLIENT_AUTH_INVALID_ERROR = "Invalid client authentication token";

/**
 * Compare two strings without short-circuiting on the first differing byte.
 *
 * `TextEncoder` is a global in both Node 18+ and Workers, so this works in both
 * deployments — unlike `crypto.timingSafeEqual` (Node only) or
 * `crypto.subtle.timingSafeEqual` (Workers only), which is why neither is used.
 *
 * Two honest caveats. This is best-effort, not a constant-time guarantee: a JIT
 * is free to reorder or vectorise the loop, and JS gives no way to pin that
 * down. And length is not hidden — a mismatch returns before the loop, so the
 * length of the configured token is still observable. It is nonetheless
 * strictly better than `!==`, which leaks the matching prefix length and so
 * lets an attacker recover the token byte by byte.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  if (aBytes.length !== bBytes.length) {
    return false;
  }

  // Accumulate every difference before deciding, so the loop always runs the
  // full length of the input rather than stopping at the first mismatch.
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i]! ^ bBytes[i]!;
  }

  return diff === 0;
}
