/**
 * CloudflareLogger Tests
 *
 * Tests for the structured audit logger, focused on argument sanitization —
 * `logToolInvocation` is the audit trail that lands in Workers console logs
 * and, optionally, R2, so a leak here is a leak into persistent storage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "../../src/cloudflare/utils/logger.js";

describe("CloudflareLogger.logToolInvocation sanitization", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  function loggedArgs(args: Record<string, unknown>): Record<string, unknown> {
    const logger = createLogger({ consoleOutput: true });
    logger.logToolInvocation("fizzy_upload_file", "acme", args, {
      success: true,
      durationMs: 12,
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [line] = infoSpy.mock.calls[0] as [string];
    return JSON.parse(line).args;
  }

  it("never logs base64_data content, but reports its length", () => {
    const base64Data = "A".repeat(1234);
    const sanitized = loggedArgs({ base64_data: base64Data, filename: "a.png" });

    expect(JSON.stringify(sanitized)).not.toContain(base64Data);
    expect(sanitized.base64_data).toBe("[redacted: 1234 chars]");
  });

  it("redacts base64_data as [REDACTED] when it is not a string", () => {
    const sanitized = loggedArgs({ base64_data: 12345 });
    expect(sanitized.base64_data).toBe("[REDACTED]");
  });

  it("redacts file_path outright", () => {
    const sanitized = loggedArgs({ file_path: "/Users/alice/secret-plans.pdf" });
    expect(sanitized.file_path).toBe("[REDACTED]");
  });

  it("redacts base64_data and file_path regardless of key casing", () => {
    // The Cloudflare transport logs raw, unvalidated arguments — including on
    // failed calls — so a differently-cased key must not fall through to the
    // generic 500-char truncation and leak content.
    const base64Data = "B".repeat(999);
    const sanitized = loggedArgs({ Base64_Data: base64Data, FILE_PATH: "/etc/passwd" });

    expect(JSON.stringify(sanitized)).not.toContain(base64Data);
    expect(sanitized.Base64_Data).toBe("[redacted: 999 chars]");
    expect(sanitized.FILE_PATH).toBe("[REDACTED]");
  });

  it("still redacts existing sensitive keys", () => {
    const sanitized = loggedArgs({
      password: "hunter2",
      api_token: "abc123",
      client_secret: "shh",
      api_key: "xyz",
      Authorization: "Bearer abc",
    });

    expect(sanitized.password).toBe("[REDACTED]");
    expect(sanitized.api_token).toBe("[REDACTED]");
    expect(sanitized.client_secret).toBe("[REDACTED]");
    expect(sanitized.api_key).toBe("[REDACTED]");
    expect(sanitized.Authorization).toBe("[REDACTED]");
  });

  it("still truncates other long strings at 500 chars", () => {
    const longValue = "x".repeat(600);
    const sanitized = loggedArgs({ description: longValue });

    expect(sanitized.description).toBe("x".repeat(500) + "...[truncated]");
  });

  it("passes other args through unchanged", () => {
    const sanitized = loggedArgs({ account_slug: "acme", card_number: 7 });

    expect(sanitized.account_slug).toBe("acme");
    expect(sanitized.card_number).toBe(7);
  });
});
