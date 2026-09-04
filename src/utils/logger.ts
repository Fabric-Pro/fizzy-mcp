/**
 * Simple logger for Fizzy MCP Server
 * Logs to stderr to avoid interfering with stdio transport
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Escape CR/LF in caller-supplied text so a message can never forge extra log
 * lines. Each record is a single line; `data` is safe already because
 * `JSON.stringify` escapes newlines inside the values it serialises.
 */
function escapeNewlines(value: string): string {
  return value.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(prefix = "fizzy-mcp") {
    // Escaped here too so the one-record-per-line guarantee holds structurally,
    // not just for the prefixes this repo happens to pass.
    this.prefix = escapeNewlines(prefix);
    this.level = (process.env.LOG_LEVEL as LogLevel) || "info";
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    return `[${timestamp}] [${this.prefix}] [${level.toUpperCase()}] ${escapeNewlines(message)}${dataStr}`;
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog("debug")) {
      console.error(this.formatMessage("debug", message, data));
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog("info")) {
      console.error(this.formatMessage("info", message, data));
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog("warn")) {
      console.error(this.formatMessage("warn", message, data));
    }
  }

  error(message: string, error?: unknown): void {
    if (this.shouldLog("error")) {
      const errorData =
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : error;
      console.error(this.formatMessage("error", message, errorData));
    }
  }

  /**
   * Create a child logger with a sub-prefix
   */
  child(subPrefix: string): Logger {
    const child = new Logger(`${this.prefix}:${subPrefix}`);
    child.level = this.level;
    return child;
  }

  /**
   * Set the log level dynamically
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

// Export singleton instance
export const logger = new Logger();

// Export class for creating child loggers
export { Logger };

