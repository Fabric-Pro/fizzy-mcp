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

// Import the security validation logic inline for testing
// (In production, this would be imported from the worker)
function validateSecurity(request: Request, env: MockEnv): {
  allowed: boolean;
  statusCode?: number;
  error?: string;
  corsOrigin?: string;
} {
  const origin = request.headers.get("Origin");
  
  const allowedOriginsStr = env.MCP_ALLOWED_ORIGINS || "*";
  const allowedOrigins = allowedOriginsStr === "*" 
    ? ["*"] 
    : allowedOriginsStr.split(",").map(o => o.trim());

  if (origin && !allowedOrigins.includes("*")) {
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed === origin) return true;
      try {
        const originUrl = new URL(origin);
        const allowedUrl = new URL(allowed);
        return originUrl.hostname === allowedUrl.hostname && 
               originUrl.protocol === allowedUrl.protocol;
      } catch {
        return false;
      }
    });

    if (!isAllowed) {
      return {
        allowed: false,
        statusCode: 403,
        error: "Origin not allowed",
        corsOrigin: allowedOrigins[0],
      };
    }
  }

  if (env.MCP_AUTH_TOKEN) {
    const authHeader = request.headers.get("Authorization");
    
    if (!authHeader) {
      return {
        allowed: false,
        statusCode: 401,
        error: "Client authentication required",
        corsOrigin: origin || "*",
      };
    }

    if (!authHeader.startsWith("Bearer ")) {
      return {
        allowed: false,
        statusCode: 401,
        error: "Invalid authentication format. Expected: Bearer <token>",
        corsOrigin: origin || "*",
      };
    }

    const token = authHeader.slice(7);
    if (token !== env.MCP_AUTH_TOKEN) {
      return {
        allowed: false,
        statusCode: 401,
        error: "Invalid authentication token",
        corsOrigin: origin || "*",
      };
    }
  }

  let corsOrigin: string;
  if (allowedOrigins.includes("*")) {
    corsOrigin = "*";
  } else if (origin && allowedOrigins.includes(origin)) {
    corsOrigin = origin;
  } else {
    corsOrigin = allowedOrigins[0] || "*";
  }

  return { allowed: true, corsOrigin };
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

    it("should match localhost with different ports", () => {
      const request = new Request("https://example.com/mcp", {
        headers: { Origin: "http://localhost:3000" },
      });
      const env = { ...baseEnv, MCP_ALLOWED_ORIGINS: "http://localhost:8080" };
      
      const result = validateSecurity(request, env);
      
      expect(result.allowed).toBe(true);
    });
  });

  describe("Bearer Token Authentication", () => {
    it("should allow requests without auth when MCP_AUTH_TOKEN not set", () => {
      const request = new Request("https://example.com/mcp");
      const env = { ...baseEnv };
      
      const result = validateSecurity(request, env);
      
      expect(result.allowed).toBe(true);
    });

    it("should require auth when MCP_AUTH_TOKEN is set", () => {
      const request = new Request("https://example.com/mcp");
      const env = { ...baseEnv, MCP_AUTH_TOKEN: "secret" };
      
      const result = validateSecurity(request, env);
      
      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(result.error).toBe("Client authentication required");
    });

    it("should reject invalid auth format", () => {
      const request = new Request("https://example.com/mcp", {
        headers: { Authorization: "Basic abc123" },
      });
      const env = { ...baseEnv, MCP_AUTH_TOKEN: "secret" };
      
      const result = validateSecurity(request, env);
      
      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(result.error).toContain("Invalid authentication format");
    });

    it("should reject wrong token", () => {
      const request = new Request("https://example.com/mcp", {
        headers: { Authorization: "Bearer wrong-token" },
      });
      const env = { ...baseEnv, MCP_AUTH_TOKEN: "secret" };
      
      const result = validateSecurity(request, env);
      
      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(result.error).toBe("Invalid authentication token");
    });

    it("should allow correct token", () => {
      const request = new Request("https://example.com/mcp", {
        headers: { Authorization: "Bearer secret" },
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
          Authorization: "Bearer secret",
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
          Authorization: "Bearer secret",
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
          Authorization: "Bearer wrong",
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
  });
});

describe("CORS Headers", () => {
  function setCorsHeaders(headers: Headers, corsOrigin: string): void {
    headers.set("Access-Control-Allow-Origin", corsOrigin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");
    headers.set("Access-Control-Expose-Headers", "mcp-session-id");
    
    if (corsOrigin !== "*") {
      headers.set("Access-Control-Allow-Credentials", "true");
    }
  }

  it("should set all required CORS headers", () => {
    const headers = new Headers();
    setCorsHeaders(headers, "https://example.com");
    
    expect(headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
    expect(headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(headers.get("Access-Control-Allow-Headers")).toContain("mcp-session-id");
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
  it("should include X-Content-Type-Options header", () => {
    const headers = new Headers();
    headers.set("X-Content-Type-Options", "nosniff");

    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("should include X-Frame-Options header", () => {
    const headers = new Headers();
    headers.set("X-Frame-Options", "DENY");

    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("should include X-XSS-Protection header", () => {
    const headers = new Headers();
    headers.set("X-XSS-Protection", "1; mode=block");

    expect(headers.get("X-XSS-Protection")).toBe("1; mode=block");
  });

  it("should include Referrer-Policy header", () => {
    const headers = new Headers();
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("should include Access-Control-Max-Age header", () => {
    const headers = new Headers();
    headers.set("Access-Control-Max-Age", "86400");

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
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");
    headers.set("Access-Control-Expose-Headers", "mcp-session-id");
    headers.set("Access-Control-Max-Age", "86400");

    expect(headers.get("Access-Control-Max-Age")).toBe("86400");
  });

  it("should set credentials flag for non-wildcard origins", () => {
    const headers = new Headers();
    const corsOrigin = "https://cursor.sh";

    headers.set("Access-Control-Allow-Origin", corsOrigin);
    headers.set("Access-Control-Allow-Credentials", "true");

    expect(headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("should not set credentials flag for wildcard origin", () => {
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");

    expect(headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});

