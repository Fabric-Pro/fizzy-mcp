/**
 * The `include_attachments` opt-in on fizzy_get_card and
 * fizzy_get_card_comments.
 *
 * The load-bearing assertions are the negative ones: omitting the flag must
 * produce the response these tools produced before it existed, down to the key
 * set. This server runs in production and is published to npm, so a default
 * that quietly grew a field would break callers parsing these responses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FizzyClient } from "../../src/client/fizzy-client.js";
import { toolHandlers } from "../../src/tools/handlers.js";

const BASE_URL = "https://fizzy.example.com";
const ACCOUNT = "1234567";

const BLOB_SIGNED_ID =
  "eyJfcmFpbHMiOnsiZGF0YSI6ImV4YW1wbGVibG9iaWQiLCJwdXIiOiJibG9iX2lkIn19--1111111111111111111111111111111111111111";
const VARIATION =
  "eyJfcmFpbHMiOnsiZGF0YSI6InJlc2l6ZV90b19saW1pdCIsInB1ciI6InZhcmlhdGlvbiJ9fQ==--3333333333333333333333333333333333333333";

const BLOB_PATH = `/${ACCOUNT}/rails/active_storage/blobs/redirect/${BLOB_SIGNED_ID}/screenshot.png`;
const PREVIEW_PATH = `/${ACCOUNT}/rails/active_storage/representations/redirect/${BLOB_SIGNED_ID}/${VARIATION}/screenshot.png`;

const ATTACHMENT_MARKUP =
  `<action-text-attachment content-type="image/png" url="${BLOB_PATH}" ` +
  `filename="screenshot.png" filesize="204800" width="1600" height="900" previewable="true">` +
  `<figure><a href="${BLOB_PATH}"><img src="${PREVIEW_PATH}" /></a></figure>` +
  `</action-text-attachment>`;

/** As the API returns it: attachments live only in the HTML. */
const CARD = {
  id: "card-1",
  number: 42,
  title: "Login button misaligned",
  status: "published",
  description: "Here is the failure: [screenshot.png]",
  description_html: `<div class="trix-content"><p>Here is the failure:</p>${ATTACHMENT_MARKUP}</div>`,
  has_attachments: true,
  url: `${BASE_URL}/${ACCOUNT}/cards/42`,
  created_at: "2024-01-01T00:00:00Z",
};

const COMMENTS = [
  {
    id: "comment-1",
    body: {
      plain_text: "Same here: [screenshot.png]",
      html: `<div>Same here:${ATTACHMENT_MARKUP}</div>`,
    },
    creator: { id: "user-1", name: "Test User" },
    created_at: "2024-01-02T00:00:00Z",
    url: `${BASE_URL}/${ACCOUNT}/cards/42/comments/comment-1`,
  },
  {
    id: "comment-2",
    body: { plain_text: "No files on this one", html: "<div>No files on this one</div>" },
    creator: { id: "user-2", name: "Other User" },
    created_at: "2024-01-03T00:00:00Z",
    url: `${BASE_URL}/${ACCOUNT}/cards/42/comments/comment-2`,
  },
];

function mockClient(): FizzyClient {
  return {
    getBaseUrl: () => BASE_URL,
    getCard: vi.fn(async () => structuredClone(CARD)),
    getCardComments: vi.fn(async () => structuredClone(COMMENTS)),
  } as unknown as FizzyClient;
}

const EXPECTED_ATTACHMENT = {
  filename: "screenshot.png",
  content_type: "image/png",
  byte_size: 204800,
  width: 1600,
  height: 900,
  signed_id: BLOB_SIGNED_ID,
  url: `${BASE_URL}${BLOB_PATH}`,
  preview_url: `${BASE_URL}${PREVIEW_PATH}`,
  preview_variation: VARIATION,
};

let client: FizzyClient;

beforeEach(() => {
  client = mockClient();
});

describe("fizzy_get_card: default response is unchanged", () => {
  it("returns the card untouched when the flag is omitted", async () => {
    const result = await toolHandlers.fizzy_get_card(client, {
      account_slug: ACCOUNT,
      card_id: "42",
    });

    expect(result).toEqual(CARD);
    expect(result).not.toHaveProperty("attachments");
  });

  it("returns the card untouched when the flag is explicitly false", async () => {
    const result = await toolHandlers.fizzy_get_card(client, {
      account_slug: ACCOUNT,
      card_id: "42",
      include_attachments: false,
    });

    expect(result).toEqual(CARD);
  });
});

describe("fizzy_get_card: include_attachments", () => {
  it("adds the structured attachments alongside every existing field", async () => {
    const result = (await toolHandlers.fizzy_get_card(client, {
      account_slug: ACCOUNT,
      card_id: "42",
      include_attachments: true,
    })) as Record<string, unknown>;

    // Additive only: nothing that was there before is dropped or rewritten.
    expect(result).toMatchObject(CARD);
    expect(result.attachments).toEqual([EXPECTED_ATTACHMENT]);
  });

  it("accepts the string form LLM clients send for booleans", async () => {
    const result = (await toolHandlers.fizzy_get_card(client, {
      account_slug: ACCOUNT,
      card_id: "42",
      include_attachments: "true",
    })) as Record<string, unknown>;

    expect(result.attachments).toHaveLength(1);
  });

  it("reports an empty list for a card with no attachments", async () => {
    const plain = {
      ...structuredClone(CARD),
      description_html: "<div><p>Nothing attached.</p></div>",
      has_attachments: false,
    };
    const plainClient = {
      getBaseUrl: () => BASE_URL,
      getCard: vi.fn(async () => plain),
    } as unknown as FizzyClient;

    const result = (await toolHandlers.fizzy_get_card(plainClient, {
      account_slug: ACCOUNT,
      card_id: "42",
      include_attachments: true,
    })) as Record<string, unknown>;

    expect(result.attachments).toEqual([]);
  });

  it("does not throw when the card carries no description_html at all", async () => {
    const bare = { id: "card-2", title: "No HTML", status: "published" };
    const bareClient = {
      getBaseUrl: () => BASE_URL,
      getCard: vi.fn(async () => bare),
    } as unknown as FizzyClient;

    const result = (await toolHandlers.fizzy_get_card(bareClient, {
      account_slug: ACCOUNT,
      card_id: "42",
      include_attachments: true,
    })) as Record<string, unknown>;

    expect(result.attachments).toEqual([]);
  });

  it("rejects a malformed flag rather than silently omitting attachments", async () => {
    await expect(
      toolHandlers.fizzy_get_card(client, {
        account_slug: ACCOUNT,
        card_id: "42",
        include_attachments: "yes",
      })
    ).rejects.toThrow(/include_attachments/);
  });

  it("validates the flag before spending an API round-trip", async () => {
    await expect(
      toolHandlers.fizzy_get_card(client, {
        account_slug: ACCOUNT,
        card_id: "42",
        include_attachments: 1,
      })
    ).rejects.toThrow();

    expect(client.getCard).not.toHaveBeenCalled();
  });
});

describe("fizzy_get_card_comments: default responses are unchanged", () => {
  it("returns the full comments untouched when the flag is omitted", async () => {
    const result = await toolHandlers.fizzy_get_card_comments(client, {
      account_slug: ACCOUNT,
      card_number: "42",
    });

    expect(result).toEqual(COMMENTS);
  });

  it("returns the summary projection untouched when the flag is omitted", async () => {
    const result = (await toolHandlers.fizzy_get_card_comments(client, {
      account_slug: ACCOUNT,
      card_number: "42",
      fields: "summary",
    })) as Array<Record<string, unknown>>;

    expect(result[0]).toEqual({
      id: "comment-1",
      created_at: "2024-01-02T00:00:00Z",
      url: COMMENTS[0].url,
      creator: { id: "user-1", name: "Test User" },
      body: { plain_text: "Same here: [screenshot.png]" },
    });
    expect(result[0]).not.toHaveProperty("attachments");
  });
});

describe("fizzy_get_card_comments: include_attachments", () => {
  it("adds a per-comment attachments array in full mode", async () => {
    const result = (await toolHandlers.fizzy_get_card_comments(client, {
      account_slug: ACCOUNT,
      card_number: "42",
      include_attachments: true,
    })) as Array<Record<string, unknown>>;

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject(COMMENTS[0]);
    expect(result[0].attachments).toEqual([EXPECTED_ATTACHMENT]);
    // A comment with no attachment gets an empty list, not a missing key —
    // "none" and "not asked" must not look the same.
    expect(result[1].attachments).toEqual([]);
  });

  it("adds them in summary mode too, where the HTML is dropped entirely", async () => {
    const result = (await toolHandlers.fizzy_get_card_comments(client, {
      account_slug: ACCOUNT,
      card_number: "42",
      fields: "summary",
      include_attachments: true,
    })) as Array<Record<string, unknown>>;

    expect(result[0].body).toEqual({ plain_text: "Same here: [screenshot.png]" });
    expect(result[0]).not.toHaveProperty("html");
    expect(result[0].attachments).toEqual([EXPECTED_ATTACHMENT]);
  });

  it("still rejects an invalid fields value alongside the new flag", async () => {
    await expect(
      toolHandlers.fizzy_get_card_comments(client, {
        account_slug: ACCOUNT,
        card_number: "42",
        fields: "tiny",
        include_attachments: true,
      })
    ).rejects.toThrow(/fields/);
  });
});
