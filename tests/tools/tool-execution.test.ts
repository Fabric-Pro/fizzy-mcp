/**
 * Tool Execution Tests
 *
 * API Reference: https://github.com/basecamp/fizzy/blob/main/docs/API.md
 * 
 * These tests verify that the MCP tools correctly:
 * 1. Call the appropriate FizzyClient methods with correct endpoints
 * 2. Pass parameters correctly
 * 3. Handle responses appropriately
 * 4. Propagate errors correctly
 *
 * Expected API Endpoints (RESTful - no .json extension):
 * 
 * IDENTITY:     GET /my/identity
 * BOARDS:       GET/POST /:slug/boards, GET/PUT/DELETE /:slug/boards/:id
 * CARDS:        GET /:slug/cards, GET /:slug/boards/:id/cards, GET/PUT/DELETE /:slug/cards/:id
 *               POST /:slug/boards/:board_id/cards
 * CARD ACTIONS: POST/DELETE /:slug/cards/:number/closure|not_now|triage|taggings|assignments|watch
 * COMMENTS:     GET/POST /:slug/cards/:id/comments
 *               GET/PUT /:slug/cards/:number/comments/:id
 *               DELETE /:slug/comments/:id
 * REACTIONS:    GET/POST /:slug/cards/:number/comments/:id/reactions
 *               DELETE /:slug/cards/:number/comments/:id/reactions/:id
 * STEPS:        GET/PUT/DELETE /:slug/cards/:number/steps/:id
 *               POST /:slug/cards/:number/steps
 * COLUMNS:      GET/POST /:slug/boards/:id/columns
 *               GET/PUT/DELETE /:slug/boards/:id/columns/:id
 * TAGS:         GET/POST /:slug/tags, GET /:slug/boards/:id/tags
 *               DELETE /:slug/tags/:id
 * USERS:        GET /:slug/users, GET/PUT/DELETE /:slug/users/:id
 * NOTIFICATIONS: GET /:slug/notifications
 *               POST/DELETE /:slug/notifications/:id/reading
 *               POST /:slug/notifications/bulk_reading
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FizzyClient } from "../../src/client/fizzy-client.js";
import {
  FizzyNotFoundError,
  FizzyAuthError,
  FizzyValidationError,
} from "../../src/utils/errors.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;
describe("Tool Execution Tests (via FizzyClient)", () => {
  let client: FizzyClient;

  beforeEach(() => {
    client = new FizzyClient({
      accessToken: "test-token",
      baseUrl: "https://app.fizzy.do",
      maxRetries: 0,
    });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to create mock headers
  const mockHeaders = (location?: string) => ({
    get: (name: string) => {
      if (name === "Location") return location || null;
      if (name === "Content-Length") return null;
      return null;
    },
  });

  // Helper to create a successful response
  const mockResponse = <T>(data: T, status = 200, location?: string) => ({
    ok: true,
    status,
    headers: mockHeaders(location),
    json: async () => data,
    text: async () => JSON.stringify(data),
  });

  // Helper for 201 Created with Location header (no body)
  const mockCreatedResponse = (location: string, data?: unknown) => ({
    ok: true,
    status: 201,
    headers: mockHeaders(location),
    json: async () => data || {},
    text: async () => data ? JSON.stringify(data) : "",
  });

  const mockNoContent = () => ({
    ok: true,
    status: 204,
    headers: mockHeaders(),
    text: async () => "",
  });

  const mockError = (status: number, statusText: string, body: string) => ({
    ok: false,
    status,
    statusText,
    text: async () => body,
  });

  describe("Identity Operations", () => {
    it("getIdentity returns user identity with accounts", async () => {
      const mockIdentity = {
        id: "user123",
        name: "Test User",
        email_address: "test@example.com",
        accounts: [
          { id: "acc1", name: "Account 1", slug: "/123" },
          { id: "acc2", name: "Account 2", slug: "/456" },
        ],
      };

      mockFetch.mockResolvedValueOnce(mockResponse(mockIdentity));

      const result = await client.getIdentity();

      expect(result).toEqual(mockIdentity);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/my/identity",
        expect.any(Object)
      );
    });

    it("getAccounts extracts accounts from identity", async () => {
      const mockAccounts = [
        { id: "acc1", name: "Account 1", slug: "/123" },
        { id: "acc2", name: "Account 2", slug: "/456" },
      ];

      mockFetch.mockResolvedValueOnce(
        mockResponse({
          id: "user123",
          accounts: mockAccounts,
        })
      );

      const result = await client.getAccounts();

      expect(result).toEqual(mockAccounts);
    });

  });

  describe("Board Operations", () => {
    it("getBoards retrieves all boards for account", async () => {
      const mockBoards = [
        { id: "board1", name: "Board 1" },
        { id: "board2", name: "Board 2" },
      ];

      mockFetch.mockResolvedValueOnce(mockResponse(mockBoards));

      const result = await client.getBoards("123");

      expect(result).toEqual(mockBoards);
    });

    it("createBoard creates a new board", async () => {
      const mockBoard = { id: "board1", name: "New Board" };

      mockFetch.mockResolvedValueOnce(mockResponse(mockBoard, 201));

      const result = await client.createBoard("123", { name: "New Board" });

      expect(result).toEqual(mockBoard);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ board: { name: "New Board" } }),
        })
      );
    });

    it("updateBoard updates an existing board", async () => {
      mockFetch.mockResolvedValueOnce(mockNoContent());

      await client.updateBoard("123", "board1", { name: "Updated Board" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards/board1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ board: { name: "Updated Board" } }),
        })
      );
    });

    it("deleteBoard deletes a board", async () => {
      mockFetch.mockResolvedValueOnce(mockNoContent());

      await client.deleteBoard("123", "board1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards/board1",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("Card Operations", () => {
    it("getCards retrieves cards with filters", async () => {
      const mockCards = [{ id: "card1", title: "Card 1" }];

      mockFetch.mockResolvedValueOnce(mockResponse(mockCards));

      const result = await client.getCards("123", {
        status: "published",
        column_id: "col1",
        search: "test",
      });

      expect(result).toEqual(mockCards);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("status=published"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("column_id=col1"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("search=test"),
        expect.any(Object)
      );
    });

    it("createCard creates card with all options", async () => {
      const mockCard = { id: "card1", title: "New Card" };

      mockFetch.mockResolvedValueOnce(mockResponse(mockCard, 201));

      const result = await client.createCard("123", "board1", {
        title: "New Card",
        description: "Card description",
        status: "published",
        column_id: "col1",
        due_on: "2024-12-31",
        assignee_ids: ["user1", "user2"],
        tag_ids: ["tag1"],
      });

      expect(result).toEqual(mockCard);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards/board1/cards",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"title":"New Card"'),
        })
      );
    });

    it("updateCard updates a card", async () => {
      mockFetch.mockResolvedValueOnce(mockNoContent());

      await client.updateCard("123", "card1", {
        title: "Updated Card",
        status: "archived",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/cards/card1",
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining('"title":"Updated Card"'),
        })
      );
    });

    it("deleteCard deletes a card", async () => {
      mockFetch.mockResolvedValueOnce(mockNoContent());

      await client.deleteCard("123", "card1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/cards/card1",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("Comment Operations", () => {
    it("getCardComments retrieves comments for a card", async () => {
      const mockComments = [
        { id: "comment1", body: "First comment" },
        { id: "comment2", body: "Second comment" },
      ];

      mockFetch.mockResolvedValueOnce(mockResponse(mockComments));

      const result = await client.getCardComments("123", "card1");

      expect(result).toEqual(mockComments);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/cards/card1/comments",
        expect.any(Object)
      );
    });

    it("createCardComment creates a comment", async () => {
      const mockComment = { id: "comment1", body: "New comment" };

      mockFetch.mockResolvedValueOnce(mockResponse(mockComment, 201));

      const result = await client.createCardComment("123", "card1", {
        body: "New comment",
      });

      expect(result).toEqual(mockComment);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/cards/card1/comments",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ comment: { body: "New comment" } }),
        })
      );
    });

    it("deleteComment deletes a comment", async () => {
      mockFetch.mockResolvedValueOnce(mockNoContent());

      await client.deleteComment("123", "42", "comment1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/cards/42/comments/comment1",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("Column Operations", () => {
    it("getColumns retrieves columns for a board", async () => {
      const mockColumns = [
        { id: "col1", name: "To Do" },
        { id: "col2", name: "Done" },
      ];

      mockFetch.mockResolvedValueOnce(mockResponse(mockColumns));

      const result = await client.getColumns("123", "board1");

      expect(result).toEqual(mockColumns);
    });

    it("createColumn creates a column with color", async () => {
      const mockColumn = { id: "col1", name: "New Column" };

      mockFetch.mockResolvedValueOnce(mockResponse(mockColumn, 201));

      const result = await client.createColumn("123", "board1", {
        name: "New Column",
        color: "var(--color-card-1)",
      });

      expect(result).toEqual(mockColumn);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards/board1/columns",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    it("updateColumn updates a column", async () => {
      mockFetch.mockResolvedValueOnce(mockNoContent());

      await client.updateColumn("123", "board1", "col1", {
        name: "Updated Column",
        color: "var(--color-card-2)",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards/board1/columns/col1",
        expect.objectContaining({ method: "PUT" })
      );
    });

    it("deleteColumn deletes a column", async () => {
      mockFetch.mockResolvedValueOnce(mockNoContent());

      await client.deleteColumn("123", "board1", "col1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards/board1/columns/col1",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("Tag Operations", () => {
    it("getTags retrieves all tags for account", async () => {
      const mockTags = [
        { id: "tag1", title: "Bug" },
        { id: "tag2", title: "Feature" },
      ];

      mockFetch.mockResolvedValueOnce(mockResponse(mockTags));

      const result = await client.getTags("123");

      expect(result).toEqual(mockTags);
    });

    // Note: POST/DELETE /:account_slug/tags endpoints return 404
    // Tag creation/deletion is not available via API
  });

  describe("User Operations", () => {
    it("getUsers retrieves all users for account", async () => {
      const mockUsers = [
        { id: "user1", name: "User 1" },
        { id: "user2", name: "User 2" },
      ];

      mockFetch.mockResolvedValueOnce(mockResponse(mockUsers));

      const result = await client.getUsers("123");

      expect(result).toEqual(mockUsers);
    });

    it("getUser retrieves a specific user", async () => {
      const mockUser = { id: "user1", name: "User 1", email_address: "user@test.com" };

      mockFetch.mockResolvedValueOnce(mockResponse(mockUser));

      const result = await client.getUser("123", "user1");

      expect(result).toEqual(mockUser);
    });

    it("updateUser updates a user", async () => {
      mockFetch.mockResolvedValueOnce(mockNoContent());

      await client.updateUser("123", "user1", { name: "New Name" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/users/user1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ user: { name: "New Name" } }),
        })
      );
    });

    it("deactivateUser deactivates a user", async () => {
      mockFetch.mockResolvedValueOnce(mockNoContent());

      await client.deactivateUser("123", "user1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/users/user1",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("Notification Operations", () => {
    it("getNotifications retrieves all notifications", async () => {
      const mockNotifications = [
        { id: "notif1", read: false },
        { id: "notif2", read: true },
      ];

      mockFetch.mockResolvedValueOnce(mockResponse(mockNotifications));

      const result = await client.getNotifications("123");

      expect(result).toEqual(mockNotifications);
    });

    it("markNotificationAsRead marks notification read", async () => {
      mockFetch.mockResolvedValueOnce(mockNoContent());

      await client.markNotificationAsRead("123", "notif1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/notifications/notif1/reading",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("markNotificationAsUnread marks notification unread", async () => {
      mockFetch.mockResolvedValueOnce(mockNoContent());

      await client.markNotificationAsUnread("123", "notif1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/notifications/notif1/reading",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("markAllNotificationsAsRead marks all notifications read", async () => {
      mockFetch.mockResolvedValueOnce(mockNoContent());

      await client.markAllNotificationsAsRead("123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/notifications/bulk_reading",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  describe("Error Propagation", () => {
    it("throws FizzyNotFoundError on 404", async () => {
      mockFetch.mockResolvedValueOnce(mockError(404, "Not Found", "Board not found"));

      await expect(client.getBoard("123", "nonexistent")).rejects.toThrow(
        FizzyNotFoundError
      );
    });

    it("throws FizzyAuthError on 401", async () => {
      mockFetch.mockResolvedValueOnce(mockError(401, "Unauthorized", "Invalid token"));

      await expect(client.getIdentity()).rejects.toThrow(FizzyAuthError);
    });

    it("throws FizzyValidationError on 422", async () => {
      mockFetch.mockResolvedValueOnce(
        mockError(422, "Unprocessable Entity", '{"title":["is required"]}')
      );

      await expect(
        client.createCard("123", "board1", { title: "" })
      ).rejects.toThrow(FizzyValidationError);
    });
  });

  describe("Slug Normalization", () => {
    it("handles slugs with leading slash from identity", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([]));

      // Simulate slug from identity which includes leading slash
      await client.getBoards("/123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards",
        expect.any(Object)
      );
    });

    it("handles slugs without leading slash", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([]));

      await client.getBoards("123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/boards",
        expect.any(Object)
      );
    });
  });

  describe("Query String Building", () => {
    it("handles array parameters correctly", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([]));

      await client.getCards("123", {
        assignee_ids: ["user1", "user2", "user3"],
        tag_ids: ["tag1", "tag2"],
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("assignee_ids%5B%5D=user1");
      expect(url).toContain("assignee_ids%5B%5D=user2");
      expect(url).toContain("assignee_ids%5B%5D=user3");
      expect(url).toContain("tag_ids%5B%5D=tag1");
      expect(url).toContain("tag_ids%5B%5D=tag2");
    });

    it("omits undefined and null parameters", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([]));

      await client.getCards("123", {
        status: "published",
        column_id: undefined,
        search: undefined,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("status=published");
      expect(url).not.toContain("column_id");
      expect(url).not.toContain("search");
    });
  });
});
