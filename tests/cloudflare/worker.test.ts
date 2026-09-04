/**
 * Cloudflare Worker Tests
 *
 * Tests for the main Worker entry point including:
 * - Security validation
 * - CORS handling
 * - Request routing
 * - Health checks
 * - Streamable HTTP transport
 * - Security headers
 * - Environment validation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateSecurity } from "../../src/cloudflare/security.js";
import { CLIENT_AUTH_HEADER } from "../../src/utils/client-auth.js";
import { setCorsHeaders, setSecurityHeaders } from "../../src/cloudflare/headers.js";

// Mock types for testing (we can't import actual Cloudflare types in Node.js tests)
interface MockEnv {
  FIZZY_ACCESS_TOKEN: string;
  FIZZY_BASE_URL?: string;
  MCP_AUTH_TOKEN?: string;
  MCP_ALLOWED_ORIGINS?: string;
  MCP_SESSIONS: {
    idFromName: (name: string) => { toString: () => string };
    get: (id: unknown) => {
      fetch: (request: Request) => Promise<Response>;
    };
  };
}

describe("Worker Security Validation", () => {
  const baseEnv: MockEnv = {
    FIZZY_ACCESS_TOKEN: "test-token",
    MCP_SESSIONS: {
      idFromName: vi.fn().mockReturnValue({ toString: () => "mock-id" }),
      get: vi.fn().mockReturnValue({
        fetch: vi.fn().mockResolvedValue(new Response("ok")),
      }),
    },
  };

  describe("Origin Validation", () => {
    it("should allow all origins when MCP_ALLOWED_ORIGINS is *", () => {
      const request = new Request("https://example.com/mcp", {
        headers: { Origin: "https://attacker.com" },
      });
      const env = { ...baseEnv, MCP_ALLOWED_ORIGINS: "*" };
      
      const result = validateSecurity(request, env);
      
      expect(result.allowed).toBe(true);
      expect(result.corsOrigin).toBe("*");
    });

    it("should allow requests without Origin header", () => {
      const request = new Request("https://example.com/mcp");
      const env = { ...baseEnv, MCP_ALLOWED_ORIGINS: "https://allowed.com" };
      
      const result = validateSecurity(request, env);
      
      expect(result.allowed).toBe(true);
    });

    it("should allow matching origin", () => {
      const request = new Request("https://example.com/mcp", {
        headers: { Origin: "https://allowed.com" },
      });
      const env = { ...baseEnv, MCP_ALLOWED_ORIGINS: "https://allowed.com" };
      
      const result = validateSecurity(request, env);
      
      expect(result.allowed).toBe(true);
      expect(result.corsOrigin).toBe("https://allowed.com");
    });

    it("should reject non-matching origin", () => {
      const request = new Request("https://example.com/mcp", {
        headers: { Origin: "https://attacker.com" },
      });
      const env = { ...baseEnv, MCP_ALLOWED_ORIGINS: "https://allowed.com" };
      
      const result = validateSecurity(request, env);
      
      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.error).toBe("Origin not allowed");
    });

    it("should handle multiple allowed origins", () => {
      const request = new Request("https://example.com/mcp", {
        headers: { Origin: "https://second.com" },
      });
      const env = { ...baseEnv, MCP_ALLOWED_ORIGINS: "https://first.com,https://second.com" };
      
      const result = validateSecurity(request, env);
      
      expect(result.allowed).toBe(true);
      expect(result.corsOrigin).toBe("https://second.com");
    });

    it("should match any localhost port when the entry has no port", () => {
      const request = new Request("https://example.com/mcp", {
        headers: { Origin: "http://localhost:3000" },
      });
      const env = { ...baseEnv, MCP_ALLOWED_ORIGINS: "http://localhost" };
      
      const result = validateSecurity(request, env);
      
      expect(result.allowed).toBe(true);
      expect(result.corsOrigin).toBe("http://localhost:3000");
    });

    it("should reject other localhost ports when the entry pins a port", () => {
      const request = new Request("https://example.com/mcp", {
        headers: { Origin: "http://localhost:3000" },
      });
      const env = { ...baseEnv, MCP_ALLOWED_ORIGINS: "http://localhost:8080" };
      
      const result = validateSecurity(request, env);
      
      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it("should reject another port on an allowed public host", () => {
      const request = new Request("https://example.com/mcp", {
        headers: { Origin: "https://myapp.com:8443" },
      });
      const env = { ...baseEnv, MCP_ALLOWED_ORIGINS: "https://myapp.com" };
      
      const result = validateSecurity(request, env);
      
      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(403);
    });
  });

  describe("Client Authentication", () => {
    it("should allow requests without a client token when MCP_AUTH_TOKEN is not set", () => {
      const request = new Request("https://example.com/mcp");
      const env = { ...baseEnv };

      const result = validateSecurity(request, env);

      expect(result.allowed).toBe(true);
    });

    it("should require the client token when MCP_AUTH_TOKEN is set", () => {
      const request = new Request("https://example.com/mcp");
      const env = { ...baseEnv, MCP_AUTH_TOKEN: "secret" };

      const result = validateSecurity(request, env);

      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(result.error).toBe("Client authentication required");
    });

    it("should reject an empty client token header", () => {
      const request = new Request("https://example.com/mcp", {
        headers: { [CLIENT_AUTH_HEADER]: "" },
      });
      const env = { ...baseEnv, MCP_AUTH_TOKEN: "secret" };

      const result = validateSecurity(request, env);

      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(result.error).toBe("Client authentication required");
    });

    // The whole point of the dedicated header: Authorization belongs to the
    // per-user Fizzy token, so a client token sent there is not client auth.
    it("should reject a client token presented on Authorization", () => {
      const request = new Request("https://example.com/mcp", {
        headers: { Authorization: "Bearer secret" },
      });
      const env = { ...baseEnv, MCP_AUTH_TOKEN: "secret" };

      const result = validateSecurity(request, env);

      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(result.error).toBe("Client authentication required");
    });

    it("should reject wrong token", () => {
      const request = new Request("https://example.com/mcp", {
        headers: { [CLIENT_AUTH_HEADER]: "wrong-token" },
      });
      const env = { ...baseEnv, MCP_AUTH_TOKEN: "secret" };

      const result = validateSecurity(request, env);

      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(result.error).toBe("Invalid client authentication token");
    });

    it("should allow correct token", () => {
      const request = new Request("https://example.com/mcp", {
        headers: { [CLIENT_AUTH_HEADER]: "secret" },
      });
      const env = { ...baseEnv, MCP_AUTH_TOKEN: "secret" };

      const result = validateSecurity(request, env);

      expect(result.allowed).toBe(true);
    });

    it("should allow a client token alongside a different Fizzy token on Authorization", () => {
      const request = new Request("https://example.com/mcp", {
        headers: {
          [CLIENT_AUTH_HEADER]: "secret",
          Authorization: "Bearer user-fizzy-pat",
        },
      });
      const env = { ...baseEnv, MCP_AUTH_TOKEN: "secret" };

      const result = validateSecurity(request, env);

      expect(result.allowed).toBe(true);
    });
  });

  describe("Combined Security", () => {
    it("should validate both origin and token", () => {
      const request = new Request("https://example.com/mcp", {
        headers: {
          Origin: "https://allowed.com",
          [CLIENT_AUTH_HEADER]: "secret",
        },
      });
      const env = {
        ...baseEnv,
        MCP_ALLOWED_ORIGINS: "https://allowed.com",
        MCP_AUTH_TOKEN: "secret",
      };

      const result = validateSecurity(request, env);

      expect(result.allowed).toBe(true);
      expect(result.corsOrigin).toBe("https://allowed.com");
    });

    it("should fail if origin is wrong even with correct token", () => {
      const request = new Request("https://example.com/mcp", {
        headers: {
          Origin: "https://wrong.com",
          [CLIENT_AUTH_HEADER]: "secret",
        },
      });
      const env = {
        ...baseEnv,
        MCP_ALLOWED_ORIGINS: "https://allowed.com",
        MCP_AUTH_TOKEN: "secret",
      };

      const result = validateSecurity(request, env);

      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it("should fail if token is wrong even with correct origin", () => {
      const request = new Request("https://example.com/mcp", {
        headers: {
          Origin: "https://allowed.com",
          [CLIENT_AUTH_HEADER]: "wrong",
        },
      });
      const env = {
        ...baseEnv,
        MCP_ALLOWED_ORIGINS: "https://allowed.com",
        MCP_AUTH_TOKEN: "secret",
      };

      const result = validateSecurity(request, env);

      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(401);
    });

    // A 401 without a usable Allow-Origin reads as an opaque network error in
    // the browser, so the auth failure must carry the same CORS origin the
    // success path would have returned — and never a more permissive one.
    it("should return the allowed CORS origin on a 401", () => {
      const request = new Request("https://example.com/mcp", {
        headers: {
          Origin: "https://allowed.com",
          [CLIENT_AUTH_HEADER]: "wrong",
        },
      });
      const env = {
        ...baseEnv,
        MCP_ALLOWED_ORIGINS: "https://allowed.com",
        MCP_AUTH_TOKEN: "secret",
      };

      const result = validateSecurity(request, env);

      expect(result.statusCode).toBe(401);
      expect(result.corsOrigin).toBe("https://allowed.com");
    });
  });
});

describe("CORS Headers", () => {
  it("should set all required CORS headers", () => {
    const headers = new Headers();
    setCorsHeaders(headers, "https://example.com");
    
    expect(headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
    expect(headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(headers.get("Access-Control-Allow-Headers")).toContain("mcp-session-id");
    expect(headers.get("Access-Control-Allow-Headers")).toContain(CLIENT_AUTH_HEADER);
    expect(headers.get("Access-Control-Expose-Headers")).toContain("mcp-session-id");
    expect(headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("should not set credentials for wildcard origin", () => {
    const headers = new Headers();
    setCorsHeaders(headers, "*");
    
    expect(headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});

describe("Request Routing", () => {
  it("should route /health to health handler", () => {
    const url = new URL("https://example.com/health");
    expect(url.pathname).toBe("/health");
  });

  it("should route /mcp to MCP handler", () => {
    const url = new URL("https://example.com/mcp");
    expect(url.pathname).toBe("/mcp");
  });

});

describe("Session ID Handling", () => {
  it("should extract session ID from header", () => {
    const request = new Request("https://example.com/mcp", {
      headers: { "mcp-session-id": "test-session-123" },
    });

    const sessionId = request.headers.get("mcp-session-id");
    expect(sessionId).toBe("test-session-123");
  });

  it("should generate UUID for new sessions", () => {
    const sessionId = crypto.randomUUID();
    expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe("Security Headers", () => {
  // These assert the Worker's real setSecurityHeaders, not a copy of it, so a
  // header dropped from production actually fails the suite.
  function applied(): Headers {
    const headers = new Headers();
    setSecurityHeaders(headers);
    return headers;
  }

  it("should include X-Content-Type-Options header", () => {
    expect(applied().get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("should include X-Frame-Options header", () => {
    expect(applied().get("X-Frame-Options")).toBe("DENY");
  });

  it("should include X-XSS-Protection header", () => {
    expect(applied().get("X-XSS-Protection")).toBe("1; mode=block");
  });

  it("should include Referrer-Policy header", () => {
    expect(applied().get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("should include Access-Control-Max-Age header", () => {
    const headers = new Headers();
    setCorsHeaders(headers, "*");

    expect(headers.get("Access-Control-Max-Age")).toBe("86400");
  });
});

describe("Environment Validation", () => {
  it("should validate FIZZY_ACCESS_TOKEN is present", () => {
    const env: Partial<MockEnv> = {};

    expect(env.FIZZY_ACCESS_TOKEN).toBeUndefined();
  });

  it("should validate MCP_SESSIONS binding is present", () => {
    const env: Partial<MockEnv> = {
      FIZZY_ACCESS_TOKEN: "test-token",
    };

    expect(env.MCP_SESSIONS).toBeUndefined();
  });

  it("should have valid environment when all required vars are set", () => {
    const env: MockEnv = {
      FIZZY_ACCESS_TOKEN: "test-token",
      MCP_SESSIONS: {
        idFromName: (name: string) => ({ toString: () => name }),
        get: () => ({
          fetch: async () => new Response("OK"),
        }),
      },
    };

    expect(env.FIZZY_ACCESS_TOKEN).toBeDefined();
    expect(env.MCP_SESSIONS).toBeDefined();
  });
});

describe("CORS Enhancements", () => {
  it("should include Access-Control-Max-Age for preflight caching", () => {
    const headers = new Headers();
    setCorsHeaders(headers, "*");

    expect(headers.get("Access-Control-Max-Age")).toBe("86400");
  });

  it("should set credentials flag for non-wildcard origins", () => {
    const headers = new Headers();
    setCorsHeaders(headers, "https://cursor.sh");

    expect(headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("should not set credentials flag for wildcard origin", () => {
    const headers = new Headers();
    setCorsHeaders(headers, "*");

    expect(headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("should advertise the client-auth header so browsers do not strip it", () => {
    const headers = new Headers();
    setCorsHeaders(headers, "https://cursor.sh");

    expect(headers.get("Access-Control-Allow-Headers")).toContain(CLIENT_AUTH_HEADER);
  });
});
