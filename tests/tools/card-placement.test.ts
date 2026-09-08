/**
 * Card column-placement and tag tests (issue #44).
 *
 * Upstream's `CardsController` permits only
 * `[ :title, :description, :image, :created_at, :last_active_at ]` in the card
 * payload, so `status`, `column_id`, and `tag_ids` are all silently dropped by
 * Rails strong params when sent that way — the same failure mode `assignee_ids`
 * had (issue #9). This pins the replacements: `column_id` goes through
 * `POST /:slug/cards/:number/triage` after the card exists; `tag_ids` are
 * resolved to titles via `fizzy_get_tags` and toggled through
 * `POST /:slug/cards/:number/taggings`, which takes a title, not an id;
 * `status` has no replacement and is simply gone. As with assignments, the
 * result is read back and compared rather than trusting the toggles.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FizzyClient } from "../../src/client/fizzy-client.js";
import { executeToolHandler } from "../../src/tools/handlers.js";

type ClientStub = {
  createCard: ReturnType<typeof vi.fn>;
  updateCard: ReturnType<typeof vi.fn>;
  getCard: ReturnType<typeof vi.fn>;
  getTags: ReturnType<typeof vi.fn>;
  moveCardToColumn: ReturnType<typeof vi.fn>;
  toggleCardTag: ReturnType<typeof vi.fn>;
  toggleCardAssignment: ReturnType<typeof vi.fn>;
};

const CREATED = {
  id: "card-abc",
  number: 14,
  title: "Card",
  url: "https://app.fizzy.do/123456/cards/14",
  assignees: [],
  tags: [],
};

const user = (id: string) => ({ id, name: id });

const TAGS = [
  { id: "tag-1", title: "bug", created_at: "2026-01-01T00:00:00Z", url: "https://app.fizzy.do/123456/tags/tag-1" },
  { id: "tag-2", title: "urgent", created_at: "2026-01-01T00:00:00Z", url: "https://app.fizzy.do/123456/tags/tag-2" },
  // Two distinct ids that happen to resolve to the same title — exercises
  // dedupe-by-title, not just dedupe-by-id.
  { id: "tag-3", title: "duplicate", created_at: "2026-01-01T00:00:00Z", url: "https://app.fizzy.do/123456/tags/tag-3" },
  { id: "tag-4", title: "duplicate", created_at: "2026-01-01T00:00:00Z", url: "https://app.fizzy.do/123456/tags/tag-4" },
];

/** A card payload with the given column, tags, and assignees. */
const withState = (opts: { column?: { id: string }; tags?: unknown[]; assignees?: string[] }) => ({
  ...CREATED,
  column: opts.column,
  tags: opts.tags ?? [],
  assignees: (opts.assignees ?? []).map(user),
  has_more_assignees: false,
});

describe("fizzy_create_card column/tags", () => {
  let client: ClientStub;

  beforeEach(() => {
    client = {
      createCard: vi.fn().mockResolvedValue(CREATED),
      updateCard: vi.fn().mockResolvedValue(undefined),
      getCard: vi.fn(),
      getTags: vi.fn().mockResolvedValue(TAGS),
      moveCardToColumn: vi.fn().mockResolvedValue(undefined),
      toggleCardTag: vi.fn().mockResolvedValue(undefined),
      toggleCardAssignment: vi.fn().mockResolvedValue(undefined),
    };
  });

  const create = (args: Record<string, unknown>) =>
    executeToolHandler(client as unknown as FizzyClient, "fizzy_create_card", {
      account_slug: "123456",
      board_id: "board-1",
      title: "Card",
      ...args,
    });

  it("never sends column_id/tag_ids in the create payload", async () => {
    client.getCard.mockResolvedValue(withState({ column: { id: "col-1" }, tags: ["bug"] }));

    await create({ column_id: "col-1", tag_ids: ["tag-1"] });

    expect(client.createCard).toHaveBeenCalledWith(
      "123456",
      "board-1",
      expect.not.objectContaining({
        column_id: expect.anything(),
        tag_ids: expect.anything(),
      })
    );
  });

  it("rejects status before calling any client method", async () => {
    await expect(create({ status: "draft" })).rejects.toThrow(/Unsupported field: status/);
    expect(client.createCard).not.toHaveBeenCalled();
    expect(client.getTags).not.toHaveBeenCalled();
  });

  it("makes no getTags/toggle/re-read call when tag_ids is an empty array", async () => {
    await create({ tag_ids: [] });

    expect(client.getTags).not.toHaveBeenCalled();
    expect(client.toggleCardTag).not.toHaveBeenCalled();
    expect(client.getCard).not.toHaveBeenCalled();
  });

  it("moves the created card to the requested column", async () => {
    client.getCard.mockResolvedValue(withState({ column: { id: "col-1" } }));

    const result = (await create({ column_id: "col-1" })) as Record<string, unknown>;

    expect(client.moveCardToColumn).toHaveBeenCalledWith("123456", "14", "col-1");
    expect(result.column).toEqual({ id: "col-1" });
    expect(result.column_warnings).toBeUndefined();
  });

  it("reports a column move failure without discarding the created card", async () => {
    client.moveCardToColumn.mockRejectedValue(new Error("Column not on this board"));
    client.getCard.mockResolvedValue(withState({}));

    const result = (await create({ column_id: "col-bad" })) as Record<string, unknown>;

    expect(result.id).toBe("card-abc");
    expect(result.column_warnings).toEqual([
      "Card was not moved to column col-bad (Column not on this board)",
    ]);
  });

  it("warns when the re-read shows a different column than requested", async () => {
    client.getCard.mockResolvedValue(withState({ column: { id: "col-other" } }));

    const result = (await create({ column_id: "col-1" })) as Record<string, unknown>;

    expect(result.column_warnings).toEqual(["Card was not moved to column col-1"]);
  });

  it("calls getTags before createCard when tag_ids is given", async () => {
    const callOrder: string[] = [];
    client.getTags.mockImplementation(async () => {
      callOrder.push("getTags");
      return TAGS;
    });
    client.createCard.mockImplementation(async () => {
      callOrder.push("createCard");
      return CREATED;
    });
    client.getCard.mockResolvedValue(withState({ tags: ["bug"] }));

    await create({ tag_ids: ["tag-1"] });

    expect(callOrder).toEqual(["getTags", "createCard"]);
    // Toggled by title, not id — the endpoint takes a title.
    expect(client.toggleCardTag).toHaveBeenCalledWith("123456", "14", "bug");
  });

  it("throws on an unknown tag id and never creates the card", async () => {
    await expect(create({ tag_ids: ["tag-missing"] })).rejects.toThrow(/Unknown tag id/);
    expect(client.createCard).not.toHaveBeenCalled();
  });

  it("toggles a duplicate tag id only once", async () => {
    client.getCard.mockResolvedValue(withState({ tags: ["bug"] }));

    await create({ tag_ids: ["tag-1", "tag-1"] });

    expect(client.toggleCardTag).toHaveBeenCalledTimes(1);
  });

  it("warns when a requested tag is missing from the re-read", async () => {
    client.getCard.mockResolvedValue(withState({ tags: [] }));

    const result = (await create({ tag_ids: ["tag-1"] })) as Record<string, unknown>;

    expect(result.tag_warnings).toEqual(['Tag "bug" was requested but is not present']);
  });

  it("makes exactly one re-read when column, tags, and assignees are all requested", async () => {
    client.getCard.mockResolvedValue(
      withState({ column: { id: "col-1" }, tags: ["bug"], assignees: ["u1"] })
    );

    const result = (await create({
      column_id: "col-1",
      tag_ids: ["tag-1"],
      assignee_ids: ["u1"],
    })) as Record<string, unknown>;

    expect(client.getCard).toHaveBeenCalledTimes(1);
    // assignment_warnings shape is unchanged by this feature: absent on success.
    expect(result.assignment_warnings).toBeUndefined();
    expect(result.column_warnings).toBeUndefined();
    expect(result.tag_warnings).toBeUndefined();
  });

  it("names the fallback tools when the created card's number can't be read", async () => {
    client.createCard.mockResolvedValue({ id: "card-abc", title: "Card" });

    const result = (await create({
      column_id: "col-1",
      tag_ids: ["tag-1"],
    })) as Record<string, unknown>;

    expect(client.moveCardToColumn).not.toHaveBeenCalled();
    expect(client.toggleCardTag).not.toHaveBeenCalled();
    expect(result.column_warnings).toEqual([expect.stringContaining("fizzy_move_card_to_column")]);
    expect(result.tag_warnings).toEqual([expect.stringContaining("fizzy_toggle_card_tag")]);
  });

  it("rejects a non-array tag_ids before creating anything", async () => {
    await expect(create({ tag_ids: "tag-1" })).rejects.toThrow(
      "tag_ids must be an array of tag ID strings"
    );
    expect(client.createCard).not.toHaveBeenCalled();
  });

  it("rejects a non-string column_id before creating anything", async () => {
    await expect(create({ column_id: 5 })).rejects.toThrow(
      "column_id must be a non-empty string"
    );
    expect(client.createCard).not.toHaveBeenCalled();
  });
});

describe("fizzy_update_card column/tags", () => {
  let client: ClientStub;

  beforeEach(() => {
    client = {
      createCard: vi.fn(),
      updateCard: vi.fn().mockResolvedValue(undefined),
      getCard: vi.fn().mockResolvedValue(withState({ column: { id: "col-1" }, tags: ["bug"] })),
      getTags: vi.fn().mockResolvedValue(TAGS),
      moveCardToColumn: vi.fn().mockResolvedValue(undefined),
      toggleCardTag: vi.fn().mockResolvedValue(undefined),
      toggleCardAssignment: vi.fn().mockResolvedValue(undefined),
    };
  });

  const update = (args: Record<string, unknown>) =>
    executeToolHandler(client as unknown as FizzyClient, "fizzy_update_card", {
      account_slug: "123456",
      card_id: "14",
      ...args,
    });

  it("diffs tag_ids against current tags given as plain strings", async () => {
    client.getCard
      .mockResolvedValueOnce(withState({ tags: ["bug"] }))
      .mockResolvedValueOnce(withState({ tags: ["urgent"] }));

    await update({ tag_ids: ["tag-2"] });

    expect(client.toggleCardTag.mock.calls).toEqual([
      ["123456", "14", "urgent"], // added
      ["123456", "14", "bug"], // removed
    ]);
  });

  it("diffs tag_ids against current tags given as {title} objects", async () => {
    client.getCard
      .mockResolvedValueOnce(withState({ tags: [{ id: "tag-1", title: "bug" }] }))
      .mockResolvedValueOnce(withState({ tags: ["urgent"] }));

    await update({ tag_ids: ["tag-2"] });

    expect(client.toggleCardTag.mock.calls).toEqual([
      ["123456", "14", "urgent"],
      ["123456", "14", "bug"],
    ]);
  });

  it("removes all tags when tag_ids is an empty array", async () => {
    client.getCard
      .mockResolvedValueOnce(withState({ tags: ["bug", "urgent"] }))
      .mockResolvedValueOnce(withState({ tags: [] }));

    await update({ tag_ids: [] });

    // Nothing to resolve for an empty set, so no lookup is needed.
    expect(client.getTags).not.toHaveBeenCalled();
    expect(client.toggleCardTag.mock.calls).toEqual([
      ["123456", "14", "bug"],
      ["123456", "14", "urgent"],
    ]);
  });

  it("throws on an unknown tag id before updateCard or getCard is called", async () => {
    await expect(update({ title: "New", tag_ids: ["tag-missing"] })).rejects.toThrow(
      /Unknown tag id/
    );
    expect(client.updateCard).not.toHaveBeenCalled();
    expect(client.getCard).not.toHaveBeenCalled();
  });

  it("does not move when column_id matches the current column", async () => {
    client.getCard.mockResolvedValue(withState({ column: { id: "col-1" } }));

    const result = await update({ column_id: "col-1" });

    expect(client.moveCardToColumn).not.toHaveBeenCalled();
    // A no-op is still reported as a positive outcome, distinct from an
    // actual move.
    expect(result).toBe("Card 14 updated successfully (already in column col-1)");
  });

  it("rejects status before calling any client method", async () => {
    await expect(update({ status: "draft", title: "New" })).rejects.toThrow(
      /Unsupported field: status/
    );
    expect(client.getCard).not.toHaveBeenCalled();
    expect(client.updateCard).not.toHaveBeenCalled();
  });

  it("toggles a title only once when two distinct ids resolve to it", async () => {
    client.getCard
      .mockResolvedValueOnce(withState({ tags: [] }))
      .mockResolvedValueOnce(withState({ tags: ["duplicate"] }));

    await update({ tag_ids: ["tag-3", "tag-4"] });

    expect(client.toggleCardTag).toHaveBeenCalledTimes(1);
    expect(client.toggleCardTag).toHaveBeenCalledWith("123456", "14", "duplicate");
  });

  it("reports a rejected column move with the warnings prefix and names the reason", async () => {
    client.moveCardToColumn.mockRejectedValue(new Error("Column not on this board"));
    client.getCard
      .mockResolvedValueOnce(withState({ column: { id: "col-1" } }))
      .mockResolvedValueOnce(withState({ column: { id: "col-1" } }));

    const result = (await update({ column_id: "col-2" })) as string;

    expect(result).toContain("Card 14 update completed with warnings");
    expect(result).not.toContain("updated successfully");
    expect(result).toContain("Card was not moved to column col-2 (Column not on this board)");
  });

  it("keeps running the assignment toggle after a tag toggle fails and the tag is still missing on re-read", async () => {
    client.toggleCardTag.mockRejectedValueOnce(new Error("Resource not found"));
    client.getCard
      .mockResolvedValueOnce(withState({ tags: [], assignees: [] }))
      .mockResolvedValueOnce(withState({ tags: [], assignees: ["u1"] }));

    const result = (await update({ tag_ids: ["tag-1"], assignee_ids: ["u1"] })) as string;

    expect(client.toggleCardAssignment).toHaveBeenCalledWith("123456", "14", "u1");
    expect(result).toContain("Card 14 update completed with warnings");
    expect(result).toContain('Tag "bug" was requested but is not present (Resource not found)');
    expect(result).toContain("assignees: 1 added, 0 removed");
  });

  it("warns about a column mismatch on re-read even when the move call itself did not error", async () => {
    client.getCard
      .mockResolvedValueOnce(withState({ column: { id: "col-1" } }))
      .mockResolvedValueOnce(withState({ column: { id: "col-other" } }));

    const result = (await update({ column_id: "col-2" })) as string;

    expect(client.moveCardToColumn).toHaveBeenCalledWith("123456", "14", "col-2");
    expect(result).toContain("Card 14 update completed with warnings");
    expect(result).toContain("Card was not moved to column col-2");
    // Only a positive outcome belongs in the parenthetical; a mismatch is
    // reported once, as a warning, not also as a "not moved" part.
    expect(result).not.toContain("(column not moved");
  });

  it("reports the new generic wording when the final re-read fails with column and tags requested", async () => {
    client.getCard
      .mockResolvedValueOnce(withState({ column: { id: "col-1" }, tags: [] }))
      .mockRejectedValueOnce(new Error("boom"));

    const result = (await update({ column_id: "col-2", tag_ids: ["tag-1"] })) as string;

    expect(result).toContain(
      "Card 14 update completed, but the requested post-update state could not be verified (boom)"
    );
  });

  it("moves when column_id differs from the current column", async () => {
    client.getCard
      .mockResolvedValueOnce(withState({ column: { id: "col-1" } }))
      .mockResolvedValueOnce(withState({ column: { id: "col-2" } }));

    await update({ column_id: "col-2" });

    expect(client.moveCardToColumn).toHaveBeenCalledWith("123456", "14", "col-2");
  });

  it("does not call updateCard when only column_id/tag_ids are given", async () => {
    client.getCard.mockResolvedValue(withState({ column: { id: "col-1" }, tags: ["bug"] }));

    await update({ column_id: "col-2", tag_ids: ["tag-2"] });

    expect(client.updateCard).not.toHaveBeenCalled();
  });

  it("lists all six fields in the 'no changes' error", async () => {
    await expect(update({})).rejects.toThrow(
      "No changes given for card 14. Pass at least one of title, description, due_on, " +
      "column_id, tag_ids or assignee_ids."
    );
  });

  it("rejects a non-array tag_ids before touching the card", async () => {
    await expect(update({ tag_ids: "tag-1" })).rejects.toThrow(
      "tag_ids must be an array of tag ID strings"
    );
    expect(client.getCard).not.toHaveBeenCalled();
    expect(client.updateCard).not.toHaveBeenCalled();
  });

  it("rejects a non-string column_id before touching the card", async () => {
    await expect(update({ column_id: 5 })).rejects.toThrow(
      "column_id must be a non-empty string"
    );
    expect(client.getCard).not.toHaveBeenCalled();
    expect(client.updateCard).not.toHaveBeenCalled();
  });
});
