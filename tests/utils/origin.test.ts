import { describe, it, expect } from "vitest";
import { isOriginAllowed } from "../../src/utils/origin.js";

describe("isOriginAllowed", () => {
  describe("wildcard", () => {
    it("allows any origin", () => {
      expect(isOriginAllowed("https://evil.com", ["*"])).toBe(true);
      expect(isOriginAllowed("http://localhost:9999", ["*"])).toBe(true);
    });

    it("allows any origin when combined with specific entries", () => {
      expect(isOriginAllowed("https://evil.com", ["https://myapp.com", "*"])).toBe(true);
    });
  });

  describe("exact entries", () => {
    it("allows an origin that matches an entry verbatim", () => {
      expect(isOriginAllowed("https://myapp.com", ["https://myapp.com"])).toBe(true);
    });

    it("allows an origin that matches an entry after normalisation", () => {
      // Trailing slash, casing and a default port are all formatting noise.
      expect(isOriginAllowed("https://myapp.com", ["https://myapp.com/"])).toBe(true);
      expect(isOriginAllowed("https://myapp.com", ["https://MyApp.com"])).toBe(true);
      expect(isOriginAllowed("https://myapp.com", ["https://myapp.com:443"])).toBe(true);
    });

    it("rejects an origin that is not in the allowlist", () => {
      expect(isOriginAllowed("https://evil.com", ["https://myapp.com"])).toBe(false);
    });

    it("rejects a different port on a non-loopback host", () => {
      expect(isOriginAllowed("https://myapp.com:8443", ["https://myapp.com"])).toBe(false);
    });

    it("rejects a subdomain of an allowed host", () => {
      expect(isOriginAllowed("https://evil.myapp.com", ["https://myapp.com"])).toBe(false);
    });
  });

  describe("portless loopback entries", () => {
    it("allows any port on the configured scheme and hostname", () => {
      expect(isOriginAllowed("http://localhost:8080", ["http://localhost"])).toBe(true);
      expect(isOriginAllowed("http://127.0.0.1:8080", ["http://127.0.0.1"])).toBe(true);
    });

    it("does not cross to another loopback hostname", () => {
      expect(isOriginAllowed("http://127.0.0.1:8080", ["http://localhost"])).toBe(false);
      expect(isOriginAllowed("http://localhost:8080", ["http://127.0.0.1"])).toBe(false);
    });

    it("does not cross to another scheme", () => {
      expect(isOriginAllowed("https://localhost:8080", ["http://localhost"])).toBe(false);
    });
  });

  describe("loopback entries that pin a port", () => {
    it("allows only that port", () => {
      expect(isOriginAllowed("http://localhost:3000", ["http://localhost:3000"])).toBe(true);
      expect(isOriginAllowed("http://localhost:9999", ["http://localhost:3000"])).toBe(false);
    });

    it("does not grant other loopback variants", () => {
      const allowlist = ["http://localhost:3000"];
      expect(isOriginAllowed("https://127.0.0.1:9999", allowlist)).toBe(false);
      expect(isOriginAllowed("http://127.0.0.1:3000", allowlist)).toBe(false);
      expect(isOriginAllowed("https://localhost:3000", allowlist)).toBe(false);
    });

    it("treats a default port as pinned rather than as a wildcard", () => {
      // URL erases :80, so this only works if the raw entry is inspected.
      expect(isOriginAllowed("http://localhost:9999", ["http://localhost:80"])).toBe(false);
      expect(isOriginAllowed("http://localhost", ["http://localhost:80"])).toBe(true);
    });

    it("reads the port out of non-canonical entries the URL parser still accepts", () => {
      // `new URL("https:/localhost:3000")` yields port 3000, so the entry is
      // pinned even though it is written with one slash instead of two.
      expect(isOriginAllowed("https://localhost:9999", ["https:/localhost:3000"])).toBe(false);
      expect(isOriginAllowed("https://localhost:9999", ["https:///localhost:3000"])).toBe(false);
      expect(isOriginAllowed("https://localhost:3000", ["https:/localhost:3000"])).toBe(true);
    });

    it("reads a default port written with backslashes", () => {
      // `URL` treats backslashes as slashes for special schemes, so
      // "http:\\localhost:80" is the host localhost on its default port.
      expect(isOriginAllowed("http://localhost:9999", ["http:\\\\localhost:80"])).toBe(false);
      expect(isOriginAllowed("https://localhost:9999", ["https:\\\\localhost:443"])).toBe(false);
      expect(isOriginAllowed("http://localhost", ["http:\\\\localhost:80"])).toBe(true);
    });

    it("reads a default port written with tabs or line breaks in the entry", () => {
      // `URL` deletes these characters before parsing, so the entry is the host
      // localhost on its default port however oddly it is spelled.
      expect(isOriginAllowed("http://localhost:9999", ["http:\t//localhost:80"])).toBe(false);
      expect(isOriginAllowed("http://localhost:9999", ["http:/\n/localhost:80"])).toBe(false);
    });

    it("does not read a password ending in digits as a port", () => {
      // The ":80" here is userinfo, so no port is pinned and the entry stays a
      // portless wildcard.
      expect(isOriginAllowed("http://localhost:9999", ["http://user:80@localhost"])).toBe(true);
    });

    it("treats a non-canonical portless entry as a wildcard, as written", () => {
      expect(isOriginAllowed("http://localhost:9999", ["http:/localhost"])).toBe(true);
    });

    it("still honours a portless entry listed alongside a pinned one", () => {
      expect(isOriginAllowed("http://localhost:9999", ["http://localhost:3000", "http://localhost"]))
        .toBe(true);
    });
  });

  describe("malformed and opaque origins", () => {
    it("rejects an unparseable origin", () => {
      expect(isOriginAllowed("not a url", ["http://localhost"])).toBe(false);
      expect(isOriginAllowed("null", ["http://localhost"])).toBe(false);
    });

    it("ignores unparseable allowlist entries", () => {
      expect(isOriginAllowed("http://localhost:8080", ["", "not a url", "http://localhost"]))
        .toBe(true);
      expect(isOriginAllowed("http://localhost:8080", ["not a url"])).toBe(false);
    });

    it("does not let opaque origins match each other", () => {
      // Both serialise to the origin "null"; only a verbatim entry should match.
      expect(isOriginAllowed("chrome-extension://abc", ["chrome-extension://xyz"])).toBe(false);
      expect(isOriginAllowed("chrome-extension://abc", ["chrome-extension://abc"])).toBe(true);
    });

    it("does not read IPv6 colons as a port", () => {
      expect(isOriginAllowed("http://[::1]:3000", ["http://[::1]:3000"])).toBe(true);
      expect(isOriginAllowed("http://[::1]:9999", ["http://[::1]:3000"])).toBe(false);
    });

    it("rejects everything when the allowlist is empty", () => {
      expect(isOriginAllowed("http://localhost:3000", [])).toBe(false);
    });
  });
});
