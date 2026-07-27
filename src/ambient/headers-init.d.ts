/**
 * @types/node does not declare HeadersInit globally (it lives in undici-types),
 * but @modelcontextprotocol/sdk declaration files reference the global name.
 * Without this alias, skipLibCheck silently types it as `any`.
 * The Cloudflare build must NOT include this file: @cloudflare/workers-types
 * already declares a global HeadersInit.
 */
type HeadersInit = NonNullable<RequestInit["headers"]>;
