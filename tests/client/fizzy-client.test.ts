/**
 * FizzyClient Test Suite
 * 
 * API Reference: https://github.com/basecamp/fizzy/blob/main/docs/API.md
 * 
 * Expected API Endpoints (RESTful - no .json extension):
 * 
 * IDENTITY & ACCOUNTS
 *   GET /my/identity                              - Get current user identity
 *   GET /:account_slug                            - Get specific account
 *   (accounts are embedded in identity response)
 * 
 * BOARDS
 *   GET    /:account_slug/boards                  - List all boards
 *   GET    /:account_slug/boards/:board_id        - Get specific board
 *   POST   /:account_slug/boards                  - Create board
 *   PUT    /:account_slug/boards/:board_id        - Update board
 *   DELETE /:account_slug/boards/:board_id        - Delete board
 * 
 * CARDS
 *   GET    /:account_slug/cards                   - List cards (supports ?board_ids[], ?column_ids[], ?terms[], ?assignee_ids[], ?tag_ids[] filters)
 *   GET    /:account_slug/boards/:board_id/cards  - List cards on a specific board
 *   GET    /:account_slug/cards/:card_id          - Get specific card
 *   POST   /:account_slug/boards/:board_id/cards  - Create card on board
 *   PUT    /:account_slug/cards/:card_id          - Update card
 *   DELETE /:account_slug/cards/:card_id          - Delete card
 * 
 * CARD ACTIONS
 *   POST   /:account_slug/cards/:card_number/closure     - Close card
 *   DELETE /:account_slug/cards/:card_number/closure     - Reopen card
 *   POST   /:account_slug/cards/:card_number/not_now     - Move to Not Now
 *   POST   /:account_slug/cards/:card_number/triage      - Move to column
 *   DELETE /:account_slug/cards/:card_number/triage      - Send to triage
 *   POST   /:account_slug/cards/:card_number/taggings    - Toggle tag
 *   POST   /:account_slug/cards/:card_number/assignments - Toggle assignment
 *   POST   /:account_slug/cards/:card_number/watch       - Watch card
 *   DELETE /:account_slug/cards/:card_number/watch       - Unwatch card
 *   POST   /:account_slug/cards/:card_number/goldness    - Mark card golden
 *   DELETE /:account_slug/cards/:card_number/goldness    - Remove golden status
 *
 * PINS
 *   POST   /:account_slug/cards/:card_number/pin  - Pin card for current user
 *   DELETE /:account_slug/cards/:card_number/pin  - Unpin card for current user
 *   GET    /:account_slug/my/pins                 - List current user's pinned cards (not paginated, max 100)
 *
 * COMMENTS
 *   GET    /:account_slug/cards/:card_number/comments              - List comments
 *   GET    /:account_slug/cards/:card_number/comments/:comment_id  - Get comment
 *   POST   /:account_slug/cards/:card_number/comments              - Create comment
 *   PUT    /:account_slug/cards/:card_number/comments/:comment_id  - Update comment
 *   DELETE /:account_slug/comments/:comment_id                     - Delete comment
 * 
 * REACTIONS
 *   GET    /:account_slug/cards/:card_number/comments/:comment_id/reactions               - List reactions
 *   POST   /:account_slug/cards/:card_number/comments/:comment_id/reactions               - Add reaction
 *   DELETE /:account_slug/cards/:card_number/comments/:comment_id/reactions/:reaction_id  - Remove reaction
 * 
 * STEPS (To-dos)
 *   GET    /:account_slug/cards/:card_number/steps/:step_id  - Get step
 *   POST   /:account_slug/cards/:card_number/steps           - Create step
 *   PUT    /:account_slug/cards/:card_number/steps/:step_id  - Update step
 *   DELETE /:account_slug/cards/:card_number/steps/:step_id  - Delete step
 * 
 * COLUMNS
 *   GET    /:account_slug/boards/:board_id/columns               - List columns
 *   GET    /:account_slug/boards/:board_id/columns/:column_id    - Get column
 *   POST   /:account_slug/boards/:board_id/columns               - Create column
 *   PUT    /:account_slug/boards/:board_id/columns/:column_id    - Update column
 *   DELETE /:account_slug/boards/:board_id/columns/:column_id    - Delete column
 * 
 * TAGS
 *   GET    /:account_slug/tags                    - List all tags in account
 *   (Note: Tags are created via POST /:account_slug/cards/:card_number/taggings)
 * 
 * USERS
 *   GET    /:account_slug/users                   - List users
 *   GET    /:account_slug/users/:user_id          - Get user
 *   PUT    /:account_slug/users/:user_id          - Update user
 *   DELETE /:account_slug/users/:user_id          - Deactivate user
 * 
 * NOTIFICATIONS
 *   GET    /:account_slug/notifications                             - List notifications
 *   POST   /:account_slug/notifications/:notification_id/reading    - Mark as read
 *   DELETE /:account_slug/notifications/:notification_id/reading    - Mark as unread
 *   POST   /:account_slug/notifications/bulk_reading                - Mark all as read
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FizzyClient } from "../../src/client/fizzy-client.js";
import { logger, type LogLevel } from "../../src/utils/logger.js";
import {
  FizzyAuthError,
  FizzyNotFoundError,
  FizzyForbiddenError,
  FizzyValidationError,
  FizzyRateLimitError,
  FizzyTimeoutError,
  FizzyNetworkError,
  FizzyParseError,
  FizzyAPIError,
} from "../../src/utils/errors.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Helper to create mock headers (needed for ETag caching)
const createMockHeaders = (etag?: string) => ({
  get: (name: string) => {
    if (name === "ETag" && etag) return etag;
    return null;
  },
});

// Helper to create successful response
const createMockResponse = <T>(data: T, status = 200, etag?: string) => ({
  ok: true,
  status,
  headers: createMockHeaders(etag),
  json: async () => data,
});

// Helper for 204 No Content
const createMockNoContent = () => ({
  ok: true,
  status: 204,
  headers: createMockHeaders(),
});

describe("FizzyClient", () => {
  let client: FizzyClient;

  beforeEach(() => {
    client = new FizzyClient({
      accessToken: "test-token",
      baseUrl: "https://app.fizzy.do",
      maxRetries: 0, // Disable retries for most tests
    });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should use default base URL when not provided", () => {
      const clientWithDefaults = new FizzyClient({
        accessToken: "test-token",
      });
      expect(clientWithDefaults).toBeDefined();
    });

    it("should use custom base URL when provided", () => {
      const customClient = new FizzyClient({
        accessToken: "test-token",
        baseUrl: "https://custom.fizzy.do",
      });
      expect(customClient).toBeDefined();
    });

    it("should accept custom timeout", () => {
      const customClient = new FizzyClient({
        accessToken: "test-token",
        timeout: 5000,
      });
      expect(customClient).toBeDefined();
    });

    it("should accept custom retry settings", () => {
      const customClient = new FizzyClient({
        accessToken: "test-token",
        maxRetries: 5,
        retryBaseDelay: 500,
      });
      expect(customClient).toBeDefined();
    });
  });

  describe("slug normalization", () => {
    it("should strip leading slash from account slug", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      await client.getBoards("/123456");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123456/boards",
        expect.any(Object)
      );
    });

    it("should handle slug without leading slash", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      await client.getBoards("123456");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123456/boards",
        expect.any(Object)
      );
    });

    // The slug is interpolated into every request path, so a caller-supplied
    // one that escapes its segment retargets the request. The client must
    // refuse to build it rather than letting the API decide. Sampled across a
    // read, a write and a card action — the three path shapes — since every
    // method routes through the same normalizeSlug; the rule itself has its own
    // suite in tests/utils/account-slug.test.ts.
    it.each([
      ["a traversal", "123456/../999999"],
      ["extra path segments", "123456/cards"],
      ["a query string", "123456?x=1"],
      ["an absolute URL", "https://evil.example/123456"],
      ["a parent directory", ".."],
      ["an empty slug", ""],
    ])("should reject %s without issuing a request", async (_label, slug) => {
      await expect(client.getBoards(slug)).rejects.toThrow(/account_slug/);
      await expect(client.createBoard(slug, { name: "x" })).rejects.toThrow(/account_slug/);
      await expect(client.closeCard(slug, "1")).rejects.toThrow(/account_slug/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("path segment validation", () => {
    // Every other caller-supplied id — board_id, card_id, card_number,
    // comment_id, step_id, column_id, user_id, notification_id, reaction_id —
    // is interpolated into a request path the same way account_slug is, so it
    // needs the same containment guard (see utils/path-segment.ts). Checked
    // against one method per guarded id name so the guard is shown to be
    // applied broadly, not just on getBoard; the rule itself has its own
    // suite in tests/utils/path-segment.test.ts, and the sweep in
    // tests/client/path-segments.test.ts proves every call site uses it.
    it.each([
      ["a traversal", "../cards/42"],
      ["an embedded separator", "123/456"],
      ["a parent directory", ".."],
    ])("rejects %s in every guarded id without issuing a request", async (_label, id) => {
      await expect(client.getBoard("123456", id)).rejects.toThrow(/board_id/);
      await expect(client.getCard("123456", id)).rejects.toThrow(/card_id/);
      await expect(client.closeCard("123456", id)).rejects.toThrow(/card_number/);
      await expect(client.getComment("123456", "1", id)).rejects.toThrow(/comment_id/);
      await expect(client.getStep("123456", "1", id)).rejects.toThrow(/step_id/);
      await expect(client.getColumn("123456", "1", id)).rejects.toThrow(/column_id/);
      await expect(client.getUser("123456", id)).rejects.toThrow(/user_id/);
      await expect(client.markNotificationAsRead("123456", id)).rejects.toThrow(/notification_id/);
      await expect(client.removeReaction("123456", "1", "1", id)).rejects.toThrow(/reaction_id/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("authentication", () => {
    it("should include Bearer token in Authorization header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "test" }),
      });

      await client.getIdentity();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });
  });

  describe("getIdentity", () => {
    it("should fetch identity from /my/identity", async () => {
      const mockIdentity = {
        id: "user123",
        name: "Test User",
        email_address: "test@example.com",
        accounts: [{ id: "acc1", name: "Test Account", slug: "/123" }],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockIdentity,
      });

      const result = await client.getIdentity();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/my/identity",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Accept: "application/json",
          }),
        })
      );
      expect(result).toEqual(mockIdentity);
    });
  });

  describe("getAccounts", () => {
    it("should extract accounts from identity response", async () => {
      const mockAccounts = [
        { id: "acc1", name: "Account 1", slug: "/123" },
        { id: "acc2", name: "Account 2", slug: "/456" },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "user123",
          accounts: mockAccounts,
        }),
      });

      const result = await client.getAccounts();

      expect(result).toEqual(mockAccounts);
    });

    it("should return empty array when no accounts", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "user123",
        }),
      });

      const result = await client.getAccounts();

      expect(result).toEqual([]);
    });
  });

  /**
   * Boards API
   * GET  /:account_slug/boards                    - List all boards
   * GET  /:account_slug/boards/:board_id          - Get specific board
   * POST /:account_slug/boards                    - Create board
   * PUT  /:account_slug/boards/:board_id          - Update board
   * DELETE /:account_slug/boards/:board_id        - Delete board
   */
  describe("Boards", () => {
    // Expected URL: GET /:account_slug/boards
    it("should get boards for an account", async () => {
      const mockBoards = [
        { id: "board1", name: "Board 1" },
        { id: "board2", name: "Board 2" },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockBoards,
      });

      const result = await client.getBoards("123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards",
        expect.any(Object)
      );
      expect(result).toEqual(mockBoards);
    });

    it("should get a single board", async () => {
      const mockBoard = { id: "board1", name: "Board 1" };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockBoard,
      });

      const result = await client.getBoard("123", "board1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards/board1",
        expect.any(Object)
      );
      expect(result).toEqual(mockBoard);
    });

    it("should create a board", async () => {
      const mockBoard = { id: "board1", name: "New Board" };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockBoard,
      });

      const result = await client.createBoard("123", { name: "New Board" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ board: { name: "New Board" } }),
        })
      );
      expect(result).toEqual(mockBoard);
    });

    it("should update a board", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await client.updateBoard("123", "board1", { name: "Updated Board" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards/board1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ board: { name: "Updated Board" } }),
        })
      );
    });

    it("should delete a board", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await client.deleteBoard("123", "board1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards/board1",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  /**
   * Cards API
   * GET  /:account_slug/cards                     - List cards (with optional ?board_ids[], ?column_ids[], ?terms[], ?assignee_ids[], ?tag_ids[] filters)
   * GET  /:account_slug/boards/:board_id/cards    - List cards on a specific board
   * GET  /:account_slug/cards/:card_id            - Get specific card
   * POST /:account_slug/boards/:board_id/cards    - Create card on board (NOTE: uses boards path!)
   * PUT  /:account_slug/cards/:card_id            - Update card
   * DELETE /:account_slug/cards/:card_id          - Delete card
   */
  describe("Cards", () => {
    // Expected URL: GET /:account_slug/cards?board_ids[]=...&column_ids[]=...&terms[]=...
    // The Fizzy API only accepts these plural array params (Rails strong params drop
    // singular keys like status/column_id/search).
    it("should get all cards with filters", async () => {
      const mockCards = [{ id: "card1", title: "Card 1" }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockCards,
      });

      const result = await client.getCards("123", {
        board_ids: ["board1"],
        column_ids: ["col1"],
        terms: ["urgent task"],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("123/cards"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("board_ids%5B%5D=board1"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("column_ids%5B%5D=col1"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("terms%5B%5D=urgent+task"),
        expect.any(Object)
      );
      // No pagination headers on this mock: report what we know, invent nothing.
      expect(result).toEqual({
        cards: mockCards,
        page: 1,
        total_count: null,
        has_more: false,
        next_page: null,
      });
    });

    // Expected URL: GET /:account_slug/cards/:card_id
    it("should get a single card", async () => {
      const mockCard = { id: "card1", title: "Card 1" };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockCard,
      });

      const result = await client.getCard("123", "card1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/cards/card1",
        expect.any(Object)
      );
      expect(result).toEqual(mockCard);
    });

    // Expected URL: POST /:account_slug/boards/:board_id/cards
    // NOTE: Creating cards uses the /boards/:board_id/cards path (unlike reading cards)
    it("should create a card", async () => {
      const mockCard = { id: "card1", title: "New Card" };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockCard,
      });

      const result = await client.createCard("123", "board1", {
        title: "New Card",
        description: "Description",
        status: "published",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards/board1/cards",
        expect.objectContaining({
          method: "POST",
        })
      );
      expect(result).toEqual(mockCard);
    });

    it("should update a card", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await client.updateCard("123", "card1", { title: "Updated Card" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/cards/card1",
        expect.objectContaining({
          method: "PUT",
        })
      );
    });

    it("should delete a card", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await client.deleteCard("123", "card1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/cards/card1",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  /**
   * Cards pagination
   * GET /:account_slug/cards is paginated upstream (geared_pagination, offset mode).
   * Every page but the last carries `Link: <...?page=N+1>; rel="next"`, and every
   * page carries `X-Total-Count` with the total number of FILTERED cards.
   */
  describe("Cards pagination", () => {
    const paginationHeaders = (values: Record<string, string>) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(values)) {
        headers.set(name, value);
      }
      return headers;
    };

    it("reports total_count, has_more and next_page from the response headers", async () => {
      const mockCards = [{ id: "card1", title: "Card 1" }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({
          "X-Total-Count": "238",
          Link: '<https://app.fizzy.do/123/cards?page=2>; rel="next"',
        }),
        json: async () => mockCards,
      });

      const result = await client.getCards("123");

      expect(result).toEqual({
        cards: mockCards,
        page: 1,
        total_count: 238,
        has_more: true,
        next_page: 2,
      });
    });

    it("sends ?page= only when a page is requested", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({ "X-Total-Count": "238" }),
        json: async () => [],
      });

      const result = await client.getCards("123", { page: 2 });

      expect(mockFetch.mock.calls[0][0] as string).toContain("page=2");
      expect(result.page).toBe(2);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({ "X-Total-Count": "238" }),
        json: async () => [],
      });

      await client.getCards("123", { indexed_by: "closed" });

      expect(mockFetch.mock.calls[1][0] as string).not.toContain("page=");
    });

    it("derives next_page from the requested page, not from the Link URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({
          "X-Total-Count": "238",
          // Deliberately inconsistent page number in the URL - it must be ignored.
          Link: '<https://app.fizzy.do/123/cards?page=99>; rel="next"',
        }),
        json: async () => [{ id: "card16" }],
      });

      const result = await client.getCards("123", { page: 2 });

      expect(result.page).toBe(2);
      expect(result.next_page).toBe(3);
    });

    it("treats a Link header without rel=next as the last page", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({
          "X-Total-Count": "43",
          Link: '<https://app.fizzy.do/123/cards?page=4>; rel="prev"',
        }),
        json: async () => [{ id: "card43" }],
      });

      const result = await client.getCards("123", { page: 5 });

      expect(result.has_more).toBe(false);
      expect(result.next_page).toBeNull();
      expect(result.total_count).toBe(43);
    });

    it("accepts an unquoted rel=next (RFC 8288)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({
          Link: "<https://app.fizzy.do/123/cards?page=2>; rel=next",
        }),
        json: async () => [{ id: "card1" }],
      });

      const result = await client.getCards("123");

      expect(result.has_more).toBe(true);
      expect(result.next_page).toBe(2);
    });

    it("reports total_count null when X-Total-Count is not a number", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({ "X-Total-Count": "abc" }),
        json: async () => [{ id: "card1" }],
      });

      const result = await client.getCards("123");

      expect(result.total_count).toBeNull();
    });

    it("reports total_count null for a header with trailing junk", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({ "X-Total-Count": "12junk" }),
        json: async () => [{ id: "card1" }],
      });

      const result = await client.getCards("123");

      expect(result.total_count).toBeNull();
    });

    it("reports total_count null for a negative header value", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({ "X-Total-Count": "-5" }),
        json: async () => [{ id: "card1" }],
      });

      const result = await client.getCards("123");

      expect(result.total_count).toBeNull();
    });

    it("does not treat rel=\"xrel\" as a next link (false positive guard)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({
          Link: '<https://app.fizzy.do/123/cards?page=2>; xrel="next"',
        }),
        json: async () => [{ id: "card1" }],
      });

      const result = await client.getCards("123");

      expect(result.has_more).toBe(false);
      expect(result.next_page).toBeNull();
    });

    it("does not treat rel=\"next-page\" as a next link (false positive guard)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({
          Link: '<https://app.fizzy.do/123/cards?page=2>; rel="next-page"',
        }),
        json: async () => [{ id: "card1" }],
      });

      const result = await client.getCards("123");

      expect(result.has_more).toBe(false);
      expect(result.next_page).toBeNull();
    });

    it("treats a quoted rel token list containing next as a next link", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({
          Link: '<https://app.fizzy.do/123/cards?page=2>; rel="prev next"',
        }),
        json: async () => [{ id: "card1" }],
      });

      const result = await client.getCards("123");

      expect(result.has_more).toBe(true);
      expect(result.next_page).toBe(2);
    });

    it("finds rel=next among multiple links in the same header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({
          Link:
            '<https://app.fizzy.do/123/cards?page=1>; rel="prev", ' +
            '<https://app.fizzy.do/123/cards?page=3>; rel="next"',
        }),
        json: async () => [{ id: "card1" }],
      });

      const result = await client.getCards("123", { page: 2 });

      expect(result.has_more).toBe(true);
      expect(result.next_page).toBe(3);
    });

    it("does not let a quoted title fabricate a rel=next param (false positive guard)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({
          Link: '<https://example/cards>; title="literal; rel=next; suffix"; rel="prev"',
        }),
        json: async () => [{ id: "card1" }],
      });

      const result = await client.getCards("123");

      expect(result.has_more).toBe(false);
    });

    it("does not let a quoted comma fabricate a link-value (false positive guard)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({
          Link: '<https://x/a>; title="see also, <https://x/b>; rel=next"; rel="prev"',
        }),
        json: async () => [{ id: "card1" }],
      });

      const result = await client.getCards("123");

      expect(result.has_more).toBe(false);
    });

    it("finds a real rel=next after a quoted param containing a semicolon", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({
          Link: '<https://x/a>; title="x; y"; rel="next"',
        }),
        json: async () => [{ id: "card1" }],
      });

      const result = await client.getCards("123");

      expect(result.has_more).toBe(true);
    });

    it("honors only the first rel param on a link-value (RFC 8288)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({
          Link: '<https://x/a>; rel="prev"; rel="next"',
        }),
        json: async () => [{ id: "card1" }],
      });

      const result = await client.getCards("123");

      expect(result.has_more).toBe(false);
    });

    it("does not let an escaped quote inside a quoted string fabricate rel=next", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({
          Link: '<https://x/a>; title="say \\" ; rel=next"; rel="prev"',
        }),
        json: async () => [{ id: "card1" }],
      });

      const result = await client.getCards("123");

      expect(result.has_more).toBe(false);
    });

    it("returns an empty cards array when the requested page is past the end", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({
          "X-Total-Count": "43",
          // Upstream keeps advertising a next page past the end, hence the
          // documented "stop on has_more false OR empty cards" rule.
          Link: '<https://app.fizzy.do/123/cards?page=1000>; rel="next"',
        }),
        json: async () => [],
      });

      const result = await client.getCards("123", { page: 999 });

      expect(result.cards).toEqual([]);
      expect(result.has_more).toBe(true);
    });

    it("reuses cached pagination metadata on a 304 that omits the headers", async () => {
      const mockCards = [{ id: "card1", title: "Card 1" }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({
          ETag: 'W/"cards1"',
          "X-Total-Count": "238",
          Link: '<https://app.fizzy.do/123/cards?page=2>; rel="next"',
        }),
        json: async () => mockCards,
      });

      const first = await client.getCards("123");
      expect(first.total_count).toBe(238);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 304,
        headers: paginationHeaders({ ETag: 'W/"cards1"' }),
      });

      const second = await client.getCards("123");

      expect(mockFetch.mock.calls[1][1].headers["If-None-Match"]).toBe('W/"cards1"');
      expect(second).toEqual({
        cards: mockCards,
        page: 1,
        total_count: 238,
        has_more: true,
        next_page: 2,
      });
    });

    it("prefers pagination headers carried by the 304 itself over cached metadata", async () => {
      const mockCards = [{ id: "card1", title: "Card 1" }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: paginationHeaders({
          ETag: 'W/"cards1"',
          "X-Total-Count": "238",
          Link: '<https://app.fizzy.do/123/cards?page=2>; rel="next"',
        }),
        json: async () => mockCards,
      });

      await client.getCards("123");

      // Rails runs the action for conditional GETs, so a 304 still carries fresh
      // counts - here the total changed and the next-page link is gone.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 304,
        headers: paginationHeaders({ ETag: 'W/"cards1"', "X-Total-Count": "240" }),
      });

      const second = await client.getCards("123");

      expect(second).toEqual({
        cards: mockCards,
        page: 1,
        total_count: 240,
        has_more: false,
        next_page: null,
      });
    });

    it("builds the envelope from the successful attempt after a retry", async () => {
      const clientWithRetry = new FizzyClient({
        accessToken: "test-token",
        baseUrl: "https://app.fizzy.do",
        maxRetries: 2,
        retryBaseDelay: 10,
      });
      const mockCards = [{ id: "card1", title: "Card 1" }];
      const failedHeadersGet = vi.fn(() => {
        throw new Error("must not read headers of a failed response");
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          headers: { get: failedHeadersGet },
          text: async () => "Error",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: paginationHeaders({
            "X-Total-Count": "238",
            Link: '<https://app.fizzy.do/123/cards?page=2>; rel="next"',
          }),
          json: async () => mockCards,
        });

      const result = await clientWithRetry.getCards("123");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(failedHeadersGet).not.toHaveBeenCalled();
      expect(result).toEqual({
        cards: mockCards,
        page: 1,
        total_count: 238,
        has_more: true,
        next_page: 2,
      });
    });
  });

  /**
   * List aggregation
   *
   * GET /:slug/boards, /:slug/tags, /:slug/users and
   * /:slug/cards/:number/comments are all paginated upstream with the same
   * geared_pagination gearing as cards (15, 30, 50, then 100 per page), but
   * they return bare arrays with no page envelope, so callers had no way to ask
   * for page 2 and no way to tell they had only been given page 1. These
   * methods now walk the Link header until it stops advertising rel="next".
   */
  describe("List aggregation across pages", () => {
    const pageResponse = (
      items: unknown[],
      headerValues: Record<string, string> = {}
    ) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(headerValues)) {
        headers.set(name, value);
      }
      return {
        ok: true,
        status: 200,
        headers,
        json: async () => items,
      };
    };

    const nextLink = (page: number) => ({
      Link: `<https://app.fizzy.do/123/boards?page=${page}>; rel="next"`,
    });

    it("follows rel=next across pages and concatenates them in order", async () => {
      mockFetch
        .mockResolvedValueOnce(pageResponse([{ id: "b1" }, { id: "b2" }], nextLink(2)))
        .mockResolvedValueOnce(pageResponse([{ id: "b3" }], nextLink(3)))
        .mockResolvedValueOnce(pageResponse([{ id: "b4" }]));

      const result = await client.getBoards("123");

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result).toEqual([{ id: "b1" }, { id: "b2" }, { id: "b3" }, { id: "b4" }]);
    });

    it("requests page 1 with no page param and later pages with one", async () => {
      mockFetch
        .mockResolvedValueOnce(pageResponse([{ id: "b1" }], nextLink(2)))
        .mockResolvedValueOnce(pageResponse([{ id: "b2" }], nextLink(3)))
        .mockResolvedValueOnce(pageResponse([{ id: "b3" }]));

      await client.getBoards("123");

      expect(mockFetch.mock.calls[0][0]).toBe("https://app.fizzy.do/123/boards");
      expect(mockFetch.mock.calls[1][0]).toBe("https://app.fizzy.do/123/boards?page=2");
      expect(mockFetch.mock.calls[2][0]).toBe("https://app.fizzy.do/123/boards?page=3");
    });

    it("stops after a page whose Link header has no rel=next", async () => {
      mockFetch.mockResolvedValueOnce(
        pageResponse([{ id: "b1" }], {
          Link: '<https://app.fizzy.do/123/boards?page=1>; rel="prev"',
          "X-Total-Count": "1",
        })
      );

      const result = await client.getBoards("123");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toEqual([{ id: "b1" }]);
    });

    it("stops on an empty page even when the Link header still advertises a next one", async () => {
      // Upstream keeps emitting rel="next" past the end of the collection, so
      // the empty page is the only reliable terminator on that path.
      mockFetch
        .mockResolvedValueOnce(pageResponse([{ id: "b1" }], nextLink(2)))
        .mockResolvedValueOnce(pageResponse([], nextLink(3)));

      const result = await client.getBoards("123");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual([{ id: "b1" }]);
    });

    it("makes a single request when the response carries no pagination headers", async () => {
      // Absent metadata has to mean "one page", which is what keeps every
      // pre-existing single-response test (and mock) behaving as before.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: "b1" }],
      });

      const result = await client.getBoards("123");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toEqual([{ id: "b1" }]);
    });

    it("stops at the page cap and warns instead of walking forever", async () => {
      // A next link on every page (which is what a server bug, or a collection
      // growing faster than we read it, looks like) must not turn one tool call
      // into unbounded subrequests - Cloudflare Workers cap those per invocation.
      for (let page = 1; page <= 40; page++) {
        mockFetch.mockResolvedValueOnce(
          pageResponse([{ id: `b${page}` }], nextLink(page + 1))
        );
      }

      const previousLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
      logger.setLevel("warn");
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      let result: unknown[];
      let warnings: string[];
      try {
        // The child logger copies the level at construction time.
        const cappedClient = new FizzyClient({
          accessToken: "test-token",
          baseUrl: "https://app.fizzy.do",
          maxRetries: 0,
        });
        result = await cappedClient.getBoards("123");
      } finally {
        // Read the calls before restoring: mockRestore() discards them.
        warnings = consoleErrorSpy.mock.calls.map((call) => String(call[0]));
        consoleErrorSpy.mockRestore();
        logger.setLevel(previousLevel);
      }

      expect(mockFetch).toHaveBeenCalledTimes(20);
      expect(result!).toHaveLength(20);
      expect(warnings!.some((line) => line.includes("page cap"))).toBe(true);
    });

    it("appends page to a path that already carries a query string", async () => {
      // None of the aggregated endpoints takes filters today, so this exercises
      // the helper directly: the separator has to already be right for the first
      // one that does, and a "?page=2" glued onto an existing query silently
      // returns page 1 forever.
      const walk = (
        client as unknown as {
          requestAllPages: (path: string) => Promise<unknown[]>;
        }
      ).requestAllPages.bind(client);

      mockFetch
        .mockResolvedValueOnce(pageResponse([{ id: "t1" }], nextLink(2)))
        .mockResolvedValueOnce(pageResponse([{ id: "t2" }]));

      const result = await walk("/123/tags?q=bug");

      expect(mockFetch.mock.calls[0][0]).toBe("https://app.fizzy.do/123/tags?q=bug");
      expect(mockFetch.mock.calls[1][0]).toBe(
        "https://app.fizzy.do/123/tags?q=bug&page=2"
      );
      expect(result).toEqual([{ id: "t1" }, { id: "t2" }]);
    });

    it("keeps walking after a 304 whose cached metadata advertises a next page", async () => {
      // Page 1 is the page most likely to be served from the ETag cache, and a
      // 304 that arrives without pagination headers falls back to the metadata
      // stored with the body - which still has to drive the walk.
      mockFetch
        .mockResolvedValueOnce(
          pageResponse([{ id: "b1" }], { ETag: 'W/"boards1"', ...nextLink(2) })
        )
        .mockResolvedValueOnce(pageResponse([{ id: "b2" }]));

      await client.getBoards("123");
      mockFetch.mockClear();

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 304,
          headers: new Headers({ ETag: 'W/"boards1"' }),
        })
        .mockResolvedValueOnce(pageResponse([{ id: "b2" }]));

      const result = await client.getBoards("123");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][1].headers["If-None-Match"]).toBe('W/"boards1"');
      expect(result).toEqual([{ id: "b1" }, { id: "b2" }]);
    });

    it("aggregates tags", async () => {
      mockFetch
        .mockResolvedValueOnce(
          pageResponse([{ id: "t1" }], {
            Link: '<https://app.fizzy.do/123/tags?page=2>; rel="next"',
          })
        )
        .mockResolvedValueOnce(pageResponse([{ id: "t2" }]));

      expect(await client.getTags("123")).toEqual([{ id: "t1" }, { id: "t2" }]);
      expect(mockFetch.mock.calls[1][0]).toBe("https://app.fizzy.do/123/tags?page=2");
    });

    it("aggregates users", async () => {
      mockFetch
        .mockResolvedValueOnce(
          pageResponse([{ id: "u1" }], {
            Link: '<https://app.fizzy.do/123/users?page=2>; rel="next"',
          })
        )
        .mockResolvedValueOnce(pageResponse([{ id: "u2" }]));

      expect(await client.getUsers("123")).toEqual([{ id: "u1" }, { id: "u2" }]);
      expect(mockFetch.mock.calls[1][0]).toBe("https://app.fizzy.do/123/users?page=2");
    });

    it("aggregates card comments", async () => {
      mockFetch
        .mockResolvedValueOnce(
          pageResponse([{ id: "c1" }], {
            Link: '<https://app.fizzy.do/123/cards/42/comments?page=2>; rel="next"',
          })
        )
        .mockResolvedValueOnce(pageResponse([{ id: "c2" }]));

      expect(await client.getCardComments("123", "42")).toEqual([
        { id: "c1" },
        { id: "c2" },
      ]);
      expect(mockFetch.mock.calls[1][0]).toBe(
        "https://app.fizzy.do/123/cards/42/comments?page=2"
      );
    });
  });

  /**
   * Notifications pagination
   *
   * NotificationsController#index renders `(@unread || []) + @page.records`, and
   * only populates @unread when the request carries no `page` param. So paging
   * this endpoint is not "more of the same list": page 2 onwards is read-only
   * history, and aggregating it would grow without bound as notifications are
   * read. Hence an explicit `page` rather than the walk the other lists get.
   */
  describe("Notifications pagination", () => {
    const listResponse = (items: unknown[], headerValues: Record<string, string> = {}) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(headerValues)) {
        headers.set(name, value);
      }
      return { ok: true, status: 200, headers, json: async () => items };
    };

    it("requests the bare path when no page is given", async () => {
      mockFetch.mockResolvedValueOnce(listResponse([{ id: "n1" }]));

      await client.getNotifications("123");

      expect(mockFetch.mock.calls[0][0]).toBe("https://app.fizzy.do/123/notifications");
    });

    it("requests the bare path for page 1, so the unread block is still returned", async () => {
      mockFetch.mockResolvedValueOnce(listResponse([{ id: "n1" }]));

      await client.getNotifications("123", { page: 1 });

      expect(mockFetch.mock.calls[0][0]).toBe("https://app.fizzy.do/123/notifications");
    });

    it("requests ?page=N for later pages", async () => {
      mockFetch.mockResolvedValueOnce(listResponse([{ id: "n9" }]));

      await client.getNotifications("123", { page: 3 });

      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://app.fizzy.do/123/notifications?page=3"
      );
    });

    it("does not aggregate, even when the response advertises a next page", async () => {
      mockFetch.mockResolvedValueOnce(
        listResponse([{ id: "n1" }], {
          Link: '<https://app.fizzy.do/123/notifications?page=2>; rel="next"',
        })
      );

      const result = await client.getNotifications("123");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toEqual([{ id: "n1" }]);
    });

    it.each([0, -1, 1.5, Number.NaN, 1e100])(
      "rejects page %p without making a request",
      async (page) => {
        await expect(client.getNotifications("123", { page })).rejects.toThrow(
          /page must be a positive integer/
        );
        expect(mockFetch).not.toHaveBeenCalled();
      }
    );
  });

  /**
   * Comments API
   * GET    /:account_slug/cards/:card_number/comments                - List comments on card
   * GET    /:account_slug/cards/:card_number/comments/:comment_id    - Get specific comment
   * POST   /:account_slug/cards/:card_number/comments                - Create comment on card
   * PUT    /:account_slug/cards/:card_number/comments/:comment_id    - Update comment
   * DELETE /:account_slug/cards/:card_number/comments/:comment_id    - Delete comment
   */
  describe("Comments", () => {
    // Expected URL: GET /:account_slug/cards/:card_number/comments
    it("should get card comments", async () => {
      // The API returns rich text as { plain_text, html }. Mocking it as a bare
      // string is what let the declared type stay wrong without any test noticing.
      const mockComments = [
        {
          id: "comment1",
          body: { plain_text: "Comment 1", html: "<div>Comment 1</div>" },
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockComments,
      });

      const result = await client.getCardComments("123", "42");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/cards/42/comments",
        expect.any(Object)
      );
      expect(result).toEqual(mockComments);
    });

    it("should create a comment", async () => {
      const mockComment = {
        id: "comment1",
        body: { plain_text: "New Comment", html: "<div>New Comment</div>" },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockComment,
      });

      const result = await client.createCardComment("123", "42", {
        body: "New Comment",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/cards/42/comments",
        expect.objectContaining({
          method: "POST",
        })
      );
      expect(result).toEqual(mockComment);
    });

    it("should delete a comment", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await client.deleteComment("123", "42", "comment1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/cards/42/comments/comment1",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  /**
   * Columns API
   * GET  /:account_slug/boards/:board_id/columns                - List columns
   * GET  /:account_slug/boards/:board_id/columns/:column_id     - Get column
   * POST /:account_slug/boards/:board_id/columns                - Create column
   * PUT  /:account_slug/boards/:board_id/columns/:column_id     - Update column
   * DELETE /:account_slug/boards/:board_id/columns/:column_id   - Delete column
   */
  describe("Columns", () => {
    // Expected URL: GET /:account_slug/boards/:board_id/columns
    it("should get columns for a board", async () => {
      const mockColumns = [{ id: "col1", name: "To Do" }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockColumns,
      });

      const result = await client.getColumns("123", "board1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards/board1/columns",
        expect.any(Object)
      );
      expect(result).toEqual(mockColumns);
    });

    it("should create a column", async () => {
      const mockColumn = { id: "col1", name: "New Column" };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockColumn,
      });

      const result = await client.createColumn("123", "board1", {
        name: "New Column",
        color: "var(--color-card-4)",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards/board1/columns",
        expect.objectContaining({
          method: "POST",
        })
      );
      expect(result).toEqual(mockColumn);
    });

    it("should update a column", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await client.updateColumn("123", "board1", "col1", { name: "Updated" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards/board1/columns/col1",
        expect.objectContaining({
          method: "PUT",
        })
      );
    });

    it("should delete a column", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await client.deleteColumn("123", "board1", "col1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards/board1/columns/col1",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  /**
   * Tags API
   * GET  /:account_slug/tags                      - List all tags in account
   * Note: Tags are created via POST /:account_slug/cards/:card_number/taggings
   */
  describe("Tags", () => {
    // Expected URL: GET /:account_slug/tags
    it("should get all tags", async () => {
      const mockTags = [{ id: "tag1", title: "Bug" }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockTags,
      });

      const result = await client.getTags("123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/tags",
        expect.any(Object)
      );
      expect(result).toEqual(mockTags);
    });

    // Note: POST/DELETE /:account_slug/tags endpoints return 404
    // Tag creation/deletion is not available via API
  });

  /**
   * Users API
   * GET  /:account_slug/users                     - List users
   * GET  /:account_slug/users/:user_id            - Get user
   * PUT  /:account_slug/users/:user_id            - Update user
   * DELETE /:account_slug/users/:user_id          - Deactivate user
   */
  describe("Users", () => {
    // Expected URL: GET /:account_slug/users
    it("should get all users", async () => {
      const mockUsers = [{ id: "user1", name: "User 1" }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockUsers,
      });

      const result = await client.getUsers("123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/users",
        expect.any(Object)
      );
      expect(result).toEqual(mockUsers);
    });

    it("should get a single user", async () => {
      const mockUser = { id: "user1", name: "User 1" };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockUser,
      });

      const result = await client.getUser("123", "user1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/users/user1",
        expect.any(Object)
      );
      expect(result).toEqual(mockUser);
    });

    it("should update a user", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await client.updateUser("123", "user1", { name: "Updated Name" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/users/user1",
        expect.objectContaining({
          method: "PUT",
        })
      );
    });

    it("should deactivate a user", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await client.deactivateUser("123", "user1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/users/user1",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  /**
   * Notifications API
   * GET  /:account_slug/notifications                            - List notifications
   * POST /:account_slug/notifications/:notification_id/reading   - Mark as read
   * DELETE /:account_slug/notifications/:notification_id/reading - Mark as unread
   * POST /:account_slug/notifications/bulk_reading               - Mark all as read
   */
  describe("Notifications", () => {
    // Expected URL: GET /:account_slug/notifications
    it("should get notifications", async () => {
      const mockNotifications = [{ id: "notif1", read: false }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockNotifications,
      });

      const result = await client.getNotifications("123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/notifications",
        expect.any(Object)
      );
      expect(result).toEqual(mockNotifications);
    });

    it("should mark notification as read", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await client.markNotificationAsRead("123", "notif1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/notifications/notif1/reading",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    it("should mark notification as unread", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await client.markNotificationAsUnread("123", "notif1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/notifications/notif1/reading",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });

    it("should mark all notifications as read", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await client.markAllNotificationsAsRead("123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/notifications/bulk_reading",
        expect.objectContaining({
          method: "POST",
        })
      );
    });
  });

  describe("Pins", () => {
    it("should pin a card", async () => {
      mockFetch.mockResolvedValueOnce(createMockNoContent());

      await client.pinCard("123", "42");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/cards/42/pin",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    it("should unpin a card", async () => {
      mockFetch.mockResolvedValueOnce(createMockNoContent());

      await client.unpinCard("123", "42");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/cards/42/pin",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });

    // The pins index lives under the /my namespace but is still account-scoped,
    // because My::PinsController does not declare `disallow_account_scope` the
    // way My::IdentitiesController does. A slug-less "/my/pins" would 404.
    it("should get pinned cards from the account-scoped /my/pins path", async () => {
      const mockPins = [
        { id: "card1", number: 1, title: "First!", status: "published", created_at: "2025-12-05T19:38:48.540Z", url: "https://app.fizzy.do/123/cards/1" },
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(mockPins));

      const result = await client.getPins("123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/my/pins",
        expect.any(Object)
      );
      expect(result).toEqual(mockPins);
    });

    it("should strip the leading slash from the account slug for pins", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([]));

      await client.getPins("/123456");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123456/my/pins",
        expect.any(Object)
      );
    });

    it("should return an empty array when the pins response has no body", async () => {
      mockFetch.mockResolvedValueOnce(createMockNoContent());

      await expect(client.getPins("123")).resolves.toEqual([]);
    });
  });

  describe("Error handling", () => {
    it("should throw FizzyNotFoundError on 404", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => '{"error": "Not found"}',
      });

      await expect(client.getBoards("123")).rejects.toThrow(FizzyNotFoundError);
    });

    it("should throw FizzyAuthError on 401", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => '{"error": "Invalid token"}',
      });

      await expect(client.getIdentity()).rejects.toThrow(FizzyAuthError);
    });

    it("should throw FizzyForbiddenError on 403", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => '{"error": "Access denied"}',
      });

      await expect(client.getBoards("123")).rejects.toThrow(FizzyForbiddenError);
    });

    it("should throw FizzyValidationError on 422", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        text: async () => '{"title": ["is required"]}',
      });

      await expect(
        client.createCard("123", "board1", { title: "" })
      ).rejects.toThrow(FizzyValidationError);
    });

    it("should throw FizzyRateLimitError on 429", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: async () => "Rate limit exceeded",
        headers: new Map([["Retry-After", "60"]]),
      });

      await expect(client.getBoards("123")).rejects.toThrow(FizzyRateLimitError);
    });

    it("should parse Retry-After header on 429", async () => {
      const mockHeaders = new Headers();
      mockHeaders.set("Retry-After", "120");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: async () => "Rate limit exceeded",
        headers: mockHeaders,
      });

      try {
        await client.getBoards("123");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(FizzyRateLimitError);
        expect((error as FizzyRateLimitError).retryAfter).toBe(120);
      }
    });

    it("should throw FizzyAPIError on 500 server error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server crashed",
      });

      await expect(client.getBoards("123")).rejects.toThrow(FizzyAPIError);
    });

    it("should throw FizzyAPIError on 502 bad gateway", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        text: async () => "Upstream error",
      });

      await expect(client.getBoards("123")).rejects.toThrow(FizzyAPIError);
    });

    it("should throw FizzyAPIError on 503 service unavailable", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: async () => "Down for maintenance",
      });

      await expect(client.getBoards("123")).rejects.toThrow(FizzyAPIError);
    });

    it("should throw FizzyParseError on malformed JSON", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      });

      await expect(client.getBoards("123")).rejects.toThrow(FizzyParseError);
    });

    it("should extract id from Location header on 201 Created with empty body (text() capability path)", async () => {
      // Regression check for the switch to text()+JSON.parse: an empty body
      // must still fall through to the 201-Location fallback exactly as it
      // did when parsing went through response.json().
      const headers = new Headers();
      headers.set("Location", "/123/boards/board99.json");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers,
        text: async () => "",
      });

      const result = await client.createBoard("123", { name: "New Board" });

      expect(result).toEqual({ id: "board99", url: "/123/boards/board99.json" });
    });

    it("should throw FizzyTimeoutError on timeout", async () => {
      const clientWithShortTimeout = new FizzyClient({
        accessToken: "test-token",
        timeout: 10, // 10ms timeout
        maxRetries: 0,
      });

      mockFetch.mockImplementationOnce(
        (_url: string, options: { signal?: AbortSignal }) =>
          new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              resolve({
                ok: true,
                status: 200,
                json: async () => ({}),
              });
            }, 1000); // Response takes 1 second

            // Listen for abort signal
            options?.signal?.addEventListener("abort", () => {
              clearTimeout(timeoutId);
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            });
          })
      );

      await expect(clientWithShortTimeout.getIdentity()).rejects.toThrow(
        FizzyTimeoutError
      );
    });

    it("should throw FizzyNetworkError on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await expect(client.getBoards("123")).rejects.toThrow(FizzyNetworkError);
    });
  });

  describe("Retry logic", () => {
    it("should retry on 500 server error", async () => {
      const clientWithRetry = new FizzyClient({
        accessToken: "test-token",
        maxRetries: 2,
        retryBaseDelay: 10, // Short delay for tests
      });

      // First two calls fail, third succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "Error",
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "Error",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ id: "board1" }],
        });

      const result = await clientWithRetry.getBoards("123");

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result).toEqual([{ id: "board1" }]);
    });

    it("should not retry on 401 auth error", async () => {
      const clientWithRetry = new FizzyClient({
        accessToken: "test-token",
        maxRetries: 2,
        retryBaseDelay: 10,
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "Invalid token",
      });

      await expect(clientWithRetry.getIdentity()).rejects.toThrow(FizzyAuthError);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retries
    });

    it("should not retry on 404 not found", async () => {
      const clientWithRetry = new FizzyClient({
        accessToken: "test-token",
        maxRetries: 2,
        retryBaseDelay: 10,
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "Not found",
      });

      await expect(clientWithRetry.getBoards("123")).rejects.toThrow(
        FizzyNotFoundError
      );
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retries
    });

    it("should exhaust retries and throw last error", async () => {
      const clientWithRetry = new FizzyClient({
        accessToken: "test-token",
        maxRetries: 2,
        retryBaseDelay: 10,
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "Error 1",
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "Error 2",
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "Error 3",
        });

      await expect(clientWithRetry.getBoards("123")).rejects.toThrow(FizzyAPIError);
      expect(mockFetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });

  describe("ETag Caching", () => {
    it("should cache response with ETag header", async () => {
      const mockHeaders = new Headers();
      mockHeaders.set("ETag", '"abc123"');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: mockHeaders,
        json: async () => [{ id: "board1", name: "Board 1" }],
      });

      const result1 = await client.getBoards("123");
      expect(result1).toEqual([{ id: "board1", name: "Board 1" }]);

      // Check cache stats
      const stats = client.getCacheStats();
      expect(stats?.size).toBe(1);
    });

    it("should send If-None-Match header on subsequent requests", async () => {
      const mockHeaders = new Headers();
      mockHeaders.set("ETag", '"abc123"');

      // First request - returns data with ETag
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: mockHeaders,
        json: async () => [{ id: "board1" }],
      });

      await client.getBoards("123");

      // Second request - should include If-None-Match
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 304,
        headers: mockHeaders,
      });

      await client.getBoards("123");

      // Check that If-None-Match was sent
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const secondCall = mockFetch.mock.calls[1];
      expect(secondCall[1].headers["If-None-Match"]).toBe('"abc123"');
    });

    it("should return cached data on 304 Not Modified", async () => {
      const mockHeaders = new Headers();
      mockHeaders.set("ETag", '"abc123"');

      // First request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: mockHeaders,
        json: async () => [{ id: "board1", name: "Original" }],
      });

      const result1 = await client.getBoards("123");
      expect(result1).toEqual([{ id: "board1", name: "Original" }]);

      // Second request returns 304
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 304,
        headers: mockHeaders,
      });

      const result2 = await client.getBoards("123");
      expect(result2).toEqual([{ id: "board1", name: "Original" }]);
    });

    it("should update cache when data changes", async () => {
      const headers1 = new Headers();
      headers1.set("ETag", '"etag1"');

      // First request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: headers1,
        json: async () => [{ id: "board1", name: "Original" }],
      });

      await client.getBoards("123");

      // Second request returns new data with new ETag
      const headers2 = new Headers();
      headers2.set("ETag", '"etag2"');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: headers2,
        json: async () => [{ id: "board1", name: "Updated" }],
      });

      const result2 = await client.getBoards("123");
      expect(result2).toEqual([{ id: "board1", name: "Updated" }]);
    });

    it("should not cache responses without ETag", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(), // No ETag
        json: async () => [{ id: "board1" }],
      });

      await client.getBoards("123");

      const stats = client.getCacheStats();
      expect(stats?.size).toBe(0);
    });

    it("should invalidate a previously-cached entry when a later response for the same URL has no ETag", async () => {
      // Regression: cache.set() is only reached when an ETag is present, so
      // without an explicit invalidation on the no-ETag path, an old cached
      // entry (and its ETag) would survive a later 200 that stopped sending
      // one — and every subsequent request would keep sending a now-stale
      // If-None-Match for a resource that no longer emits ETags at all.
      const etaggedHeaders = new Headers();
      etaggedHeaders.set("ETag", '"abc123"');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: etaggedHeaders,
        json: async () => [{ id: "board1" }],
      });

      await client.getBoards("123");
      expect(client.getCacheStats()?.size).toBe(1);

      // A later response for the same URL carries no ETag.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [{ id: "board1", name: "changed" }],
      });

      await client.getBoards("123");
      expect(client.getCacheStats()?.size).toBe(0);

      // A third request must not carry the old (now-stale) If-None-Match.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [{ id: "board1", name: "changed again" }],
      });

      await client.getBoards("123");

      const thirdCall = mockFetch.mock.calls[2];
      expect(thirdCall[1].headers["If-None-Match"]).toBeUndefined();
    });

    it("should invalidate a previously-cached entry when a GET for the same URL returns 204 No Content", async () => {
      // Regression: the 204 branch used to return before reaching the
      // no-ETag invalidation added above, so a URL that previously had a
      // cached ETagged representation would keep it (and keep sending its
      // stale If-None-Match) after a later 204 for the same URL.
      const etaggedHeaders = new Headers();
      etaggedHeaders.set("ETag", '"abc123"');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: etaggedHeaders,
        json: async () => [{ id: "board1" }],
      });

      await client.getBoards("123");
      expect(client.getCacheStats()?.size).toBe(1);

      // A later GET for the same URL returns 204 No Content.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers(),
      });

      await client.getBoards("123");
      expect(client.getCacheStats()?.size).toBe(0);

      // The next request must not carry the old (now-stale) If-None-Match.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [{ id: "board1" }],
      });

      await client.getBoards("123");

      const thirdCall = mockFetch.mock.calls[2];
      expect(thirdCall[1].headers["If-None-Match"]).toBeUndefined();
    });

    it("should not use cache for POST requests", async () => {
      const headers = new Headers();
      headers.set("ETag", '"abc123"');

      // First GET request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers,
        json: async () => [{ id: "board1" }],
      });

      await client.getBoards("123");

      // POST request should not send If-None-Match
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: async () => ({ id: "newboard" }),
      });

      await client.createBoard("123", { name: "New Board" });

      const postCall = mockFetch.mock.calls[1];
      expect(postCall[1].headers["If-None-Match"]).toBeUndefined();
    });

    it("should clear cache manually", async () => {
      const headers = new Headers();
      headers.set("ETag", '"abc123"');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers,
        json: async () => [{ id: "board1" }],
      });

      await client.getBoards("123");
      expect(client.getCacheStats()?.size).toBe(1);

      client.clearCache();
      expect(client.getCacheStats()?.size).toBe(0);
    });

    it("should work with cache disabled", async () => {
      const clientNoCache = new FizzyClient({
        accessToken: "test-token",
        maxRetries: 0,
        enableCache: false,
      });

      const headers = new Headers();
      headers.set("ETag", '"abc123"');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers,
        json: async () => [{ id: "board1" }],
      });

      await clientNoCache.getBoards("123");

      expect(clientNoCache.getCacheStats()).toBeNull();

      // Second request should not send If-None-Match
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers,
        json: async () => [{ id: "board1" }],
      });

      await clientNoCache.getBoards("123");

      const secondCall = mockFetch.mock.calls[1];
      expect(secondCall[1].headers["If-None-Match"]).toBeUndefined();
    });
  });

  describe("Byte-Bounded ETag Caching", () => {
    // These mocks define `text()` (unlike the `json()`-only mocks used
    // elsewhere in this file) to exercise the size-measurement path in
    // `executeRequestWithMeta`. The `json()`-only mocks must keep working
    // unchanged — that's what the capability check (`typeof response.text
    // === "function"`) is for.
    it("should not cache a response whose measured body exceeds cacheMaxEntryBytes", async () => {
      const boundedClient = new FizzyClient({
        accessToken: "test-token",
        baseUrl: "https://app.fizzy.do",
        maxRetries: 0,
        cacheMaxEntryBytes: 50,
      });

      const bigBody = JSON.stringify([{ id: "board1", name: "x".repeat(100) }]);
      const headers = new Headers();
      headers.set("ETag", '"big-etag"');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers,
        text: async () => bigBody,
      });

      await boundedClient.getBoards("123");

      // Too large to cache at all.
      expect(boundedClient.getCacheStats()?.size).toBe(0);

      // A second request must not carry If-None-Match, since nothing was cached.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers,
        text: async () => bigBody,
      });

      await boundedClient.getBoards("123");

      const secondCall = mockFetch.mock.calls[1];
      expect(secondCall[1].headers["If-None-Match"]).toBeUndefined();
    });

    it("should cache a response whose measured body is within cacheMaxEntryBytes and send If-None-Match on the next request", async () => {
      const boundedClient = new FizzyClient({
        accessToken: "test-token",
        baseUrl: "https://app.fizzy.do",
        maxRetries: 0,
        cacheMaxEntryBytes: 50,
      });

      const smallBody = JSON.stringify([{ id: "board1" }]);
      const headers = new Headers();
      headers.set("ETag", '"small-etag"');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers,
        text: async () => smallBody,
      });

      const result1 = await boundedClient.getBoards("123");
      expect(result1).toEqual([{ id: "board1" }]);
      expect(boundedClient.getCacheStats()?.size).toBe(1);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 304,
        headers,
      });

      await boundedClient.getBoards("123");

      const secondCall = mockFetch.mock.calls[1];
      expect(secondCall[1].headers["If-None-Match"]).toBe('"small-etag"');
    });
  });
});
