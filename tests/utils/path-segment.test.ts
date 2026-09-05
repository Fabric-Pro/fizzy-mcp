/**
 * The path-segment containment guard every non-slug id in fizzy-client.ts is
 * checked with.
 *
 * Mirrors tests/utils/account-slug.test.ts: this is the shared rule, so its
 * own behaviour is asserted here once, and tests/client/fizzy-client.test.ts
 * and tests/client/path-segments.test.ts assert that the client actually
 * calls it everywhere it needs to.
 */

import { describe, it, expect } from "vitest";
import { assertPathSegment } from "../../src/utils/path-segment.js";

describe("assertPathSegment", () => {
  it("returns a bare value unchanged", () => {
    expect(assertPathSegment("123456", "board_id")).toBe("123456");
  });

  it("accepts a 25-character base36 id — the shape every real Fizzy id has", () => {
    // Fabricated, not a real id: base36-encoded UUIDv7, 25 characters from
    // [0-9a-z]. See utils/path-segment.ts for where this shape is confirmed.
    const id = "0000000000000000000000abc";
    expect(id).toHaveLength(25);
    expect(assertPathSegment(id, "board_id")).toBe(id);
  });

  it("accepts a plain card number", () => {
    // Card paths resolve by number, not by id — a small plain integer.
    expect(assertPathSegment("42", "card_number")).toBe("42");
  });

  it("accepts the full character set a path segment may legitimately use", () => {
    expect(assertPathSegment("abc-DEF_123.456~789", "board_id")).toBe(
      "abc-DEF_123.456~789"
    );
  });

  it.each([
    ["empty", ""],
    ["the current directory", "."],
    ["a parent traversal", ".."],
  ])("rejects %s", (_label, value) => {
    expect(() => assertPathSegment(value, "board_id")).toThrow(/board_id/);
  });

  it.each([
    ["extra path segments", "123456/cards"],
    ["an embedded traversal", "123456/../999999"],
    ["a query string", "123456?admin=1"],
    ["a fragment", "123456#x"],
    ["an encoded separator", "123456%2Fcards"],
    ["a backslash", "123456\\cards"],
    ["whitespace", "123 456"],
    ["a newline", "123456\ncards"],
  ])("rejects %s", (_label, value) => {
    expect(() => assertPathSegment(value, "board_id")).toThrow(/board_id/);
  });

  it("rejects a value over the length cap", () => {
    expect(() => assertPathSegment("a".repeat(257), "board_id")).toThrow(/board_id/);
  });

  it("accepts a value at exactly the length cap", () => {
    const value = "a".repeat(256);
    expect(assertPathSegment(value, "board_id")).toBe(value);
  });

  it("names the MCP-facing argument in the message, not the value", () => {
    expect(() => assertPathSegment("../cards/42", "card_number")).toThrow(/card_number/);
  });

  it("does not leak the rejected value back to the caller", () => {
    // The message is returned to the model verbatim; echoing the input would
    // reflect whatever the caller sent into the tool result.
    const secret = "https://evil.example/x?leaked=1";
    try {
      assertPathSegment(secret, "board_id");
      throw new Error("expected assertPathSegment to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(secret);
      expect(message).not.toContain("evil.example");
    }
  });
});
