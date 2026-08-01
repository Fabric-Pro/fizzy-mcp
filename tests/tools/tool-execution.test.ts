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
 * COMMENTS:     GET/POST /:slug/cards/:number/comments
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
import { toolHandlers } from "../../src/tools/handlers.js";

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
        board_ids: ["board1"],
        column_ids: ["col1"],
        terms: ["test"],
      });

      // Paginated endpoint: the client returns a page envelope, and this mock
      // response carries no pagination headers.
      expect(result).toEqual({
        cards: mockCards,
        page: 1,
        total_count: null,
        has_more: false,
        next_page: null,
      });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("board_ids%5B%5D=board1"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("column_ids%5B%5D=col1"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("terms%5B%5D=test"),
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
      // Comment bodies come back as rich text, not strings.
      const mockComments = [
        { id: "comment1", body: { plain_text: "First comment", html: "<div>First comment</div>" } },
        { id: "comment2", body: { plain_text: "Second comment", html: "<div>Second comment</div>" } },
      ];

      mockFetch.mockResolvedValueOnce(mockResponse(mockComments));

      const result = await client.getCardComments("123", "42");

      expect(result).toEqual(mockComments);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/cards/42/comments",
        expect.any(Object)
      );
    });

    it("createCardComment creates a comment", async () => {
      const mockComment = {
        id: "comment1",
        body: { plain_text: "New comment", html: "<div>New comment</div>" },
      };

      mockFetch.mockResolvedValueOnce(mockResponse(mockComment, 201));

      const result = await client.createCardComment("123", "42", {
        body: "New comment",
      });

      expect(result).toEqual(mockComment);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.fizzy.do/123/cards/42/comments",
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
        indexed_by: "closed",
        column_ids: undefined,
        terms: undefined,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("indexed_by=closed");
      expect(url).not.toContain("column_ids");
      expect(url).not.toContain("terms");
    });
  });

  describe("fizzy_get_cards handler (maps external filter names to API params)", () => {
    it("maps board_id/column_id/search to plural array params and passes through the rest", async () => {
      const mockClient = { getCards: vi.fn().mockResolvedValue([]) };

      await toolHandlers.fizzy_get_cards(mockClient as unknown as FizzyClient, {
        account_slug: "123",
        board_id: "b1",
        column_id: "c1",
        search: "urgent task",
        indexed_by: "golden",
        assignee_ids: ["u1"],
        tag_ids: ["t1"],
      });

      expect(mockClient.getCards).toHaveBeenCalledWith("123", {
        board_ids: ["b1"],
        column_ids: ["c1"],
        terms: ["urgent task"],
        indexed_by: "golden",
        assignee_ids: ["u1"],
        tag_ids: ["t1"],
      });
    });

    it("passes a requested page through to the client", async () => {
      const mockClient = { getCards: vi.fn().mockResolvedValue({ cards: [] }) };

      await toolHandlers.fizzy_get_cards(mockClient as unknown as FizzyClient, {
        account_slug: "123",
        page: 3,
      });

      expect(mockClient.getCards.mock.calls[0][1].page).toBe(3);
    });

    it("leaves page undefined when it is not given", async () => {
      const mockClient = { getCards: vi.fn().mockResolvedValue({ cards: [] }) };

      await toolHandlers.fizzy_get_cards(mockClient as unknown as FizzyClient, {
        account_slug: "123",
      });

      expect(mockClient.getCards.mock.calls[0][1].page).toBeUndefined();
    });

    it("coerces a digit-string page (LLM clients on the raw-args transport send \"2\")", async () => {
      const mockClient = { getCards: vi.fn().mockResolvedValue({ cards: [] }) };

      await toolHandlers.fizzy_get_cards(mockClient as unknown as FizzyClient, {
        account_slug: "123",
        page: "2",
      });

      expect(mockClient.getCards.mock.calls[0][1].page).toBe(2);
    });

    it.each([0, -1, 1.5, "abc"])("rejects page %p", async (page) => {
      const mockClient = { getCards: vi.fn().mockResolvedValue({ cards: [] }) };

      await expect(
        toolHandlers.fizzy_get_cards(mockClient as unknown as FizzyClient, {
          account_slug: "123",
          page,
        })
      ).rejects.toThrow("page must be a positive integer (1-based), e.g. 2");
      expect(mockClient.getCards).not.toHaveBeenCalled();
    });

    it("rejects a page number too large to be a safe integer", async () => {
      const mockClient = { getCards: vi.fn().mockResolvedValue({ cards: [] }) };

      await expect(
        toolHandlers.fizzy_get_cards(mockClient as unknown as FizzyClient, {
          account_slug: "123",
          page: 1e100,
        })
      ).rejects.toThrow("page must be a positive integer (1-based), e.g. 2");
      expect(mockClient.getCards).not.toHaveBeenCalled();
    });

    it("rejects an oversized digit-string page", async () => {
      const mockClient = { getCards: vi.fn().mockResolvedValue({ cards: [] }) };

      await expect(
        toolHandlers.fizzy_get_cards(mockClient as unknown as FizzyClient, {
          account_slug: "123",
          page: "9".repeat(400),
        })
      ).rejects.toThrow("page must be a positive integer (1-based), e.g. 2");
      expect(mockClient.getCards).not.toHaveBeenCalled();
    });

    it("returns the page envelope from the client unchanged", async () => {
      const envelope = {
        cards: [{ id: "card1" }],
        page: 2,
        total_count: 238,
        has_more: true,
        next_page: 3,
      };
      const mockClient = { getCards: vi.fn().mockResolvedValue(envelope) };

      const result = await toolHandlers.fizzy_get_cards(
        mockClient as unknown as FizzyClient,
        { account_slug: "123", page: 2 }
      );

      expect(result).toEqual(envelope);
    });

    it("leaves board_ids/column_ids/terms undefined when no filters are given", async () => {
      const mockClient = { getCards: vi.fn().mockResolvedValue([]) };

      await toolHandlers.fizzy_get_cards(mockClient as unknown as FizzyClient, {
        account_slug: "123",
      });

      const filters = mockClient.getCards.mock.calls[0][1];
      expect(filters.board_ids).toBeUndefined();
      expect(filters.column_ids).toBeUndefined();
      expect(filters.terms).toBeUndefined();
    });

    it("rejects a status filter with an 'Unsupported filter' error", async () => {
      const mockClient = { getCards: vi.fn().mockResolvedValue([]) };

      await expect(
        toolHandlers.fizzy_get_cards(mockClient as unknown as FizzyClient, {
          account_slug: "123",
          status: "draft",
        })
      ).rejects.toThrow(/Unsupported filter/);
      expect(mockClient.getCards).not.toHaveBeenCalled();
    });

    it("rejects due_before/due_after filters with an 'Unsupported filter' error", async () => {
      const mockClient = { getCards: vi.fn().mockResolvedValue([]) };

      await expect(
        toolHandlers.fizzy_get_cards(mockClient as unknown as FizzyClient, {
          account_slug: "123",
          due_before: "2026-04-10",
          due_after: "2026-04-01",
        })
      ).rejects.toThrow(/Unsupported filter/);
      expect(mockClient.getCards).not.toHaveBeenCalled();
    });
  });
});
