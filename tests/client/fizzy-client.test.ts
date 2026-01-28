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
 *   GET    /:account_slug/cards                   - List cards (supports ?status, ?column_id, ?assignee_ids[], ?tag_ids[] filters)
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

      await client.getBoards("/6117483");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/6117483/boards",
        expect.any(Object)
      );
    });

    it("should handle slug without leading slash", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      await client.getBoards("6117483");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/6117483/boards",
        expect.any(Object)
      );
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
   * GET  /:account_slug/cards                     - List cards (with optional ?status, ?column_id, ?assignee_ids[], ?tag_ids[] filters)
   * GET  /:account_slug/boards/:board_id/cards    - List cards on a specific board
   * GET  /:account_slug/cards/:card_id            - Get specific card
   * POST /:account_slug/boards/:board_id/cards    - Create card on board (NOTE: uses boards path!)
   * PUT  /:account_slug/cards/:card_id            - Update card
   * DELETE /:account_slug/cards/:card_id          - Delete card
   */
  describe("Cards", () => {
    // Expected URL: GET /:account_slug/cards?status=...&column_id=...
    it("should get all cards with filters", async () => {
      const mockCards = [{ id: "card1", title: "Card 1" }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockCards,
      });

      const result = await client.getCards("123", {
        status: "published",
        column_id: "col1",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("123/cards"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("status=published"),
        expect.any(Object)
      );
      expect(result).toEqual(mockCards);
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
      const mockComments = [{ id: "comment1", body: "Comment 1" }];

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
      const mockComment = { id: "comment1", body: "New Comment" };

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
});
