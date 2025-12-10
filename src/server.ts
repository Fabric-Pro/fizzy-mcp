/**
 * Fizzy MCP Server
 * Implements the Model Context Protocol for Fizzy API
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FizzyClient } from "./client/fizzy-client.js";
import { COLUMN_COLORS, type ColumnColor } from "./client/types.js";
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
  // Card actions
  closeCardSchema,
  reopenCardSchema,
  moveCardToNotNowSchema,
  moveCardToColumnSchema,
  sendCardToTriageSchema,
  toggleCardTagSchema,
  toggleCardAssignmentSchema,
  watchCardSchema,
  unwatchCardSchema,
  // Additional comments
  getCommentSchema,
  updateCommentSchema,
  // Reactions
  getReactionsSchema,
  addReactionSchema,
  removeReactionSchema,
  // Steps
  getStepSchema,
  createStepSchema,
  updateStepSchema,
  deleteStepSchema,
} from "./tools/schemas.js";

export function createFizzyServer(client: FizzyClient): McpServer {
  const server = new McpServer({
    name: "fizzy-mcp",
    version: "1.0.0",
  });

  // Helper to convert column color name to CSS variable
  const getColumnColorValue = (color?: string): string | undefined => {
    if (!color) return undefined;
    return COLUMN_COLORS[color as ColumnColor];
  };

  // ============ Identity Tools ============

  server.tool(
    "fizzy_get_identity",
    "Get the current authenticated user's identity and associated accounts",
    getIdentitySchema.shape,
    async () => {
      const identity = await client.getIdentity();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(identity, null, 2),
          },
        ],
      };
    }
  );

  // ============ Account Tools ============

  server.tool(
    "fizzy_get_accounts",
    "Get all accounts accessible to the current user",
    getAccountsSchema.shape,
    async () => {
      const accounts = await client.getAccounts();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(accounts, null, 2),
          },
        ],
      };
    }
  );

  // ============ Board Tools ============

  server.tool(
    "fizzy_get_boards",
    "Get all boards in an account",
    getBoardsSchema.shape,
    async ({ account_slug }) => {
      const boards = await client.getBoards(account_slug);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(boards, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_get_board",
    "Get details of a specific board",
    getBoardSchema.shape,
    async ({ account_slug, board_id }) => {
      const board = await client.getBoard(account_slug, board_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(board, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_create_board",
    "Create a new board in an account",
    createBoardSchema.shape,
    async ({ account_slug, name }) => {
      const board = await client.createBoard(account_slug, { name });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(board, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_update_board",
    "Update an existing board",
    updateBoardSchema.shape,
    async ({ account_slug, board_id, name }) => {
      await client.updateBoard(account_slug, board_id, { name });
      return {
        content: [
          {
            type: "text",
            text: `Board ${board_id} updated successfully`,
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_delete_board",
    "Delete a board",
    deleteBoardSchema.shape,
    async ({ account_slug, board_id }) => {
      await client.deleteBoard(account_slug, board_id);
      return {
        content: [
          {
            type: "text",
            text: `Board ${board_id} deleted successfully`,
          },
        ],
      };
    }
  );

  // ============ Card Tools ============

  server.tool(
    "fizzy_get_cards",
    "Get all cards in an account, optionally filtered by status, column, assignees, or tags",
    getCardsSchema.shape,
    async ({ account_slug, status, column_id, assignee_ids, tag_ids, search }) => {
      const cards = await client.getCards(account_slug, {
        status,
        column_id,
        assignee_ids,
        tag_ids,
        search,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(cards, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_get_card",
    "Get details of a specific card including its description, assignees, and tags",
    getCardSchema.shape,
    async ({ account_slug, card_id }) => {
      const card = await client.getCard(account_slug, card_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(card, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_create_card",
    "Create a new card on a board",
    createCardSchema.shape,
    async ({
      account_slug,
      board_id,
      title,
      description,
      status,
      column_id,
      assignee_ids,
      tag_ids,
      due_on,
    }) => {
      const card = await client.createCard(account_slug, board_id, {
        title,
        description,
        status,
        column_id,
        assignee_ids,
        tag_ids,
        due_on,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(card, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_update_card",
    "Update an existing card's title, description, status, column, assignees, tags, or due date",
    updateCardSchema.shape,
    async ({
      account_slug,
      card_id,
      title,
      description,
      status,
      column_id,
      assignee_ids,
      tag_ids,
      due_on,
    }) => {
      await client.updateCard(account_slug, card_id, {
        title,
        description,
        status,
        column_id,
        assignee_ids,
        tag_ids,
        due_on,
      });
      return {
        content: [
          {
            type: "text",
            text: `Card ${card_id} updated successfully`,
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_delete_card",
    "Delete a card",
    deleteCardSchema.shape,
    async ({ account_slug, card_id }) => {
      await client.deleteCard(account_slug, card_id);
      return {
        content: [
          {
            type: "text",
            text: `Card ${card_id} deleted successfully`,
          },
        ],
      };
    }
  );

  // ============ Comment Tools ============

  server.tool(
    "fizzy_get_card_comments",
    "Get all comments on a card",
    getCardCommentsSchema.shape,
    async ({ account_slug, card_id }) => {
      const comments = await client.getCardComments(account_slug, card_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(comments, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_create_comment",
    "Add a comment to a card",
    createCommentSchema.shape,
    async ({ account_slug, card_id, body }) => {
      const comment = await client.createCardComment(account_slug, card_id, {
        body,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(comment, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_delete_comment",
    "Delete a comment",
    deleteCommentSchema.shape,
    async ({ account_slug, card_number, comment_id }) => {
      await client.deleteComment(account_slug, card_number, comment_id);
      return {
        content: [
          {
            type: "text",
            text: `Comment ${comment_id} deleted successfully`,
          },
        ],
      };
    }
  );

  // ============ Column Tools ============

  server.tool(
    "fizzy_get_columns",
    "Get all columns on a board (workflow stages)",
    getColumnsSchema.shape,
    async ({ account_slug, board_id }) => {
      const columns = await client.getColumns(account_slug, board_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(columns, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_get_column",
    "Get details of a specific column",
    getColumnSchema.shape,
    async ({ account_slug, board_id, column_id }) => {
      const column = await client.getColumn(account_slug, board_id, column_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(column, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_create_column",
    "Create a new column on a board",
    createColumnSchema.shape,
    async ({ account_slug, board_id, name, color }) => {
      const column = await client.createColumn(account_slug, board_id, {
        name,
        color: getColumnColorValue(color),
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(column, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_update_column",
    "Update a column's name or color",
    updateColumnSchema.shape,
    async ({ account_slug, board_id, column_id, name, color }) => {
      await client.updateColumn(account_slug, board_id, column_id, {
        name,
        color: getColumnColorValue(color),
      });
      return {
        content: [
          {
            type: "text",
            text: `Column ${column_id} updated successfully`,
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_delete_column",
    "Delete a column from a board",
    deleteColumnSchema.shape,
    async ({ account_slug, board_id, column_id }) => {
      await client.deleteColumn(account_slug, board_id, column_id);
      return {
        content: [
          {
            type: "text",
            text: `Column ${column_id} deleted successfully`,
          },
        ],
      };
    }
  );

  // ============ Tag Tools ============

  server.tool(
    "fizzy_get_tags",
    "Get all tags in an account",
    getTagsSchema.shape,
    async ({ account_slug }) => {
      const tags = await client.getTags(account_slug);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(tags, null, 2),
          },
        ],
      };
    }
  );

  // Note: POST/DELETE /:account_slug/tags endpoints return 404
  // Tag creation/deletion is not available via API

  // ============ User Tools ============

  server.tool(
    "fizzy_get_users",
    "Get all active users in an account",
    getUsersSchema.shape,
    async ({ account_slug }) => {
      const users = await client.getUsers(account_slug);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(users, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_get_user",
    "Get details of a specific user",
    getUserSchema.shape,
    async ({ account_slug, user_id }) => {
      const user = await client.getUser(account_slug, user_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(user, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_update_user",
    "Update a user's display name",
    updateUserSchema.shape,
    async ({ account_slug, user_id, name }) => {
      await client.updateUser(account_slug, user_id, { name });
      return {
        content: [
          {
            type: "text",
            text: `User ${user_id} updated successfully`,
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_deactivate_user",
    "Deactivate a user from an account",
    deactivateUserSchema.shape,
    async ({ account_slug, user_id }) => {
      await client.deactivateUser(account_slug, user_id);
      return {
        content: [
          {
            type: "text",
            text: `User ${user_id} deactivated successfully`,
          },
        ],
      };
    }
  );

  // ============ Notification Tools ============

  server.tool(
    "fizzy_get_notifications",
    "Get all notifications for the current user in an account",
    getNotificationsSchema.shape,
    async ({ account_slug }) => {
      const notifications = await client.getNotifications(account_slug);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(notifications, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_mark_notification_read",
    "Mark a notification as read",
    markNotificationReadSchema.shape,
    async ({ account_slug, notification_id }) => {
      await client.markNotificationAsRead(account_slug, notification_id);
      return {
        content: [
          {
            type: "text",
            text: `Notification ${notification_id} marked as read`,
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_mark_notification_unread",
    "Mark a notification as unread",
    markNotificationUnreadSchema.shape,
    async ({ account_slug, notification_id }) => {
      await client.markNotificationAsUnread(account_slug, notification_id);
      return {
        content: [
          {
            type: "text",
            text: `Notification ${notification_id} marked as unread`,
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_mark_all_notifications_read",
    "Mark all notifications as read in an account",
    markAllNotificationsReadSchema.shape,
    async ({ account_slug }) => {
      await client.markAllNotificationsAsRead(account_slug);
      return {
        content: [
          {
            type: "text",
            text: "All notifications marked as read",
          },
        ],
      };
    }
  );

  // ============ Card Action Tools ============

  server.tool(
    "fizzy_close_card",
    "Close a card (mark as done)",
    closeCardSchema.shape,
    async ({ account_slug, card_number }) => {
      await client.closeCard(account_slug, card_number);
      return {
        content: [
          {
            type: "text",
            text: `Card ${card_number} closed`,
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_reopen_card",
    "Reopen a closed card",
    reopenCardSchema.shape,
    async ({ account_slug, card_number }) => {
      await client.reopenCard(account_slug, card_number);
      return {
        content: [
          {
            type: "text",
            text: `Card ${card_number} reopened`,
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_move_card_to_not_now",
    "Move a card to 'Not Now' triage",
    moveCardToNotNowSchema.shape,
    async ({ account_slug, card_number }) => {
      await client.moveCardToNotNow(account_slug, card_number);
      return {
        content: [
          {
            type: "text",
            text: `Card ${card_number} moved to Not Now`,
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_move_card_to_column",
    "Move a card from triage to a specific column",
    moveCardToColumnSchema.shape,
    async ({ account_slug, card_number, column_id }) => {
      await client.moveCardToColumn(account_slug, card_number, column_id);
      return {
        content: [
          {
            type: "text",
            text: `Card ${card_number} moved to column ${column_id}`,
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_send_card_to_triage",
    "Send a card back to triage (remove from column)",
    sendCardToTriageSchema.shape,
    async ({ account_slug, card_number }) => {
      await client.sendCardToTriage(account_slug, card_number);
      return {
        content: [
          {
            type: "text",
            text: `Card ${card_number} sent to triage`,
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_toggle_card_tag",
    "Toggle a tag on/off for a card. If the tag doesn't exist, it will be created.",
    toggleCardTagSchema.shape,
    async ({ account_slug, card_number, tag_title }) => {
      await client.toggleCardTag(account_slug, card_number, tag_title);
      return {
        content: [
          {
            type: "text",
            text: `Tag "${tag_title}" toggled on card ${card_number}`,
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_toggle_card_assignment",
    "Toggle a user assignment on/off for a card",
    toggleCardAssignmentSchema.shape,
    async ({ account_slug, card_number, assignee_id }) => {
      await client.toggleCardAssignment(account_slug, card_number, assignee_id);
      return {
        content: [
          {
            type: "text",
            text: `User ${assignee_id} assignment toggled on card ${card_number}`,
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_watch_card",
    "Subscribe to notifications for a card",
    watchCardSchema.shape,
    async ({ account_slug, card_number }) => {
      await client.watchCard(account_slug, card_number);
      return {
        content: [
          {
            type: "text",
            text: `Now watching card ${card_number}`,
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_unwatch_card",
    "Unsubscribe from notifications for a card",
    unwatchCardSchema.shape,
    async ({ account_slug, card_number }) => {
      await client.unwatchCard(account_slug, card_number);
      return {
        content: [
          {
            type: "text",
            text: `Stopped watching card ${card_number}`,
          },
        ],
      };
    }
  );

  // ============ Additional Comment Tools ============

  server.tool(
    "fizzy_get_comment",
    "Get a specific comment on a card",
    getCommentSchema.shape,
    async ({ account_slug, card_number, comment_id }) => {
      const comment = await client.getComment(account_slug, card_number, comment_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(comment, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_update_comment",
    "Update a comment on a card",
    updateCommentSchema.shape,
    async ({ account_slug, card_number, comment_id, body }) => {
      await client.updateComment(account_slug, card_number, comment_id, { body });
      return {
        content: [
          {
            type: "text",
            text: `Comment ${comment_id} updated`,
          },
        ],
      };
    }
  );

  // ============ Reaction Tools ============

  server.tool(
    "fizzy_get_reactions",
    "Get all reactions on a comment",
    getReactionsSchema.shape,
    async ({ account_slug, card_number, comment_id }) => {
      const reactions = await client.getReactions(account_slug, card_number, comment_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(reactions, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_add_reaction",
    "Add a reaction to a comment (max 16 characters)",
    addReactionSchema.shape,
    async ({ account_slug, card_number, comment_id, content }) => {
      const reaction = await client.addReaction(account_slug, card_number, comment_id, content);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(reaction, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_remove_reaction",
    "Remove an emoji reaction from a comment",
    removeReactionSchema.shape,
    async ({ account_slug, card_number, comment_id, reaction_id }) => {
      await client.removeReaction(account_slug, card_number, comment_id, reaction_id);
      return {
        content: [
          {
            type: "text",
            text: `Reaction ${reaction_id} removed`,
          },
        ],
      };
    }
  );

  // ============ Step Tools ============

  server.tool(
    "fizzy_get_step",
    "Get a specific to-do step on a card",
    getStepSchema.shape,
    async ({ account_slug, card_number, step_id }) => {
      const step = await client.getStep(account_slug, card_number, step_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(step, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_create_step",
    "Create a new to-do step on a card",
    createStepSchema.shape,
    async ({ account_slug, card_number, description }) => {
      const step = await client.createStep(account_slug, card_number, { description });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(step, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_update_step",
    "Update a to-do step on a card (e.g., mark complete)",
    updateStepSchema.shape,
    async ({ account_slug, card_number, step_id, description, completed }) => {
      await client.updateStep(account_slug, card_number, step_id, { description, completed });
      return {
        content: [
          {
            type: "text",
            text: `Step ${step_id} updated`,
          },
        ],
      };
    }
  );

  server.tool(
    "fizzy_delete_step",
    "Delete a to-do step from a card",
    deleteStepSchema.shape,
    async ({ account_slug, card_number, step_id }) => {
      await client.deleteStep(account_slug, card_number, step_id);
      return {
        content: [
          {
            type: "text",
            text: `Step ${step_id} deleted`,
          },
        ],
      };
    }
  );

  return server;
}

