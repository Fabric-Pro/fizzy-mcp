/**
 * Card assignment tests
 *
 * Upstream's CardsController permits only
 * `[ :title, :description, :image, :created_at, :last_active_at ]`, so an
 * `assignee_ids` key inside the card payload is dropped by Rails strong params
 * and the card comes back unassigned with no error anywhere. These tests pin
 * the behaviour that replaces it: assignments go through
 * `POST /:slug/cards/:number/assignments` after the card exists, and the
 * resulting roster is read back rather than inferred from the toggles.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FizzyClient } from "../../src/client/fizzy-client.js";
import { executeToolHandler } from "../../src/tools/handlers.js";

type ClientStub = {
  createCard: ReturnType<typeof vi.fn>;
  updateCard: ReturnType<typeof vi.fn>;
  getCard: ReturnType<typeof vi.fn>;
  toggleCardAssignment: ReturnType<typeof vi.fn>;
};

const CREATED = {
  id: "card-abc",
  number: 14,
  title: "Card",
  url: "https://app.fizzy.do/123456/cards/14",
  assignees: [],
};

const user = (id: string) => ({ id, name: id });

/** A card payload whose assignee roster is exactly `ids`. */
const withAssignees = (...ids: string[]) => ({
  ...CREATED,
  assignees: ids.map(user),
  has_more_assignees: false,
});

describe("fizzy_create_card assignments", () => {
  let client: ClientStub;

  beforeEach(() => {
    client = {
      createCard: vi.fn().mockResolvedValue(CREATED),
      updateCard: vi.fn().mockResolvedValue(undefined),
      getCard: vi.fn(),
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

  it("never sends assignee_ids in the create payload", async () => {
    client.getCard.mockResolvedValue(withAssignees("u1"));

    await create({ assignee_ids: ["u1"] });

    expect(client.createCard).toHaveBeenCalledWith(
      "123456",
      "board-1",
      expect.not.objectContaining({ assignee_ids: expect.anything() })
    );
  });

  it("assigns each user through the assignments endpoint", async () => {
    client.getCard.mockResolvedValue(withAssignees("u1", "u2"));

    const result = (await create({ assignee_ids: ["u1", "u2"] })) as Record<string, unknown>;

    expect(client.toggleCardAssignment.mock.calls).toEqual([
      ["123456", "14", "u1"],
      ["123456", "14", "u2"],
    ]);
    // Re-read so the response shows the assignees that now exist; the create
    // response is rendered before any of them do.
    expect(client.getCard).toHaveBeenCalledWith("123456", "14");
    expect(result.assignees).toEqual([user("u1"), user("u2")]);
    expect(result.assignment_warnings).toBeUndefined();
  });

  it("toggles a repeated id only once", async () => {
    client.getCard.mockResolvedValue(withAssignees("u1"));

    await create({ assignee_ids: ["u1", "u1"] });

    expect(client.toggleCardAssignment).toHaveBeenCalledTimes(1);
  });

  it("makes no assignment calls and no extra fetch when assignee_ids is absent", async () => {
    const result = await create({});

    expect(client.toggleCardAssignment).not.toHaveBeenCalled();
    expect(client.getCard).not.toHaveBeenCalled();
    expect(result).toEqual(CREATED);
  });

  it("treats an empty array as no assignments", async () => {
    await create({ assignee_ids: [] });

    expect(client.toggleCardAssignment).not.toHaveBeenCalled();
    expect(client.getCard).not.toHaveBeenCalled();
  });

  it("keeps the created card and reports the users it could not assign", async () => {
    client.toggleCardAssignment
      .mockRejectedValueOnce(new Error("Resource not found"))
      .mockResolvedValueOnce(undefined);
    client.getCard.mockResolvedValue(withAssignees("u2"));

    const result = (await create({ assignee_ids: ["u1", "u2"] })) as Record<string, unknown>;

    expect(result.id).toBe("card-abc");
    expect(result.assignment_warnings).toEqual([
      "User u1 was requested but is not assigned (Resource not found)",
    ]);
  });

  // The endpoint toggles rather than sets, and the HTTP client retries POSTs on
  // ambiguous transport failures — so a request that landed but whose response
  // was lost is sent again and lands on the opposite state, reporting success.
  it("reports a user the toggle claimed to assign but the card came back without", async () => {
    client.getCard.mockResolvedValue(withAssignees("u2"));

    const result = (await create({ assignee_ids: ["u1", "u2"] })) as Record<string, unknown>;

    expect(client.toggleCardAssignment).toHaveBeenCalledTimes(2);
    expect(result.assignment_warnings).toEqual([
      "User u1 was requested but is not assigned",
    ]);
  });

  it("does not treat someone else's assignment as a failure", async () => {
    client.getCard.mockResolvedValue(withAssignees("u1", "someone-else"));

    const result = (await create({ assignee_ids: ["u1"] })) as Record<string, unknown>;

    expect(result.assignment_warnings).toBeUndefined();
  });

  // Over five assignees the card payload reports only the first five, so the
  // requested set cannot be compared against it — only direct failures are known.
  it("reports direct failures and the lost verification when the roster is truncated", async () => {
    client.toggleCardAssignment.mockRejectedValueOnce(new Error("Resource not found"));
    client.getCard.mockResolvedValue({
      ...CREATED,
      assignees: [user("u2"), user("u3"), user("u4"), user("u5"), user("u6")],
      has_more_assignees: true,
    });

    const result = (await create({
      assignee_ids: ["u1", "u2", "u3", "u4", "u5", "u6"],
    })) as Record<string, unknown>;

    expect(result.assignment_warnings).toEqual([
      expect.stringContaining("could not be verified"),
      "Assignment change for user u1 failed: Resource not found",
    ]);
  });

  // Without this the response is warning-free while a requested user may be
  // missing: the toggles all "succeeded", and the truncated roster cannot say
  // otherwise. Silence would read as confirmation.
  it("says the result is unverified when the roster is truncated and nothing failed", async () => {
    client.getCard.mockResolvedValue({
      ...CREATED,
      assignees: [user("u1"), user("u2"), user("u3"), user("u4"), user("u5")],
      has_more_assignees: true,
    });

    const result = (await create({
      assignee_ids: ["u1", "u2", "u3", "u4", "u5", "u6"],
    })) as Record<string, unknown>;

    expect(result.assignment_warnings).toEqual([
      expect.stringContaining("could not be verified"),
    ]);
  });

  it("warns instead of throwing when the card cannot be re-read", async () => {
    client.getCard.mockRejectedValue(new Error("boom"));

    const result = (await create({ assignee_ids: ["u1"] })) as Record<string, unknown>;

    expect(result.id).toBe("card-abc");
    expect(result.assignment_warnings).toEqual([
      expect.stringContaining("could not be re-read"),
    ]);
  });

  it("falls back to the card URL when the response omits the number", async () => {
    client.createCard.mockResolvedValue({ ...CREATED, number: undefined });
    client.getCard.mockResolvedValue(withAssignees("u1"));

    await create({ assignee_ids: ["u1"] });

    expect(client.toggleCardAssignment).toHaveBeenCalledWith("123456", "14", "u1");
  });

  it("reports rather than silently skips when no card number can be found", async () => {
    client.createCard.mockResolvedValue({ id: "card-abc", title: "Card" });

    const result = (await create({ assignee_ids: ["u1"] })) as Record<string, unknown>;

    expect(client.toggleCardAssignment).not.toHaveBeenCalled();
    expect(result.assignment_warnings).toEqual([
      expect.stringContaining("number could not be read"),
    ]);
  });

  // The Cloudflare transport executes raw args without zod, so these have to be
  // rejected in the handler rather than at the schema boundary.
  it("rejects a non-array assignee_ids before creating anything", async () => {
    await expect(create({ assignee_ids: "u1" })).rejects.toThrow(
      "assignee_ids must be an array of user ID strings"
    );
    expect(client.createCard).not.toHaveBeenCalled();
  });

  it("rejects null rather than treating it as omitted, matching the zod schema", async () => {
    await expect(create({ assignee_ids: null })).rejects.toThrow(
      "assignee_ids must be an array of user ID strings"
    );
    expect(client.createCard).not.toHaveBeenCalled();
  });

  it("rejects non-string entries in assignee_ids", async () => {
    await expect(create({ assignee_ids: ["u1", 7] })).rejects.toThrow(
      "assignee_ids must contain non-empty user ID strings"
    );
    expect(client.createCard).not.toHaveBeenCalled();
  });

  it("rejects blank entries in assignee_ids", async () => {
    await expect(create({ assignee_ids: ["u1", "  "] })).rejects.toThrow(
      "assignee_ids must contain non-empty user ID strings"
    );
    expect(client.createCard).not.toHaveBeenCalled();
  });
});

describe("fizzy_update_card assignments", () => {
  let client: ClientStub;

  beforeEach(() => {
    client = {
      createCard: vi.fn(),
      updateCard: vi.fn().mockResolvedValue(undefined),
      // Default: the pre-flight read, then the verification read.
      getCard: vi.fn().mockResolvedValue(withAssignees("u1", "u2")),
      toggleCardAssignment: vi.fn().mockResolvedValue(undefined),
    };
  });

  const update = (args: Record<string, unknown>) =>
    executeToolHandler(client as unknown as FizzyClient, "fizzy_update_card", {
      account_slug: "123456",
      card_id: "14",
      ...args,
    });

  it("toggles only the difference between current and desired assignees", async () => {
    client.getCard
      .mockResolvedValueOnce(withAssignees("u1", "u2"))
      .mockResolvedValueOnce(withAssignees("u2", "u3"));

    const result = await update({ assignee_ids: ["u2", "u3"] });

    expect(client.toggleCardAssignment.mock.calls).toEqual([
      ["123456", "14", "u3"], // added
      ["123456", "14", "u1"], // removed
    ]);
    expect(result).toBe("Card 14 updated successfully (assignees: 1 added, 1 removed)");
  });

  it("unassigns everyone for an empty array", async () => {
    client.getCard
      .mockResolvedValueOnce(withAssignees("u1", "u2"))
      .mockResolvedValueOnce(withAssignees());

    const result = await update({ assignee_ids: [] });

    expect(client.toggleCardAssignment.mock.calls).toEqual([
      ["123456", "14", "u1"],
      ["123456", "14", "u2"],
    ]);
    expect(result).toBe("Card 14 updated successfully (assignees: 0 added, 2 removed)");
  });

  it("toggles nothing when the requested roster is already the current one", async () => {
    const result = await update({ assignee_ids: ["u2", "u1"] });

    expect(client.toggleCardAssignment).not.toHaveBeenCalled();
    expect(result).toBe("Card 14 updated successfully (assignees: 0 added, 0 removed)");
  });

  // "Already correct" is a claim about the pre-flight snapshot, so it gets
  // verified like any other — the roster can have moved in between.
  it("still verifies an empty diff, catching a roster that moved underneath it", async () => {
    client.getCard
      .mockResolvedValueOnce(withAssignees("u1"))
      .mockResolvedValueOnce(withAssignees());

    const result = (await update({ assignee_ids: ["u1"] })) as string;

    expect(client.toggleCardAssignment).not.toHaveBeenCalled();
    expect(client.getCard).toHaveBeenCalledTimes(2);
    expect(result).toContain("User u1 was requested but is not assigned");
  });

  it("deduplicates repeated ids before diffing", async () => {
    client.getCard
      .mockResolvedValueOnce(withAssignees("u1"))
      .mockResolvedValueOnce(withAssignees("u1", "u2"));

    const result = await update({ assignee_ids: ["u1", "u2", "u2"] });

    expect(client.toggleCardAssignment.mock.calls).toEqual([["123456", "14", "u2"]]);
    expect(result).toBe("Card 14 updated successfully (assignees: 1 added, 0 removed)");
  });

  it("leaves assignments alone when assignee_ids is omitted", async () => {
    const result = await update({ title: "New title" });

    expect(client.getCard).not.toHaveBeenCalled();
    expect(client.toggleCardAssignment).not.toHaveBeenCalled();
    expect(result).toBe("Card 14 updated successfully");
  });

  it("never sends assignee_ids in the update payload", async () => {
    await update({ title: "New title", assignee_ids: ["u1"] });

    expect(client.updateCard).toHaveBeenCalledWith(
      "123456",
      "14",
      expect.not.objectContaining({ assignee_ids: expect.anything() })
    );
  });

  // The card payload caps `assignees` at five, so a full replacement computed
  // from it would leave the unreported ones assigned.
  it("refuses to replace assignees when the API reports the list is truncated", async () => {
    client.getCard.mockResolvedValue({
      ...CREATED,
      assignees: [user("u1"), user("u2"), user("u3"), user("u4"), user("u5")],
      has_more_assignees: true,
    });

    await expect(update({ title: "New title", assignee_ids: ["u1"] })).rejects.toThrow(
      "more than 5 assignees"
    );
    // Read before write, so the rejected update changed nothing at all.
    expect(client.updateCard).not.toHaveBeenCalled();
    expect(client.toggleCardAssignment).not.toHaveBeenCalled();
  });

  it("reports assignment changes that failed", async () => {
    client.toggleCardAssignment.mockRejectedValueOnce(new Error("Resource not found"));
    client.getCard
      .mockResolvedValueOnce(withAssignees("u1", "u2"))
      .mockResolvedValueOnce(withAssignees("u1", "u2"));

    const result = (await update({ assignee_ids: ["u1", "u2", "u3"] })) as string;

    expect(result).toContain("assignees: 0 added, 0 removed");
    expect(result).toContain("User u3 was requested but is not assigned (Resource not found)");
  });

  // A toggle retried after an ambiguous transport failure lands on the opposite
  // state, and a second caller editing the card does the same. Both show up as a
  // roster that disagrees with what was asked for.
  it("reports a roster that disagrees with the request even when every toggle succeeded", async () => {
    client.getCard
      .mockResolvedValueOnce(withAssignees("u1"))
      .mockResolvedValueOnce(withAssignees("u1"));

    const result = (await update({ assignee_ids: ["u2"] })) as string;

    expect(result).toContain("User u2 was requested but is not assigned");
    expect(result).toContain("User u1 is still assigned");
  });

  it("reports that it could not verify when the read-back fails", async () => {
    client.getCard
      .mockResolvedValueOnce(withAssignees("u1"))
      .mockRejectedValueOnce(new Error("boom"));

    const result = (await update({ assignee_ids: ["u2"] })) as string;

    expect(result).toContain("could not be verified (boom)");
  });

  it("reports that it could not verify when the new roster exceeds the reported limit", async () => {
    client.getCard.mockResolvedValueOnce(withAssignees("u1")).mockResolvedValueOnce({
      ...CREATED,
      assignees: [user("u1"), user("u2"), user("u3"), user("u4"), user("u5")],
      has_more_assignees: true,
    });

    const result = (await update({
      assignee_ids: ["u1", "u2", "u3", "u4", "u5", "u6"],
    })) as string;

    expect(result).toContain("could not be verified");
    expect(result).toContain("more than 5 assignees");
  });

  it("rejects malformed assignee_ids before touching the card", async () => {
    for (const bad of [null, "u1", ["u1", 7], ["u1", ""]]) {
      client.getCard.mockClear();
      client.updateCard.mockClear();

      await expect(update({ assignee_ids: bad })).rejects.toThrow(/assignee_ids must/);
      expect(client.getCard).not.toHaveBeenCalled();
      expect(client.updateCard).not.toHaveBeenCalled();
    }
  });
});
