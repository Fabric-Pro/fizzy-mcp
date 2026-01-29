/**
 * Integration test to verify refactored server works correctly
 */

import { describe, it, expect } from "vitest";
import { createFizzyServer } from "../src/server.js";
import { FizzyClient } from "../src/client/fizzy-client.js";
import { ALL_TOOLS } from "../src/tools/definitions.js";

describe("Refactored Server Verification", () => {
  it("should create server without errors", () => {
    const client = new FizzyClient({
      apiToken: "test-token",
      baseURL: "https://api.fizzy.com",
    });

    expect(() => createFizzyServer(client)).not.toThrow();
  });

  it("should have all 49 tools defined in definitions.ts", () => {
    expect(ALL_TOOLS).toHaveLength(49);
  });

  it("should have all tools with required metadata", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.name.length).toBeLessThanOrEqual(128);
      expect(/^[A-Za-z0-9_\-.]+$/.test(tool.name)).toBe(true);

      expect(tool.title).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.schema).toBeTruthy();
      expect(tool.annotations).toBeTruthy();
      expect(typeof tool.annotations.readOnlyHint).toBe("boolean");
      expect(typeof tool.annotations.destructiveHint).toBe("boolean");
    }
  });

  it("should have correct annotation patterns", () => {
    // All GET/LIST tools should be readOnly
    const readOnlyTools = ALL_TOOLS.filter(
      (t) => t.name.includes("_get_") || t.name.includes("_list_")
    );
    for (const tool of readOnlyTools) {
      expect(tool.annotations.readOnlyHint).toBe(true);
    }

    // All DELETE tools should be destructive
    const deleteTools = ALL_TOOLS.filter((t) => t.name.includes("_delete_"));
    for (const tool of deleteTools) {
      expect(tool.annotations.destructiveHint).toBe(true);
    }
  });

  it("should have unique tool names", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it("should have all expected tool categories", () => {
    const identityTools = ALL_TOOLS.filter((t) =>
      t.name.startsWith("fizzy_get_identity") || t.name.startsWith("fizzy_get_accounts")
    );
    expect(identityTools.length).toBeGreaterThan(0);

    const boardTools = ALL_TOOLS.filter((t) => t.name.includes("_board"));
    expect(boardTools.length).toBeGreaterThan(0);

    const cardTools = ALL_TOOLS.filter((t) => t.name.includes("_card"));
    expect(cardTools.length).toBeGreaterThan(0);

    const commentTools = ALL_TOOLS.filter((t) => t.name.includes("_comment"));
    expect(commentTools.length).toBeGreaterThan(0);
  });
});
