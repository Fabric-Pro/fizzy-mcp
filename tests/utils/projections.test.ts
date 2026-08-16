/**
 * Tests for src/utils/projections.ts — the fields="summary" projections used
 * by fizzy_get_cards, fizzy_get_card_comments, and fizzy_get_notifications.
 *
 * Fixtures are built from the real, live-API response shapes (including
 * fields the `Fizzy*` interfaces in src/client/types.ts do not model), not
 * from the declared interfaces — the whole point of the summarizers is that
 * they cannot rely on those interfaces being complete or correct.
 */

import {
  parseFieldsMode,
  summarizeCard,
  summarizeComment,
  summarizeNotification,
} from "../../src/utils/projections.js";

// ---- Fixtures -------------------------------------------------------------

const longDescription = "A".repeat(250);

/** A card as the live API actually returns it — richer than FizzyCard. */
const fullCard = {
  id: "123",
  number: 42,
  title: "Fix the thing",
  description: longDescription,
  description_html: `<p>${longDescription}</p>`,
  status: "published",
  board: { id: "b1", name: "Engineering", cards_count: 99 },
  // column.color is an object on the real API, not the string FizzyColumn claims.
  column: { id: "c1", name: "In Progress", color: { name: "blue", value: "#123456" } },
  creator: { id: "u1", name: "Alice", role: "member", email_address: "alice@example.com" },
  assignees: [
    { id: "u2", name: "Bob", role: "member", email_address: "bob@example.com" },
    { id: "u3", name: "Carol", role: "member", email_address: "carol@example.com" },
  ],
  tags: [
    { id: "t1", title: "bug", created_at: "2026-01-01T00:00:00Z", url: "https://example.com/tags/t1" },
  ],
  due_on: "2026-02-01",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  // Unmodeled fields confirmed present on real responses:
  last_active_at: "2026-01-03T00:00:00Z",
  closed: false,
  postponed: false,
  golden: true,
  has_attachments: true,
  has_more_assignees: false,
  image_url: "https://example.com/cards/42/image.png",
  comments_url: "https://example.com/cards/42/comments",
  reactions_url: "https://example.com/cards/42/reactions",
  url: "https://example.com/cards/42",
};

/** A comment as the live API returns it. */
const fullComment = {
  id: "cm1",
  body: { plain_text: "Looks good to me.", html: "<p>Looks good to me.</p>" },
  creator: { id: "u1", name: "Alice", role: "member", email_address: "alice@example.com" },
  // The same card object repeated on every comment row.
  card: {
    id: "123",
    number: 42,
    title: "Fix the thing",
    status: "published",
    url: "https://example.com/cards/42",
  },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  reactions_url: "https://example.com/comments/cm1/reactions",
  url: "https://example.com/comments/cm1",
};

/** A notification as the live API returns it. */
const fullNotification = {
  id: "n1",
  title: "New comment on Fix the thing",
  body: "Alice commented on card #42",
  read: false,
  read_at: null,
  created_at: "2026-01-01T00:00:00Z",
  url: "https://example.com/notifications/n1",
  unread_count: 5,
  source_type: "Comment",
  creator: { id: "u1", name: "Alice", role: "member", email_address: "alice@example.com" },
  card: {
    id: "123",
    number: 42,
    title: "Fix the thing",
    status: "published",
    url: "https://example.com/cards/42",
    closed: false,
    postponed: false,
    board_name: "Engineering",
    // Nested column object — dropped entirely in summary mode.
    column: { id: "c1", name: "In Progress", color: { name: "blue", value: "#123456" } },
  },
};

// ---- parseFieldsMode --------------------------------------------------------

describe("parseFieldsMode", () => {
  it("defaults to full when the value is undefined", () => {
    expect(parseFieldsMode(undefined)).toBe("full");
  });

  it("accepts both valid values", () => {
    expect(parseFieldsMode("summary")).toBe("summary");
    expect(parseFieldsMode("full")).toBe("full");
  });

  it("throws on a bogus string value", () => {
    expect(() => parseFieldsMode("compact")).toThrow(/summary.*full|full.*summary/i);
  });

  it("throws on a non-string value", () => {
    expect(() => parseFieldsMode(123)).toThrow();
    expect(() => parseFieldsMode({})).toThrow();
    expect(() => parseFieldsMode(null)).toThrow();
  });
});

// ---- full mode is an untouched passthrough ---------------------------------
//
// This mirrors the gating in tools/handlers.ts: fields is resolved via
// parseFieldsMode, and only "summary" reaches the summarizers at all — "full"
// (including the omitted-arg default) returns exactly what the client sent,
// by identity of content.

describe("full mode (fields omitted) leaves the payload byte-for-byte unchanged", () => {
  it("card", () => {
    const mode = parseFieldsMode(undefined);
    const result = mode === "full" ? fullCard : summarizeCard(fullCard);
    expect(result).toEqual(fullCard);
  });

  it("comment", () => {
    const mode = parseFieldsMode(undefined);
    const result = mode === "full" ? fullComment : summarizeComment(fullComment);
    expect(result).toEqual(fullComment);
  });

  it("notification", () => {
    const mode = parseFieldsMode(undefined);
    const result = mode === "full" ? fullNotification : summarizeNotification(fullNotification);
    expect(result).toEqual(fullNotification);
  });

  it("CardsPage envelope (page, total_count, has_more, next_page) passes through untouched too", () => {
    const page = {
      cards: [fullCard],
      page: 1,
      total_count: 293,
      has_more: true,
      next_page: 2,
    };
    const mode = parseFieldsMode(undefined);
    const result =
      mode === "full"
        ? page
        : {
            cards: page.cards.map(summarizeCard),
            page: page.page,
            total_count: page.total_count,
            has_more: page.has_more,
            next_page: page.next_page,
          };
    expect(result).toEqual(page);
  });
});

// ---- summarizeCard ----------------------------------------------------------

describe("summarizeCard", () => {
  it("drops description and description_html", () => {
    const summary = summarizeCard(fullCard);
    expect(summary).not.toHaveProperty("description");
    expect(summary).not.toHaveProperty("description_html");
  });

  it("also drops comments_url, reactions_url, and image_url", () => {
    const summary = summarizeCard(fullCard);
    expect(summary).not.toHaveProperty("comments_url");
    expect(summary).not.toHaveProperty("reactions_url");
    expect(summary).not.toHaveProperty("image_url");
  });

  it("truncates description_preview to 200 chars with an ellipsis when longer", () => {
    const summary = summarizeCard(fullCard);
    expect(summary.description_preview).toBe(`${"A".repeat(200)}…`);
  });

  it("leaves a short description whole, with no ellipsis", () => {
    const shortCard = { ...fullCard, description: "Short description." };
    const summary = summarizeCard(shortCard);
    expect(summary.description_preview).toBe("Short description.");
  });

  it("omits description_preview entirely when there is no description", () => {
    const { description, ...cardWithoutDescription } = fullCard;
    const summary = summarizeCard(cardWithoutDescription);
    expect(summary).not.toHaveProperty("description_preview");
  });

  it("never splits a surrogate pair when truncating description_preview", () => {
    // The emoji straddles the 200-unit boundary: naive slice(0, 200) keeps only its
    // high surrogate and emits a lone, malformed code unit.
    const summary = summarizeCard({ ...fullCard, description: `${"A".repeat(199)}😀tail` });
    const preview = summary.description_preview as string;

    expect(preview).toBe(`${"A".repeat(199)}…`);
    expect(preview).not.toMatch(/[\uD800-\uDBFF]/);
    expect([...preview].every((char) => char.codePointAt(0)! <= 0xd7ff || char.codePointAt(0)! >= 0xe000)).toBe(true);
  });

  it("keeps a surrogate pair that fits entirely within the limit", () => {
    const summary = summarizeCard({ ...fullCard, description: `${"A".repeat(198)}😀tail` });
    expect(summary.description_preview).toBe(`${"A".repeat(198)}😀…`);
  });

  it("keeps has_more_assignees so a truncated assignee list cannot read as complete", () => {
    const summary = summarizeCard({ ...fullCard, assignees: [{ id: "u1", name: "Bob" }], has_more_assignees: true });
    expect(summary.has_more_assignees).toBe(true);
    expect(summary.assignees).toEqual([{ id: "u1", name: "Bob" }]);
  });

  it("carries unmodeled-but-listed fields through: golden, closed, last_active_at, has_attachments", () => {
    const summary = summarizeCard(fullCard);
    expect(summary.golden).toBe(true);
    expect(summary.closed).toBe(false);
    expect(summary.last_active_at).toBe("2026-01-03T00:00:00Z");
    expect(summary.has_attachments).toBe(true);
  });

  it("reduces board, column, creator to {id, name}", () => {
    const summary = summarizeCard(fullCard);
    expect(summary.board).toEqual({ id: "b1", name: "Engineering" });
    expect(summary.column).toEqual({ id: "c1", name: "In Progress" });
    expect(summary.creator).toEqual({ id: "u1", name: "Alice" });
  });

  it("reduces assignees to [{id, name}] and tags to [{id, title}]", () => {
    const summary = summarizeCard(fullCard);
    expect(summary.assignees).toEqual([
      { id: "u2", name: "Bob" },
      { id: "u3", name: "Carol" },
    ]);
    expect(summary.tags).toEqual([{ id: "t1", title: "bug" }]);
  });

  // The live API sends card tags as plain title strings —
  // `json.tags card.tags.pluck(:title).sort` in fizzy's cards/_card.json.jbuilder.
  // Reducing those as objects silently emptied the list, so a tagged card read as
  // untagged in summary mode.
  it("passes through string tags, the shape the API actually sends", () => {
    const summary = summarizeCard({ ...fullCard, tags: ["programming", "urgent"] });
    expect(summary.tags).toEqual(["programming", "urgent"]);
  });

  it("keeps string tags when a card mixes both tag shapes", () => {
    const summary = summarizeCard({
      ...fullCard,
      tags: ["programming", { id: "t1", title: "bug" }],
    });
    expect(summary.tags).toEqual(["programming", { id: "t1", title: "bug" }]);
  });

  it("emits an empty tag list for a card with no tags", () => {
    const summary = summarizeCard({ ...fullCard, tags: [] });
    expect(summary.tags).toEqual([]);
  });

  it("does not emit keys absent from the source as undefined", () => {
    const { due_on, ...cardWithoutDueOn } = fullCard;
    const summary = summarizeCard(cardWithoutDueOn);
    expect(Object.prototype.hasOwnProperty.call(summary, "due_on")).toBe(false);
    expect(JSON.stringify(summary)).not.toContain("undefined");
  });
});

// ---- summarizeComment --------------------------------------------------------

describe("summarizeComment", () => {
  it("keeps body as an object with plain_text, and drops body.html", () => {
    const summary = summarizeComment(fullComment);
    expect(summary.body).toEqual({ plain_text: "Looks good to me." });
    expect(typeof summary.body).toBe("object");
    // The access path from client/types.ts must stay identical between modes.
    expect((summary.body as { plain_text: string }).plain_text).toBe("Looks good to me.");
  });

  it("drops the repeated card object and reactions_url", () => {
    const summary = summarizeComment(fullComment);
    expect(summary).not.toHaveProperty("card");
    expect(summary).not.toHaveProperty("reactions_url");
  });

  it("reduces creator to {id, name}", () => {
    const summary = summarizeComment(fullComment);
    expect(summary.creator).toEqual({ id: "u1", name: "Alice" });
  });

  it("does not truncate the comment body", () => {
    const longBody = "L".repeat(5000);
    const summary = summarizeComment({
      ...fullComment,
      body: { plain_text: longBody, html: `<p>${longBody}</p>` },
    });
    expect((summary.body as { plain_text: string }).plain_text).toBe(longBody);
  });

  it("keeps id, created_at, updated_at, url", () => {
    const summary = summarizeComment(fullComment);
    expect(summary.id).toBe("cm1");
    expect(summary.created_at).toBe("2026-01-01T00:00:00Z");
    expect(summary.updated_at).toBe("2026-01-01T00:00:00Z");
    expect(summary.url).toBe("https://example.com/comments/cm1");
  });
});

// ---- summarizeNotification ---------------------------------------------------

describe("summarizeNotification", () => {
  it("drops the nested card.column object", () => {
    const summary = summarizeNotification(fullNotification);
    expect(summary.card).not.toHaveProperty("column");
  });

  it("reduces card to {id, number, title, status, url, closed, postponed, board_name}", () => {
    const summary = summarizeNotification(fullNotification);
    expect(summary.card).toEqual({
      id: "123",
      number: 42,
      title: "Fix the thing",
      status: "published",
      url: "https://example.com/cards/42",
      closed: false,
      postponed: false,
      board_name: "Engineering",
    });
  });

  it("reduces creator to {id, name}", () => {
    const summary = summarizeNotification(fullNotification);
    expect(summary.creator).toEqual({ id: "u1", name: "Alice" });
  });

  it("keeps id, title, body, read, read_at, created_at, url, unread_count", () => {
    const summary = summarizeNotification(fullNotification);
    expect(summary).toMatchObject({
      id: "n1",
      title: "New comment on Fix the thing",
      body: "Alice commented on card #42",
      read: false,
      read_at: null,
      created_at: "2026-01-01T00:00:00Z",
      url: "https://example.com/notifications/n1",
      unread_count: 5,
    });
  });

  it("drops source_type, which is not in the kept list", () => {
    const summary = summarizeNotification(fullNotification);
    expect(summary).not.toHaveProperty("source_type");
  });

  it("does not emit keys absent from the source as undefined", () => {
    const { read_at, ...notificationWithoutReadAt } = fullNotification;
    const summary = summarizeNotification(notificationWithoutReadAt);
    expect(Object.prototype.hasOwnProperty.call(summary, "read_at")).toBe(false);
    expect(JSON.stringify(summary)).not.toContain("undefined");
  });
});
