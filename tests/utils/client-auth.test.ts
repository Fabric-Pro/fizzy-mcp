/**
 * Tests for the shared client-authentication helpers
 *
 * The comparison used to gate `MCP_AUTH_TOKEN` on both deployments, so its
 * behaviour has to be exactly that of `===` — the non-short-circuiting part is
 * unobservable from outside, but a wrong answer is an auth bypass.
 */

import { describe, it, expect } from "vitest";
import {
  CLIENT_AUTH_HEADER,
  CLIENT_AUTH_HEADER_LOWER,
  timingSafeEqualString,
} from "../../src/utils/client-auth.js";

describe("client-auth constants", () => {
  it("should expose the lowercased header name Node's req.headers is keyed by", () => {
    expect(CLIENT_AUTH_HEADER_LOWER).toBe(CLIENT_AUTH_HEADER.toLowerCase());
  });
});

describe("timingSafeEqualString", () => {
  it("should return true for equal strings", () => {
    expect(timingSafeEqualString("secret-token", "secret-token")).toBe(true);
  });

  it("should return false for different strings of equal length", () => {
    expect(timingSafeEqualString("secret-token", "secret-tokeN")).toBe(false);
  });

  it("should return false when only the first byte differs", () => {
    expect(timingSafeEqualString("aaaaaaaa", "baaaaaaa")).toBe(false);
  });

  it("should return false when only the last byte differs", () => {
    expect(timingSafeEqualString("aaaaaaaa", "aaaaaaab")).toBe(false);
  });

  it("should return false for strings of different lengths", () => {
    expect(timingSafeEqualString("secret", "secret-token")).toBe(false);
    expect(timingSafeEqualString("secret-token", "secret")).toBe(false);
  });

  it("should treat a prefix as a mismatch, not a match", () => {
    expect(timingSafeEqualString("secret-token", "secret-token-extra")).toBe(false);
  });

  it("should return true for two empty strings", () => {
    expect(timingSafeEqualString("", "")).toBe(true);
  });

  it("should return false when only one side is empty", () => {
    expect(timingSafeEqualString("", "secret")).toBe(false);
    expect(timingSafeEqualString("secret", "")).toBe(false);
  });

  // Comparison is over UTF-8 bytes, so multi-byte input must round-trip and
  // must not be truncated or compared by code-unit count.
  it("should compare multi-byte UTF-8 correctly", () => {
    expect(timingSafeEqualString("tökén-🔐", "tökén-🔐")).toBe(true);
    expect(timingSafeEqualString("tökén-🔐", "tökén-🔓")).toBe(false);
  });

  it("should distinguish strings of equal code-unit length but different byte length", () => {
    // "é" is two UTF-8 bytes, "e" is one: same string length, different byte length.
    expect("é".length).toBe("e".length);
    expect(timingSafeEqualString("é", "e")).toBe(false);
  });
});
