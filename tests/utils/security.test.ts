import { describe, it, expect, vi } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import {
  validateRequestSecurity,
  sendSecurityError,
  setSecureCorsHeaders,
  getBindAddress,
  SecurityOptions,
} from "../../src/utils/security.js";

// Helper to create mock request
function createMockRequest(
  method: string,
  headers: Record<string, string | undefined> = {}
): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  req.headers = headers as any;
  return req;
}

// Helper to create mock response
function createMockResponse(): ServerResponse & {
  _headers: Record<string, string>;
  _statusCode: number;
  _body: string;
} {
  const res = new EventEmitter() as ServerResponse & {
    _headers: Record<string, string>;
    _statusCode: number;
    _body: string;
  };
  res._headers = {};
  res._statusCode = 200;
  res._body = "";

  res.setHeader = vi.fn((name: string, value: string) => {
    res._headers[name.toLowerCase()] = value;
    return res;
  });
  res.writeHead = vi.fn((statusCode: number, headers?: Record<string, string>) => {
    res._statusCode = statusCode;
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        res._headers[k.toLowerCase()] = v;
      }
    }
    return res;
  });
  res.end = vi.fn((body?: string) => {
    res._body = body || "";
    return res;
  });

  return res;
}

describe("Security Utilities", () => {
  describe("validateRequestSecurity", () => {
    describe("Origin Validation", () => {
      it("should allow all origins by default (wildcard)", async () => {
        const req = createMockRequest("GET", { origin: "http://localhost:3000" });
        const result = await validateRequestSecurity(req, {}, 3000);
        
        expect(result.allowed).toBe(true);
        expect(result.corsOrigin).toBe("*");
      });

      it("should allow any origin by default", async () => {
        const req = createMockRequest("GET", { origin: "https://any-site.com" });
        const result = await validateRequestSecurity(req, {}, 3000);
        
        expect(result.allowed).toBe(true);
        expect(result.corsOrigin).toBe("*");
      });

      it("should reject non-allowed origins when explicitly configured", async () => {
        const req = createMockRequest("GET", { origin: "https://evil.com" });
        const options: SecurityOptions = {
          allowedOrigins: ["http://localhost:3000"],
        };
        const result = await validateRequestSecurity(req, options, 3000);
        
        expect(result.allowed).toBe(false);
        expect(result.statusCode).toBe(403);
        expect(result.error).toBe("Origin not allowed");
      });

      it("should allow custom origins when configured", async () => {
        const req = createMockRequest("GET", { origin: "https://myapp.com" });
        const options: SecurityOptions = {
          allowedOrigins: ["https://myapp.com"],
        };
        const result = await validateRequestSecurity(req, options, 3000);
        
        expect(result.allowed).toBe(true);
        expect(result.corsOrigin).toBe("https://myapp.com");
      });

      it("should allow all origins when wildcard is explicitly configured", async () => {
        const req = createMockRequest("GET", { origin: "https://any-origin.com" });
        const options: SecurityOptions = {
          allowedOrigins: ["*"],
        };
        const result = await validateRequestSecurity(req, options, 3000);
        
        expect(result.allowed).toBe(true);
        expect(result.corsOrigin).toBe("*");
      });

      it("should allow requests without Origin header (non-browser clients)", async () => {
        const req = createMockRequest("GET", {});
        const result = await validateRequestSecurity(req, {}, 3000);
        
        expect(result.allowed).toBe(true);
      });

      it("should allow localhost with different ports when configured", async () => {
        const req = createMockRequest("GET", { origin: "http://localhost:8080" });
        const options: SecurityOptions = {
          allowedOrigins: ["http://localhost"],
        };
        const result = await validateRequestSecurity(req, options, 3000);
        
        expect(result.allowed).toBe(true);
      });
    });

    describe("Client Authentication", () => {
      it("should allow requests when no authToken is configured", async () => {
        const req = createMockRequest("GET", { origin: "http://localhost:3000" });
        const result = await validateRequestSecurity(req, {}, 3000);
        
        expect(result.allowed).toBe(true);
      });

      it("should reject requests without Authorization header when authToken is set", async () => {
        const req = createMockRequest("GET", { origin: "http://localhost:3000" });
        const options: SecurityOptions = { authToken: "secret-token" };
        const result = await validateRequestSecurity(req, options, 3000);
        
        expect(result.allowed).toBe(false);
        expect(result.statusCode).toBe(401);
        expect(result.error).toBe("Client authentication required");
      });

      it("should reject requests with invalid Authorization format", async () => {
        const req = createMockRequest("GET", {
          origin: "http://localhost:3000",
          authorization: "Basic user:pass",
        });
        const options: SecurityOptions = { authToken: "secret-token" };
        const result = await validateRequestSecurity(req, options, 3000);
        
        expect(result.allowed).toBe(false);
        expect(result.statusCode).toBe(401);
        expect(result.error).toContain("Invalid client authentication format");
      });

      it("should reject requests with wrong token", async () => {
        const req = createMockRequest("GET", {
          origin: "http://localhost:3000",
          authorization: "Bearer wrong-token",
        });
        const options: SecurityOptions = { authToken: "secret-token" };
        const result = await validateRequestSecurity(req, options, 3000);
        
        expect(result.allowed).toBe(false);
        expect(result.statusCode).toBe(401);
        expect(result.error).toBe("Invalid client authentication token");
      });

      it("should allow requests with correct Bearer token", async () => {
        const req = createMockRequest("GET", {
          origin: "http://localhost:3000",
          authorization: "Bearer secret-token",
        });
        const options: SecurityOptions = { authToken: "secret-token" };
        const result = await validateRequestSecurity(req, options, 3000);
        
        expect(result.allowed).toBe(true);
      });
    });

    describe("Custom Authorization", () => {
      it("should call custom authorize function", async () => {
        const authorize = vi.fn().mockReturnValue(true);
        const req = createMockRequest("GET", { origin: "http://localhost:3000" });
        const options: SecurityOptions = { authorize };
        
        await validateRequestSecurity(req, options, 3000, "session-123");
        
        expect(authorize).toHaveBeenCalledWith(req, "session-123");
      });

      it("should reject when authorize returns false", async () => {
        const authorize = vi.fn().mockReturnValue(false);
        const req = createMockRequest("GET", { origin: "http://localhost:3000" });
        const options: SecurityOptions = { authorize };
        const result = await validateRequestSecurity(req, options, 3000);
        
        expect(result.allowed).toBe(false);
        expect(result.statusCode).toBe(403);
        expect(result.error).toBe("Authorization denied");
      });

      it("should handle async authorize function", async () => {
        const authorize = vi.fn().mockResolvedValue(true);
        const req = createMockRequest("GET", { origin: "http://localhost:3000" });
        const options: SecurityOptions = { authorize };
        const result = await validateRequestSecurity(req, options, 3000);
        
        expect(result.allowed).toBe(true);
      });

      it("should handle authorize function errors", async () => {
        const authorize = vi.fn().mockRejectedValue(new Error("Auth error"));
        const req = createMockRequest("GET", { origin: "http://localhost:3000" });
        const options: SecurityOptions = { authorize };
        const result = await validateRequestSecurity(req, options, 3000);
        
        expect(result.allowed).toBe(false);
        expect(result.statusCode).toBe(500);
        expect(result.error).toBe("Authorization check failed");
      });
    });
  });

  describe("sendSecurityError", () => {
    it("should send JSON error response", () => {
      const res = createMockResponse();
      sendSecurityError(res, { allowed: false, statusCode: 403, error: "Forbidden" });
      
      expect(res.writeHead).toHaveBeenCalledWith(403, { "Content-Type": "application/json" });
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: "Forbidden" }));
    });

    it("should default to 403 if no status code provided", () => {
      const res = createMockResponse();
      sendSecurityError(res, { allowed: false, error: "Denied" });
      
      expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
    });
  });

  describe("setSecureCorsHeaders", () => {
    it("should set CORS headers with specific origin", () => {
      const res = createMockResponse();
      setSecureCorsHeaders(res, "https://myapp.com", ["mcp-session-id"]);
      
      expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "https://myapp.com");
      expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");
      expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Expose-Headers", "mcp-session-id");
      expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Credentials", "true");
    });

    it("should not set credentials header for wildcard origin", () => {
      const res = createMockResponse();
      setSecureCorsHeaders(res, "*");
      
      expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
      expect(res.setHeader).not.toHaveBeenCalledWith("Access-Control-Allow-Credentials", "true");
    });
  });

  describe("getBindAddress", () => {
    it("should return 127.0.0.1 by default", () => {
      expect(getBindAddress({})).toBe("127.0.0.1");
    });

    it("should return 127.0.0.1 when localhostOnly is true", () => {
      expect(getBindAddress({ localhostOnly: true })).toBe("127.0.0.1");
    });

    it("should return 0.0.0.0 when localhostOnly is false", () => {
      expect(getBindAddress({ localhostOnly: false })).toBe("0.0.0.0");
    });
  });
});

