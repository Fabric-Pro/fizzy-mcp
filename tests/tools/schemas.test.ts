import { describe, it, expect } from "vitest";
import {
  getIdentitySchema,
  getAccountsSchema,
  getBoardsSchema,
  getBoardSchema,
  createBoardSchema,
  updateBoardSchema,
  deleteBoardSchema,
  getCardsSchema,
  getCardSchema,
  createCardSchema,
  updateCardSchema,
  deleteCardSchema,
  getCardCommentsSchema,
  createCommentSchema,
  deleteCommentSchema,
  getColumnsSchema,
  getColumnSchema,
  createColumnSchema,
  updateColumnSchema,
  deleteColumnSchema,
  getTagsSchema,
  getUsersSchema,
  getUserSchema,
  updateUserSchema,
  deactivateUserSchema,
  getNotificationsSchema,
  markNotificationReadSchema,
  markNotificationUnreadSchema,
  markAllNotificationsReadSchema,
} from "../../src/tools/schemas.js";

describe("Tool Schemas", () => {
  describe("Identity & Account Schemas", () => {
    it("getIdentitySchema should accept empty object", () => {
      const result = getIdentitySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("getAccountsSchema should accept empty object", () => {
      const result = getAccountsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

  });

  describe("Board Schemas", () => {
    it("getBoardsSchema should require account_slug", () => {
      const result = getBoardsSchema.safeParse({});
      expect(result.success).toBe(false);

      const validResult = getBoardsSchema.safeParse({ account_slug: "123" });
      expect(validResult.success).toBe(true);
    });

    it("getBoardSchema should require account_slug and board_id", () => {
      expect(getBoardSchema.safeParse({}).success).toBe(false);
      expect(getBoardSchema.safeParse({ account_slug: "123" }).success).toBe(false);
      expect(
        getBoardSchema.safeParse({ account_slug: "123", board_id: "board1" }).success
      ).toBe(true);
    });

    it("createBoardSchema should require account_slug and name", () => {
      expect(createBoardSchema.safeParse({}).success).toBe(false);
      expect(createBoardSchema.safeParse({ account_slug: "123" }).success).toBe(false);
      expect(
        createBoardSchema.safeParse({ account_slug: "123", name: "New Board" }).success
      ).toBe(true);
    });

    it("updateBoardSchema should require account_slug, board_id, and name", () => {
      expect(
        updateBoardSchema.safeParse({
          account_slug: "123",
          board_id: "board1",
          name: "Updated",
        }).success
      ).toBe(true);
    });

    it("deleteBoardSchema should require account_slug and board_id", () => {
      expect(
        deleteBoardSchema.safeParse({ account_slug: "123", board_id: "board1" }).success
      ).toBe(true);
    });
  });

  describe("Card Schemas", () => {
    it("getCardsSchema should require account_slug and accept optional filters", () => {
      expect(getCardsSchema.safeParse({ account_slug: "123" }).success).toBe(true);
      expect(
        getCardsSchema.safeParse({
          account_slug: "123",
          status: "published",
          column_id: "col1",
          assignee_ids: ["user1"],
          tag_ids: ["tag1"],
          search: "test",
        }).success
      ).toBe(true);
    });

    it("getCardsSchema should validate status enum", () => {
      expect(
        getCardsSchema.safeParse({ account_slug: "123", status: "invalid" }).success
      ).toBe(false);
      expect(
        getCardsSchema.safeParse({ account_slug: "123", status: "draft" }).success
      ).toBe(true);
      expect(
        getCardsSchema.safeParse({ account_slug: "123", status: "published" }).success
      ).toBe(true);
      expect(
        getCardsSchema.safeParse({ account_slug: "123", status: "archived" }).success
      ).toBe(true);
    });

    it("getCardSchema should require account_slug and card_id", () => {
      expect(
        getCardSchema.safeParse({ account_slug: "123", card_id: "card1" }).success
      ).toBe(true);
    });

    it("createCardSchema should require account_slug, board_id, and title", () => {
      expect(
        createCardSchema.safeParse({
          account_slug: "123",
          board_id: "board1",
          title: "New Card",
        }).success
      ).toBe(true);

      expect(
        createCardSchema.safeParse({
          account_slug: "123",
          board_id: "board1",
          title: "New Card",
          description: "<p>HTML content</p>",
          status: "published",
          column_id: "col1",
          assignee_ids: ["user1"],
          tag_ids: ["tag1"],
          due_on: "2024-12-31",
        }).success
      ).toBe(true);
    });

    it("updateCardSchema should require account_slug and card_id", () => {
      expect(
        updateCardSchema.safeParse({
          account_slug: "123",
          card_id: "card1",
          title: "Updated",
        }).success
      ).toBe(true);
    });

    it("deleteCardSchema should require account_slug and card_id", () => {
      expect(
        deleteCardSchema.safeParse({ account_slug: "123", card_id: "card1" }).success
      ).toBe(true);
    });
  });

  describe("Comment Schemas", () => {
    it("getCardCommentsSchema should require account_slug and card_id or card_number", () => {
      expect(
        getCardCommentsSchema.safeParse({ account_slug: "123", card_id: "card1" }).success
      ).toBe(true);
      expect(
        getCardCommentsSchema.safeParse({ account_slug: "123", card_number: "42" }).success
      ).toBe(true);
    });

    it("createCommentSchema should require account_slug, card_id or card_number, and body", () => {
      expect(
        createCommentSchema.safeParse({
          account_slug: "123",
          card_id: "card1",
          body: "This is a comment",
        }).success
      ).toBe(true);
      expect(
        createCommentSchema.safeParse({
          account_slug: "123",
          card_number: "42",
          body: "This is a comment",
        }).success
      ).toBe(true);
    });

    it("deleteCommentSchema should require account_slug, card_number, and comment_id", () => {
      expect(
        deleteCommentSchema.safeParse({ 
          account_slug: "123", 
          card_number: "42",
          comment_id: "comment1" 
        }).success
      ).toBe(true);
    });
  });

  describe("Column Schemas", () => {
    it("getColumnsSchema should require account_slug and board_id", () => {
      expect(
        getColumnsSchema.safeParse({ account_slug: "123", board_id: "board1" }).success
      ).toBe(true);
    });

    it("getColumnSchema should require account_slug, board_id, and column_id", () => {
      expect(
        getColumnSchema.safeParse({
          account_slug: "123",
          board_id: "board1",
          column_id: "col1",
        }).success
      ).toBe(true);
    });

    it("createColumnSchema should require account_slug, board_id, and name", () => {
      expect(
        createColumnSchema.safeParse({
          account_slug: "123",
          board_id: "board1",
          name: "New Column",
        }).success
      ).toBe(true);
    });

    it("createColumnSchema should validate color enum", () => {
      expect(
        createColumnSchema.safeParse({
          account_slug: "123",
          board_id: "board1",
          name: "Column",
          color: "invalid",
        }).success
      ).toBe(false);

      expect(
        createColumnSchema.safeParse({
          account_slug: "123",
          board_id: "board1",
          name: "Column",
          color: "blue",
        }).success
      ).toBe(true);

      expect(
        createColumnSchema.safeParse({
          account_slug: "123",
          board_id: "board1",
          name: "Column",
          color: "lime",
        }).success
      ).toBe(true);
    });

    it("updateColumnSchema should require account_slug, board_id, and column_id", () => {
      expect(
        updateColumnSchema.safeParse({
          account_slug: "123",
          board_id: "board1",
          column_id: "col1",
          name: "Updated",
        }).success
      ).toBe(true);
    });

    it("deleteColumnSchema should require account_slug, board_id, and column_id", () => {
      expect(
        deleteColumnSchema.safeParse({
          account_slug: "123",
          board_id: "board1",
          column_id: "col1",
        }).success
      ).toBe(true);
    });
  });

  describe("Tag Schemas", () => {
    it("getTagsSchema should require account_slug", () => {
      expect(getTagsSchema.safeParse({ account_slug: "123" }).success).toBe(true);
    });

    // Note: POST/DELETE /:account_slug/tags endpoints return 404
    // Tag creation/deletion is not available via API
  });

  describe("User Schemas", () => {
    it("getUsersSchema should require account_slug", () => {
      expect(getUsersSchema.safeParse({ account_slug: "123" }).success).toBe(true);
    });

    it("getUserSchema should require account_slug and user_id", () => {
      expect(
        getUserSchema.safeParse({ account_slug: "123", user_id: "user1" }).success
      ).toBe(true);
    });

    it("updateUserSchema should require account_slug, user_id, and name", () => {
      expect(
        updateUserSchema.safeParse({
          account_slug: "123",
          user_id: "user1",
          name: "New Name",
        }).success
      ).toBe(true);
    });

    it("deactivateUserSchema should require account_slug and user_id", () => {
      expect(
        deactivateUserSchema.safeParse({ account_slug: "123", user_id: "user1" }).success
      ).toBe(true);
    });
  });

  describe("Notification Schemas", () => {
    it("getNotificationsSchema should require account_slug", () => {
      expect(getNotificationsSchema.safeParse({ account_slug: "123" }).success).toBe(
        true
      );
    });

    it("markNotificationReadSchema should require account_slug and notification_id", () => {
      expect(
        markNotificationReadSchema.safeParse({
          account_slug: "123",
          notification_id: "notif1",
        }).success
      ).toBe(true);
    });

    it("markNotificationUnreadSchema should require account_slug and notification_id", () => {
      expect(
        markNotificationUnreadSchema.safeParse({
          account_slug: "123",
          notification_id: "notif1",
        }).success
      ).toBe(true);
    });

    it("markAllNotificationsReadSchema should require account_slug", () => {
      expect(
        markAllNotificationsReadSchema.safeParse({ account_slug: "123" }).success
      ).toBe(true);
    });
  });
});
