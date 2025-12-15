/**
 * Cloudflare Structured Logger
 * 
 * Provides structured logging with optional persistence to R2 for:
 * - Audit trails of tool invocations
 * - Debugging and troubleshooting
 * - Compliance and security monitoring
 * 
 * @see https://developers.cloudflare.com/r2/
 * @see https://developers.cloudflare.com/workers/observability/logs/
 */

import type { R2Bucket } from "@cloudflare/workers-types";

/**
 * Log levels for structured logging
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Structured log entry
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  sessionId?: string;
  tool?: string;
  accountSlug?: string;
  durationMs?: number;
  error?: {
    code: number;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Tool invocation log for audit trails
 */
export interface ToolInvocationLog extends LogEntry {
  type: "tool_invocation";
  tool: string;
  accountSlug: string;
  args: Record<string, unknown>;
  success: boolean;
  durationMs: number;
}

/**
 * Session lifecycle log
 */
export interface SessionLog extends LogEntry {
  type: "session";
  event: "created" | "initialized" | "expired" | "deleted";
  sessionId: string;
  clientInfo?: {
    name?: string;
    version?: string;
  };
}

/**
 * Configuration for CloudflareLogger
 */
export interface CloudflareLoggerConfig {
  /** Minimum log level to emit */
  level: LogLevel;
  /** R2 bucket for persistent storage (optional) */
  r2Bucket?: R2Bucket;
  /** Prefix for R2 object keys */
  r2Prefix?: string;
  /** Session ID for log correlation */
  sessionId?: string;
  /** Whether to also log to console */
  consoleOutput?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Cloudflare-optimized structured logger
 * 
 * Features:
 * - Structured JSON logging compatible with Workers Logpush
 * - Optional R2 persistence for long-term audit trails
 * - Session correlation for debugging
 * - Tool invocation tracking
 */
export class CloudflareLogger {
  private config: Required<Omit<CloudflareLoggerConfig, "r2Bucket" | "sessionId">> & 
    Pick<CloudflareLoggerConfig, "r2Bucket" | "sessionId">;
  private buffer: LogEntry[] = [];
  private flushPromise: Promise<void> | null = null;

  constructor(config: CloudflareLoggerConfig) {
    this.config = {
      level: config.level,
      r2Bucket: config.r2Bucket,
      r2Prefix: config.r2Prefix ?? "logs",
      sessionId: config.sessionId,
      consoleOutput: config.consoleOutput ?? true,
    };
  }

  /**
   * Set the session ID for log correlation
   */
  setSessionId(sessionId: string): void {
    this.config.sessionId = sessionId;
  }

  /**
   * Check if a log level should be emitted
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  /**
   * Format and emit a log entry
   */
  private emit(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      sessionId: this.config.sessionId,
      metadata,
    };

    // Console output for Workers Logpush
    if (this.config.consoleOutput) {
      const output = JSON.stringify(entry);
      switch (level) {
        case "debug":
          console.debug(output);
          break;
        case "info":
          console.info(output);
          break;
        case "warn":
          console.warn(output);
          break;
        case "error":
          console.error(output);
          break;
      }
    }

    // Buffer for R2 persistence
    if (this.config.r2Bucket) {
      this.buffer.push(entry);
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, metadata?: Record<string, unknown>): void {
    this.emit("debug", message, metadata);
  }

  /**
   * Log info message
   */
  info(message: string, metadata?: Record<string, unknown>): void {
    this.emit("info", message, metadata);
  }

  /**
   * Log warning message
   */
  warn(message: string, metadata?: Record<string, unknown>): void {
    this.emit("warn", message, metadata);
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error | unknown, metadata?: Record<string, unknown>): void {
    const errorData = error instanceof Error ? {
      code: -1,
      message: error.message,
      stack: error.stack,
    } : error ? {
      code: -1,
      message: String(error),
    } : undefined;

    this.emit("error", message, {
      ...metadata,
      error: errorData,
    });
  }

  /**
   * Log a tool invocation for audit trails
   */
  logToolInvocation(
    toolName: string,
    accountSlug: string,
    args: Record<string, unknown>,
    result: { success: boolean; durationMs: number; error?: Error }
  ): void {
    const entry: ToolInvocationLog = {
      type: "tool_invocation",
      timestamp: new Date().toISOString(),
      level: result.success ? "info" : "error",
      message: `Tool ${toolName} ${result.success ? "succeeded" : "failed"}`,
      sessionId: this.config.sessionId,
      tool: toolName,
      accountSlug,
      args: this.sanitizeArgs(args),
      success: result.success,
      durationMs: result.durationMs,
    };

    if (result.error) {
      entry.error = {
        code: -1,
        message: result.error.message,
        stack: result.error.stack,
      };
    }

    if (this.config.consoleOutput) {
      console.info(JSON.stringify(entry));
    }

    if (this.config.r2Bucket) {
      this.buffer.push(entry);
    }
  }

  /**
   * Log a session lifecycle event
   */
  logSessionEvent(
    event: SessionLog["event"],
    clientInfo?: { name?: string; version?: string }
  ): void {
    const entry: SessionLog = {
      type: "session",
      timestamp: new Date().toISOString(),
      level: event === "expired" ? "warn" : "info",
      message: `Session ${event}`,
      sessionId: this.config.sessionId || "unknown",
      event,
      clientInfo,
    };

    if (this.config.consoleOutput) {
      console.info(JSON.stringify(entry));
    }

    if (this.config.r2Bucket) {
      this.buffer.push(entry);
    }
  }

  /**
   * Sanitize arguments to remove sensitive data
   */
  private sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = ["password", "token", "secret", "key", "authorization"];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "string" && value.length > 500) {
        sanitized[key] = value.slice(0, 500) + "...[truncated]";
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Flush buffered logs to R2
   * Call this at the end of a request or periodically
   */
  async flush(): Promise<void> {
    if (!this.config.r2Bucket || this.buffer.length === 0) {
      return;
    }

    // Prevent concurrent flushes
    if (this.flushPromise) {
      await this.flushPromise;
      return;
    }

    const logsToFlush = [...this.buffer];
    this.buffer = [];

    this.flushPromise = this.writeToR2(logsToFlush);

    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  /**
   * Write logs to R2 storage
   */
  private async writeToR2(logs: LogEntry[]): Promise<void> {
    if (!this.config.r2Bucket) return;

    const now = new Date();
    const date = now.toISOString().split("T")[0]; // YYYY-MM-DD
    const hour = now.getUTCHours().toString().padStart(2, "0");
    const sessionPart = this.config.sessionId ? `/${this.config.sessionId}` : "";
    const uniqueId = crypto.randomUUID().slice(0, 8);
    
    // Structure: logs/YYYY-MM-DD/HH/session-id/timestamp-uuid.ndjson
    const key = `${this.config.r2Prefix}/${date}/${hour}${sessionPart}/${now.getTime()}-${uniqueId}.ndjson`;
    
    // Write as newline-delimited JSON (NDJSON) for easy processing
    const content = logs.map(log => JSON.stringify(log)).join("\n");

    try {
      await this.config.r2Bucket.put(key, content, {
        httpMetadata: {
          contentType: "application/x-ndjson",
        },
        customMetadata: {
          sessionId: this.config.sessionId || "unknown",
          logCount: String(logs.length),
        },
      });
    } catch (error) {
      // Don't throw on logging failures - just console log
      console.error("Failed to write logs to R2:", error);
    }
  }

  /**
   * Get buffered log count (for testing/monitoring)
   */
  getBufferSize(): number {
    return this.buffer.length;
  }
}

/**
 * Create a logger instance with default configuration
 */
export function createLogger(config: Partial<CloudflareLoggerConfig> = {}): CloudflareLogger {
  return new CloudflareLogger({
    level: config.level ?? "info",
    r2Bucket: config.r2Bucket,
    r2Prefix: config.r2Prefix ?? "logs",
    sessionId: config.sessionId,
    consoleOutput: config.consoleOutput ?? true,
  });
}




