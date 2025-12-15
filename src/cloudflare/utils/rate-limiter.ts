/**
 * Cloudflare Rate Limiter
 * 
 * Provides rate limiting using Durable Objects for:
 * - Per-user/token rate limiting
 * - Global rate limiting
 * - Abuse prevention
 * 
 * Uses a sliding window algorithm with Durable Object storage
 * for accurate, distributed rate limiting.
 * 
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
 */

import type { DurableObjectState, DurableObjectNamespace } from "@cloudflare/workers-types";
import { DurableObject } from "cloudflare:workers";

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
}

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in the current window */
  remaining: number;
  /** Total limit */
  limit: number;
  /** Seconds until the limit resets */
  resetAfterSeconds: number;
  /** Unix timestamp when the limit resets */
  resetAt: number;
}

/**
 * Stored rate limit state
 */
interface RateLimitState {
  /** Request timestamps in current window */
  timestamps: number[];
  /** Window start time */
  windowStart: number;
}

/**
 * Rate Limiter Durable Object
 * 
 * Each instance manages rate limits for a specific key (e.g., user token hash).
 * Uses sliding window algorithm for accurate rate limiting.
 */
export class RateLimiterDO extends DurableObject<object> {
  private state: RateLimitState | null = null;

  constructor(ctx: DurableObjectState, env: object) {
    super(ctx, env);
  }

  /**
   * Initialize state from storage
   */
  private async initState(): Promise<RateLimitState> {
    if (!this.state) {
      this.state = await this.ctx.storage.get<RateLimitState>("state") ?? {
        timestamps: [],
        windowStart: Date.now(),
      };
    }
    return this.state;
  }

  /**
   * Save state to storage
   */
  private async saveState(): Promise<void> {
    if (this.state) {
      await this.ctx.storage.put("state", this.state);
    }
  }

  /**
   * Check and consume a rate limit
   */
  async checkLimit(limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const state = await this.initState();
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - windowMs;

    // Clean up old timestamps outside the window
    state.timestamps = state.timestamps.filter(ts => ts > windowStart);
    state.windowStart = windowStart;

    // Calculate remaining
    const used = state.timestamps.length;
    const remaining = Math.max(0, limit - used);
    const allowed = remaining > 0;

    // If allowed, record this request
    if (allowed) {
      state.timestamps.push(now);
    }

    // Calculate reset time (when oldest request expires from window)
    const oldestTimestamp = state.timestamps[0];
    const resetAt = oldestTimestamp ? oldestTimestamp + windowMs : now + windowMs;
    const resetAfterSeconds = Math.ceil((resetAt - now) / 1000);

    await this.saveState();

    return {
      allowed,
      remaining: allowed ? remaining - 1 : remaining,
      limit,
      resetAfterSeconds,
      resetAt: Math.ceil(resetAt / 1000),
    };
  }

  /**
   * Handle HTTP requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (request.method === "POST" && url.pathname === "/check") {
      const body = await request.json() as { limit: number; windowSeconds: number };
      const result = await this.checkLimit(body.limit, body.windowSeconds);
      return Response.json(result);
    }

    if (request.method === "DELETE") {
      await this.ctx.storage.deleteAll();
      this.state = null;
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  }
}

/**
 * Rate limiter client for use in Workers
 */
export class RateLimiter {
  private namespace: DurableObjectNamespace;
  private defaultConfig: RateLimitConfig;

  constructor(
    namespace: DurableObjectNamespace,
    defaultConfig: RateLimitConfig = { limit: 10000, windowSeconds: 60 }
  ) {
    this.namespace = namespace;
    this.defaultConfig = defaultConfig;
  }

  /**
   * Generate a rate limit key from a token
   * Uses SHA-256 hash to avoid storing tokens
   */
  async getKeyFromToken(token: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  }

  /**
   * Check rate limit for a key
   */
  async check(
    key: string,
    config?: Partial<RateLimitConfig>
  ): Promise<RateLimitResult> {
    const doId = this.namespace.idFromName(`ratelimit:${key}`);
    const doStub = this.namespace.get(doId);

    const response = await doStub.fetch("http://internal/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        limit: config?.limit ?? this.defaultConfig.limit,
        windowSeconds: config?.windowSeconds ?? this.defaultConfig.windowSeconds,
      }),
    });

    return response.json() as Promise<RateLimitResult>;
  }

  /**
   * Check rate limit using a token (hashes the token first)
   */
  async checkByToken(
    token: string,
    config?: Partial<RateLimitConfig>
  ): Promise<RateLimitResult> {
    const key = await this.getKeyFromToken(token);
    return this.check(key, config);
  }

  /**
   * Reset rate limit for a key
   */
  async reset(key: string): Promise<void> {
    const doId = this.namespace.idFromName(`ratelimit:${key}`);
    const doStub = this.namespace.get(doId);

    await doStub.fetch("http://internal/reset", {
      method: "DELETE",
    });
  }

  /**
   * Create response headers for rate limit info
   */
  static createHeaders(result: RateLimitResult): Record<string, string> {
    return {
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": String(result.remaining),
      "X-RateLimit-Reset": String(result.resetAt),
    };
  }

  /**
   * Create a 429 Too Many Requests response
   */
  static createRateLimitResponse(
    result: RateLimitResult,
    corsOrigin: string = "*"
  ): Response {
    const headers = new Headers({
      "Content-Type": "application/json",
      "Retry-After": String(result.resetAfterSeconds),
      "Access-Control-Allow-Origin": corsOrigin,
      ...RateLimiter.createHeaders(result),
    });

    return new Response(
      JSON.stringify({
        error: "Too many requests",
        retryAfter: result.resetAfterSeconds,
        limit: result.limit,
        resetAt: result.resetAt,
      }),
      { status: 429, headers }
    );
  }
}

/**
 * Middleware-style rate limit check
 * Returns null if allowed, Response if rate limited
 */
export async function checkRateLimit(
  rateLimiter: RateLimiter | undefined,
  token: string,
  config?: Partial<RateLimitConfig>,
  corsOrigin?: string
): Promise<Response | null> {
  if (!rateLimiter) return null;

  const result = await rateLimiter.checkByToken(token, config);
  
  if (!result.allowed) {
    return RateLimiter.createRateLimitResponse(result, corsOrigin);
  }

  return null;
}

/**
 * Default rate limit configurations
 */
export const RATE_LIMIT_CONFIGS = {
  /** Standard API rate limit: 10000 requests per minute */
  standard: { limit: 10000, windowSeconds: 60 } as RateLimitConfig,
  
  /** Strict rate limit for sensitive operations: 10 per minute */
  strict: { limit: 10, windowSeconds: 60 } as RateLimitConfig,
  
  /** Lenient rate limit: 50000 requests per minute */
  lenient: { limit: 50000, windowSeconds: 60 } as RateLimitConfig,
  
  /** Burst rate limit: 200 requests per second */
  burst: { limit: 200, windowSeconds: 1 } as RateLimitConfig,
  
  /** Daily rate limit: 1000000 requests per day */
  daily: { limit: 1000000, windowSeconds: 86400 } as RateLimitConfig,
  
  /** Legacy rate limit: 100 requests per minute (original default) */
  legacy: { limit: 100, windowSeconds: 60 } as RateLimitConfig,
} as const;

