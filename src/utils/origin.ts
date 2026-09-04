/**
 * Origin allowlist matching
 *
 * Shared by the Node transports (`utils/security.ts`) and the Cloudflare Worker
 * (`cloudflare/index.ts`) so both enforce the same rule. A matched origin is
 * reflected into `Access-Control-Allow-Origin` alongside
 * `Access-Control-Allow-Credentials: true`, so anything this function allows
 * gets a credentialed CORS grant.
 *
 * Rules, in order:
 * 1. `"*"` anywhere in the allowlist allows every origin.
 * 2. An entry that equals the Origin header, or that parses to the same origin
 *    (scheme, host and port), is allowed.
 * 3. A loopback entry written without a port (`http://localhost`) allows any
 *    port on that same scheme and hostname. An entry that pins a port
 *    (`http://localhost:3000`) allows only that port.
 *
 * Rule 3 used to be much broader: a single localhost entry matched every
 * localhost variant on every port and scheme, so allowing
 * `http://localhost:3000` also granted `https://127.0.0.1:9999`. On a server
 * that binds to loopback by default, other local processes are a realistic
 * origin of attack, so the grant is now limited to what was configured.
 */

/** Hostnames eligible for the portless wildcard in rule 3. */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

function parseOrigin(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Whether an allowlist entry pins a specific port.
 *
 * Both answers come from the URL parser, never from reading the raw string:
 * `URL` accepts non-canonical spellings such as `https:/localhost:3000`, and a
 * hand-rolled scan of those would see no port while the matcher below sees one,
 * turning a pinned entry back into an any-port grant.
 *
 * The parser alone is not enough either, because it erases a scheme's default
 * port — `new URL("http://localhost:80").port` is `""`. A default port is
 * recovered by re-parsing the entry under a scheme that has no default.
 */
function hasExplicitPort(entry: string, parsed: URL): boolean {
  if (parsed.port !== "") {
    return true;
  }

  // Feed the probe what the parser itself saw, or the two disagree and a pinned
  // entry is misread as portless: `URL` deletes tabs and line breaks anywhere in
  // the input, and treats backslashes as slashes for special schemes (it reads
  // `http:\\localhost:80` as `http://localhost`), while the probe scheme does
  // neither.
  const canonical = entry
    .trim()
    .replace(/[\t\n\r]/g, "")
    .replace(/\\/g, "/")
    .replace(/^[^:]+:\/*/, "probe://");

  const probe = parseOrigin(canonical);
  return probe !== null && probe.port !== "";
}

/**
 * Check whether an Origin header value is covered by the configured allowlist.
 */
export function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  // Wildcard allows all
  if (allowedOrigins.includes("*")) {
    return true;
  }

  // Exact match
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  const originUrl = parseOrigin(origin);
  if (!originUrl) {
    return false;
  }

  const originIsLoopback = LOOPBACK_HOSTNAMES.has(originUrl.hostname);

  return allowedOrigins.some(allowed => {
    const allowedUrl = parseOrigin(allowed);
    if (!allowedUrl) {
      return false;
    }

    // Same origin once both sides are normalised (case, trailing slash, default
    // port). Opaque origins serialise to the string "null", which would make
    // every non-special scheme match every other, so they only ever match
    // verbatim above.
    if (originUrl.origin !== "null" && originUrl.origin === allowedUrl.origin) {
      return true;
    }

    // Portless loopback entry: any port, but the same scheme and hostname.
    return (
      originIsLoopback &&
      !hasExplicitPort(allowed, allowedUrl) &&
      allowedUrl.protocol === originUrl.protocol &&
      allowedUrl.hostname === originUrl.hostname
    );
  });
}
