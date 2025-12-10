/**
 * Structured error classes for Fizzy API
 */

/**
 * Base error class for all Fizzy-related errors
 */
export class FizzyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "FizzyError";
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Error thrown when the API returns an error response
 */
export class FizzyAPIError extends FizzyError {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly statusText: string,
    public readonly responseBody?: string
  ) {
    super(message, `HTTP_${statusCode}`);
    this.name = "FizzyAPIError";
  }

  static fromResponse(
    statusCode: number,
    statusText: string,
    body?: string
  ): FizzyAPIError {
    const message = `Fizzy API error: ${statusCode} ${statusText}${body ? ` - ${body}` : ""}`;
    return new FizzyAPIError(message, statusCode, statusText, body);
  }
}

/**
 * Error thrown when authentication fails
 */
export class FizzyAuthError extends FizzyAPIError {
  constructor(message: string, responseBody?: string) {
    super(message, 401, "Unauthorized", responseBody);
    this.name = "FizzyAuthError";
  }
}

/**
 * Error thrown when access is forbidden
 */
export class FizzyForbiddenError extends FizzyAPIError {
  constructor(message: string, responseBody?: string) {
    super(message, 403, "Forbidden", responseBody);
    this.name = "FizzyForbiddenError";
  }
}

/**
 * Error thrown when a resource is not found
 */
export class FizzyNotFoundError extends FizzyAPIError {
  constructor(message: string, responseBody?: string) {
    super(message, 404, "Not Found", responseBody);
    this.name = "FizzyNotFoundError";
  }
}

/**
 * Error thrown when validation fails
 */
export class FizzyValidationError extends FizzyAPIError {
  constructor(
    message: string,
    public readonly validationErrors?: Record<string, string[]>
  ) {
    super(message, 422, "Unprocessable Entity", JSON.stringify(validationErrors));
    this.name = "FizzyValidationError";
  }
}

/**
 * Error thrown when rate limited
 */
export class FizzyRateLimitError extends FizzyAPIError {
  constructor(
    message: string,
    public readonly retryAfter?: number
  ) {
    super(message, 429, "Too Many Requests");
    this.name = "FizzyRateLimitError";
  }

  /**
   * Create from HTTP response with Retry-After header parsing
   */
  static fromRetryAfterHeader(retryAfterHeader?: string | null): FizzyRateLimitError {
    let retryAfter: number | undefined;

    if (retryAfterHeader) {
      // Retry-After can be seconds (integer) or HTTP-date
      const seconds = parseInt(retryAfterHeader, 10);
      if (!isNaN(seconds)) {
        retryAfter = seconds;
      } else {
        // Try parsing as HTTP-date
        const date = new Date(retryAfterHeader);
        if (!isNaN(date.getTime())) {
          retryAfter = Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
        }
      }
    }

    const message = retryAfter
      ? `Rate limit exceeded. Retry after ${retryAfter} seconds.`
      : "Rate limit exceeded. Please slow down your requests.";

    return new FizzyRateLimitError(message, retryAfter);
  }
}

/**
 * Error thrown on network/connection issues
 */
export class FizzyNetworkError extends FizzyError {
  constructor(message: string, cause?: Error) {
    super(message, "NETWORK_ERROR", cause);
    this.name = "FizzyNetworkError";
  }
}

/**
 * Error thrown when request times out
 */
export class FizzyTimeoutError extends FizzyError {
  constructor(
    message: string,
    public readonly timeoutMs: number
  ) {
    super(message, "TIMEOUT");
    this.name = "FizzyTimeoutError";
  }
}

/**
 * Error thrown when response parsing fails
 */
export class FizzyParseError extends FizzyError {
  constructor(message: string, cause?: Error) {
    super(message, "PARSE_ERROR", cause);
    this.name = "FizzyParseError";
  }
}

/**
 * Create appropriate error from HTTP status code
 */
export function createAPIError(
  statusCode: number,
  statusText: string,
  body?: string
): FizzyAPIError {
  switch (statusCode) {
    case 401:
      return new FizzyAuthError(
        `Authentication failed: ${body || "Invalid or expired access token"}`,
        body
      );
    case 403:
      return new FizzyForbiddenError(
        `Access forbidden: ${body || "You don't have permission to perform this action"}`,
        body
      );
    case 404:
      return new FizzyNotFoundError(
        `Resource not found: ${body || "The requested resource doesn't exist"}`,
        body
      );
    case 422:
      try {
        const errors = body ? JSON.parse(body) : undefined;
        return new FizzyValidationError(
          `Validation failed: ${body || "Invalid input"}`,
          errors
        );
      } catch {
        return new FizzyValidationError(`Validation failed: ${body || "Invalid input"}`);
      }
    case 429:
      // Note: Retry-After header should be passed separately when available
      return new FizzyRateLimitError(
        "Rate limit exceeded. Please slow down your requests."
      );
    default:
      return FizzyAPIError.fromResponse(statusCode, statusText, body);
  }
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof FizzyTimeoutError) return true;
  if (error instanceof FizzyNetworkError) return true;
  if (error instanceof FizzyRateLimitError) return true;
  if (error instanceof FizzyAPIError) {
    // Retry on server errors (5xx)
    return error.statusCode >= 500 && error.statusCode < 600;
  }
  return false;
}

