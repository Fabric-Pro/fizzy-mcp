import { describe, it, expect } from "vitest";
import {
  FizzyError,
  FizzyAPIError,
  FizzyAuthError,
  FizzyForbiddenError,
  FizzyNotFoundError,
  FizzyValidationError,
  FizzyRateLimitError,
  FizzyNetworkError,
  FizzyTimeoutError,
  FizzyParseError,
  createAPIError,
  isRetryableError,
} from "../../src/utils/errors.js";

describe("Error Classes", () => {
  describe("FizzyError", () => {
    it("should create base error with message and code", () => {
      const error = new FizzyError("Test error", "TEST_CODE");
      expect(error.message).toBe("Test error");
      expect(error.code).toBe("TEST_CODE");
      expect(error.name).toBe("FizzyError");
    });

    it("should include cause when provided", () => {
      const cause = new Error("Original error");
      const error = new FizzyError("Wrapped error", "WRAP", cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe("FizzyAPIError", () => {
    it("should create API error with status details", () => {
      const error = new FizzyAPIError("API failed", 500, "Internal Server Error", "Details");
      expect(error.statusCode).toBe(500);
      expect(error.statusText).toBe("Internal Server Error");
      expect(error.responseBody).toBe("Details");
      expect(error.code).toBe("HTTP_500");
    });

    it("should create from response helper", () => {
      const error = FizzyAPIError.fromResponse(404, "Not Found", "Resource missing");
      expect(error.message).toBe("Fizzy API error: 404 Not Found - Resource missing");
      expect(error.statusCode).toBe(404);
    });
  });

  describe("FizzyAuthError", () => {
    it("should create auth error with 401 status", () => {
      const error = new FizzyAuthError("Invalid token");
      expect(error.statusCode).toBe(401);
      expect(error.name).toBe("FizzyAuthError");
    });
  });

  describe("FizzyForbiddenError", () => {
    it("should create forbidden error with 403 status", () => {
      const error = new FizzyForbiddenError("Access denied");
      expect(error.statusCode).toBe(403);
      expect(error.name).toBe("FizzyForbiddenError");
    });
  });

  describe("FizzyNotFoundError", () => {
    it("should create not found error with 404 status", () => {
      const error = new FizzyNotFoundError("Resource not found");
      expect(error.statusCode).toBe(404);
      expect(error.name).toBe("FizzyNotFoundError");
    });
  });

  describe("FizzyValidationError", () => {
    it("should create validation error with 422 status", () => {
      const errors = { title: ["is required", "is too short"] };
      const error = new FizzyValidationError("Validation failed", errors);
      expect(error.statusCode).toBe(422);
      expect(error.validationErrors).toEqual(errors);
    });
  });

  describe("FizzyRateLimitError", () => {
    it("should create rate limit error with 429 status", () => {
      const error = new FizzyRateLimitError("Too many requests", 60);
      expect(error.statusCode).toBe(429);
      expect(error.retryAfter).toBe(60);
    });

    it("should parse Retry-After header as seconds", () => {
      const error = FizzyRateLimitError.fromRetryAfterHeader("120");
      expect(error.retryAfter).toBe(120);
      expect(error.message).toContain("120 seconds");
    });

    it("should parse Retry-After header as HTTP-date", () => {
      const futureDate = new Date(Date.now() + 60000); // 60 seconds from now
      const httpDate = futureDate.toUTCString();
      const error = FizzyRateLimitError.fromRetryAfterHeader(httpDate);
      expect(error.retryAfter).toBeGreaterThanOrEqual(59);
      expect(error.retryAfter).toBeLessThanOrEqual(61);
    });

    it("should handle missing Retry-After header", () => {
      const error = FizzyRateLimitError.fromRetryAfterHeader(null);
      expect(error.retryAfter).toBeUndefined();
      expect(error.message).toContain("Please slow down");
    });

    it("should handle invalid Retry-After header", () => {
      const error = FizzyRateLimitError.fromRetryAfterHeader("invalid");
      expect(error.retryAfter).toBeUndefined();
    });
  });

  describe("FizzyNetworkError", () => {
    it("should create network error with cause", () => {
      const cause = new TypeError("Failed to fetch");
      const error = new FizzyNetworkError("Network failed", cause);
      expect(error.code).toBe("NETWORK_ERROR");
      expect(error.cause).toBe(cause);
    });
  });

  describe("FizzyTimeoutError", () => {
    it("should create timeout error with duration", () => {
      const error = new FizzyTimeoutError("Request timed out", 30000);
      expect(error.code).toBe("TIMEOUT");
      expect(error.timeoutMs).toBe(30000);
    });
  });

  describe("FizzyParseError", () => {
    it("should create parse error", () => {
      const error = new FizzyParseError("Invalid JSON");
      expect(error.code).toBe("PARSE_ERROR");
    });
  });
});

describe("createAPIError", () => {
  it("should create FizzyAuthError for 401", () => {
    const error = createAPIError(401, "Unauthorized", "Invalid token");
    expect(error).toBeInstanceOf(FizzyAuthError);
    expect(error.statusCode).toBe(401);
  });

  it("should create FizzyForbiddenError for 403", () => {
    const error = createAPIError(403, "Forbidden", "No access");
    expect(error).toBeInstanceOf(FizzyForbiddenError);
    expect(error.statusCode).toBe(403);
  });

  it("should create FizzyNotFoundError for 404", () => {
    const error = createAPIError(404, "Not Found", "Missing");
    expect(error).toBeInstanceOf(FizzyNotFoundError);
    expect(error.statusCode).toBe(404);
  });

  it("should create FizzyValidationError for 422", () => {
    const error = createAPIError(422, "Unprocessable Entity", '{"title":["required"]}');
    expect(error).toBeInstanceOf(FizzyValidationError);
    expect(error.statusCode).toBe(422);
  });

  it("should create FizzyValidationError for 422 with invalid JSON", () => {
    const error = createAPIError(422, "Unprocessable Entity", "Invalid data");
    expect(error).toBeInstanceOf(FizzyValidationError);
  });

  it("should create FizzyRateLimitError for 429", () => {
    const error = createAPIError(429, "Too Many Requests", "");
    expect(error).toBeInstanceOf(FizzyRateLimitError);
    expect(error.statusCode).toBe(429);
  });

  it("should create generic FizzyAPIError for other status codes", () => {
    const error = createAPIError(500, "Internal Server Error", "Server crashed");
    expect(error).toBeInstanceOf(FizzyAPIError);
    expect(error.statusCode).toBe(500);
  });

  it("should create generic FizzyAPIError for 502", () => {
    const error = createAPIError(502, "Bad Gateway", "Upstream error");
    expect(error).toBeInstanceOf(FizzyAPIError);
    expect(error.statusCode).toBe(502);
  });

  it("should create generic FizzyAPIError for 503", () => {
    const error = createAPIError(503, "Service Unavailable", "Down for maintenance");
    expect(error).toBeInstanceOf(FizzyAPIError);
    expect(error.statusCode).toBe(503);
  });
});

describe("isRetryableError", () => {
  it("should return true for FizzyTimeoutError", () => {
    const error = new FizzyTimeoutError("Timed out", 30000);
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return true for FizzyNetworkError", () => {
    const error = new FizzyNetworkError("Network failed");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return true for FizzyRateLimitError", () => {
    const error = new FizzyRateLimitError("Rate limited", 60);
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return true for 500 server error", () => {
    const error = new FizzyAPIError("Server error", 500, "Internal Server Error");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return true for 502 server error", () => {
    const error = new FizzyAPIError("Bad gateway", 502, "Bad Gateway");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return true for 503 server error", () => {
    const error = new FizzyAPIError("Unavailable", 503, "Service Unavailable");
    expect(isRetryableError(error)).toBe(true);
  });

  it("should return false for 400 client error", () => {
    const error = new FizzyAPIError("Bad request", 400, "Bad Request");
    expect(isRetryableError(error)).toBe(false);
  });

  it("should return false for 401 auth error", () => {
    const error = new FizzyAuthError("Unauthorized");
    expect(isRetryableError(error)).toBe(false);
  });

  it("should return false for 404 not found error", () => {
    const error = new FizzyNotFoundError("Not found");
    expect(isRetryableError(error)).toBe(false);
  });

  it("should return false for 422 validation error", () => {
    const error = new FizzyValidationError("Invalid");
    expect(isRetryableError(error)).toBe(false);
  });

  it("should return false for generic Error", () => {
    const error = new Error("Generic error");
    expect(isRetryableError(error)).toBe(false);
  });

  it("should return false for non-error values", () => {
    expect(isRetryableError("string")).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});

