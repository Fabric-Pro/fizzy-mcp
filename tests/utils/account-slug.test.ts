/**
 * The account_slug rule, which every tool's request path is built from.
 *
 * These cases are the reason the rule is shared rather than duplicated: the
 * traversal and separator inputs below were refused on the attachment path and
 * accepted on all thirty-odd other client methods, because only the attachment
 * path validated. The suite asserts the rule itself, and tests/client and
 * tests/tools assert that each side actually calls it.
 */

import { describe, it, expect } from "vitest";
import { normalizeAccountSlug } from "../../src/utils/account-slug.js";

describe("normalizeAccountSlug", () => {
  it("returns a bare slug unchanged", () => {
    expect(normalizeAccountSlug("123456")).toBe("123456");
  });

  it("strips the leading slash Fizzy's own responses carry", () => {
    // fizzy_get_identity returns accounts with slugs like "/123456", and callers
    // pass those straight back into the next tool call.
    expect(normalizeAccountSlug("/123456")).toBe("123456");
  });

  it("accepts the full character set a slug may legitimately use", () => {
    expect(normalizeAccountSlug("my-account_v1.2")).toBe("my-account_v1.2");
  });

  it.each([
    ["empty", ""],
    ["a lone slash", "/"],
    ["the current directory", "."],
    ["a parent traversal", ".."],
    ["a leading-slash traversal", "/.."],
  ])("rejects %s", (_label, value) => {
    expect(() => normalizeAccountSlug(value)).toThrow(/required and must be an account slug/);
  });

  it.each([
    ["extra path segments", "123456/cards"],
    ["an embedded traversal", "123456/../999999"],
    ["a query string", "123456?admin=1"],
    ["a fragment", "123456#x"],
    ["an encoded separator", "123456%2Fcards"],
    ["a protocol-relative host", "//evil.example"],
    ["an absolute URL", "https://evil.example/123456"],
    ["a backslash", "123456\\cards"],
    ["whitespace", "123 456"],
    ["a newline", "123456\ncards"],
  ])("rejects %s", (_label, value) => {
    expect(() => normalizeAccountSlug(value)).toThrow(/not a path or URL/);
  });

  it("does not leak the rejected value back to the caller", () => {
    // The message is returned to the model verbatim; echoing the input would
    // reflect whatever the caller sent into the tool result.
    expect(() => normalizeAccountSlug("https://evil.example/x")).toThrow(
      "account_slug must be an account slug such as '123456', not a path or URL"
    );
  });
});
