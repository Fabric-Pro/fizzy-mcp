/**
 * Fizzy MCP Server (Refactored)
 * Implements the Model Context Protocol for Fizzy API
 * 
 * Uses centralized tool definitions from tools/definitions.ts for improved
 * consistency and MCP specification compliance.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FizzyClient } from "./client/fizzy-client.js";
import { COLUMN_COLORS, type ColumnColor } from "./client/types.js";
import { ALL_TOOLS } from "./tools/definitions.js";
import { resolveCardNumber } from "./utils/card-resolver.js";

/**
 * Tool handler function type
 * Returns MCP tool result with content array
 */
type ToolHandler = (params: any) => Promise<{
  content: Array<{
    type: string;
    text: string;
  }>;
}>;

/**
 * Create the Fizzy MCP Server with all 47 tools registered
 */
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

  /**
   * Tool handlers mapped by tool name
   * Each handler implements the business logic for its respective tool
   */
  const toolHandlers: Record<string, ToolHandler> = {
    // Note: Parameters are typed as 'any' due to TypeScript limitations with dynamic Zod schema inference.
    // ============ Identity Tools ============
    fizzy_get_identity: async () => {
      const identity = await client.getIdentity();
      return {
        content: [{ type: "text", text: JSON.stringify(identity, null, 2) }],
      };
    },

    fizzy_get_accounts: async () => {
      const accounts = await client.getAccounts();
      return {
        content: [{ type: "text", text: JSON.stringify(accounts, null, 2) }],
      };
    },

    // ============ Board Tools ============
    fizzy_get_boards: async ({ account_slug }: any) => {
      const boards = await client.getBoards(account_slug);
      return {
        content: [{ type: "text", text: JSON.stringify(boards, null, 2) }],
      };
    },

    fizzy_get_board: async ({ account_slug, board_id }: any) => {
      const board = await client.getBoard(account_slug, board_id);
      return {
        content: [{ type: "text", text: JSON.stringify(board, null, 2) }],
      };
    },

    fizzy_create_board: async ({ account_slug, name }: any) => {
      const board = await client.createBoard(account_slug, { name });
      return {
        content: [{ type: "text", text: JSON.stringify(board, null, 2) }],
      };
    },

    fizzy_update_board: async ({ account_slug, board_id, name }: any) => {
      await client.updateBoard(account_slug, board_id, { name });
      return {
        content: [{ type: "text", text: `Board ${board_id} updated successfully` }],
      };
    },

    fizzy_delete_board: async ({ account_slug, board_id }: any) => {
      await client.deleteBoard(account_slug, board_id);
      return {
        content: [{ type: "text", text: `Board ${board_id} deleted successfully` }],
      };
    },

    // ============ Card Tools ============
    fizzy_get_cards: async ({ account_slug, indexed_by, status, column_id, assignee_ids, tag_ids, search }: any) => {
      const cards = await client.getCards(account_slug, {
        indexed_by,
        status,
        column_id,
        assignee_ids,
        tag_ids,
        search,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(cards, null, 2) }],
      };
    },

    fizzy_get_card: async ({ account_slug, card_id }: any) => {
      const card = await client.getCard(account_slug, card_id);
      return {
        content: [{ type: "text", text: JSON.stringify(card, null, 2) }],
      };
    },

    fizzy_create_card: async ({
      account_slug,
      board_id,
      title,
      description,
      status,
      column_id,
      assignee_ids,
      tag_ids,
      due_on,
    }: any) => {
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
        content: [{ type: "text", text: JSON.stringify(card, null, 2) }],
      };
    },

    fizzy_update_card: async ({
      account_slug,
      card_id,
      title,
      description,
      status,
      column_id,
      assignee_ids,
      tag_ids,
      due_on,
    }: any) => {
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
        content: [{ type: "text", text: `Card ${card_id} updated successfully` }],
      };
    },

    fizzy_delete_card: async ({ account_slug, card_id }: any) => {
      await client.deleteCard(account_slug, card_id);
      return {
        content: [{ type: "text", text: `Card ${card_id} deleted successfully` }],
      };
    },

    // ============ Card Action Tools ============
    fizzy_close_card: async ({ account_slug, card_number }: any) => {
      await client.closeCard(account_slug, card_number);
      return {
        content: [{ type: "text", text: `Card ${card_number} closed` }],
      };
    },

    fizzy_reopen_card: async ({ account_slug, card_number }: any) => {
      await client.reopenCard(account_slug, card_number);
      return {
        content: [{ type: "text", text: `Card ${card_number} reopened` }],
      };
    },

    fizzy_move_card_to_not_now: async ({ account_slug, card_number }: any) => {
      await client.moveCardToNotNow(account_slug, card_number);
      return {
        content: [{ type: "text", text: `Card ${card_number} moved to Not Now` }],
      };
    },

    fizzy_move_card_to_column: async ({ account_slug, card_number, column_id }: any) => {
      await client.moveCardToColumn(account_slug, card_number, column_id);
      return {
        content: [{ type: "text", text: `Card ${card_number} moved to column ${column_id}` }],
      };
    },

    fizzy_send_card_to_triage: async ({ account_slug, card_number }: any) => {
      await client.sendCardToTriage(account_slug, card_number);
      return {
        content: [{ type: "text", text: `Card ${card_number} sent to triage` }],
      };
    },

    fizzy_toggle_card_tag: async ({ account_slug, card_number, tag_title }: any) => {
      await client.toggleCardTag(account_slug, card_number, tag_title);
      return {
        content: [{ type: "text", text: `Tag "${tag_title}" toggled on card ${card_number}` }],
      };
    },

    fizzy_toggle_card_assignment: async ({ account_slug, card_number, assignee_id }: any) => {
      await client.toggleCardAssignment(account_slug, card_number, assignee_id);
      return {
        content: [{ type: "text", text: `User ${assignee_id} assignment toggled on card ${card_number}` }],
      };
    },

    fizzy_watch_card: async ({ account_slug, card_number }: any) => {
      await client.watchCard(account_slug, card_number);
      return {
        content: [{ type: "text", text: `Now watching card ${card_number}` }],
      };
    },

    fizzy_unwatch_card: async ({ account_slug, card_number }: any) => {
      await client.unwatchCard(account_slug, card_number);
      return {
        content: [{ type: "text", text: `Stopped watching card ${card_number}` }],
      };
    },

    fizzy_gild_card: async ({ account_slug, card_number }: any) => {
      await client.gildCard(account_slug, card_number);
      return {
        content: [{ type: "text", text: `Card ${card_number} marked as golden` }],
      };
    },

    fizzy_ungild_card: async ({ account_slug, card_number }: any) => {
      await client.ungildCard(account_slug, card_number);
      return {
        content: [{ type: "text", text: `Card ${card_number} golden status removed` }],
      };
    },

    // ============ Comment Tools ============
    fizzy_get_card_comments: async ({ account_slug, card_id, card_number }: any) => {
      const resolvedCardNumber = await resolveCardNumber(client, account_slug, card_id, card_number);
      const comments = await client.getCardComments(account_slug, resolvedCardNumber);
      return {
        content: [{ type: "text", text: JSON.stringify(comments, null, 2) }],
      };
    },

    fizzy_get_comment: async ({ account_slug, card_number, comment_id }: any) => {
      const comment = await client.getComment(account_slug, card_number, comment_id);
      return {
        content: [{ type: "text", text: JSON.stringify(comment, null, 2) }],
      };
    },

    fizzy_create_comment: async ({ account_slug, card_id, card_number, body }: any) => {
      const resolvedCardNumber = await resolveCardNumber(client, account_slug, card_id, card_number);
      const comment = await client.createCardComment(account_slug, resolvedCardNumber, { body });
      return {
        content: [{ type: "text", text: JSON.stringify(comment, null, 2) }],
      };
    },

    fizzy_update_comment: async ({ account_slug, card_number, comment_id, body }: any) => {
      await client.updateComment(account_slug, card_number, comment_id, { body });
      return {
        content: [{ type: "text", text: `Comment ${comment_id} updated` }],
      };
    },

    fizzy_delete_comment: async ({ account_slug, card_number, comment_id }: any) => {
      await client.deleteComment(account_slug, card_number, comment_id);
      return {
        content: [{ type: "text", text: `Comment ${comment_id} deleted successfully` }],
      };
    },

    // ============ Reaction Tools ============
    fizzy_get_reactions: async ({ account_slug, card_number, comment_id }: any) => {
      const reactions = await client.getReactions(account_slug, card_number, comment_id);
      return {
        content: [{ type: "text", text: JSON.stringify(reactions, null, 2) }],
      };
    },

    fizzy_add_reaction: async ({ account_slug, card_number, comment_id, content }: any) => {
      const reaction = await client.addReaction(account_slug, card_number, comment_id, content);
      return {
        content: [{ type: "text", text: JSON.stringify(reaction, null, 2) }],
      };
    },

    fizzy_remove_reaction: async ({ account_slug, card_number, comment_id, reaction_id }: any) => {
      await client.removeReaction(account_slug, card_number, comment_id, reaction_id);
      return {
        content: [{ type: "text", text: `Reaction ${reaction_id} removed` }],
      };
    },

    // ============ Step (To-Do) Tools ============
    fizzy_get_step: async ({ account_slug, card_number, step_id }: any) => {
      const step = await client.getStep(account_slug, card_number, step_id);
      return {
        content: [{ type: "text", text: JSON.stringify(step, null, 2) }],
      };
    },

    fizzy_create_step: async ({ account_slug, card_number, content }: any) => {
      const step = await client.createStep(account_slug, card_number, { description: content });
      return {
        content: [{ type: "text", text: JSON.stringify(step, null, 2) }],
      };
    },

    fizzy_update_step: async ({ account_slug, card_number, step_id, content, completed }: any) => {
      await client.updateStep(account_slug, card_number, step_id, { description: content, completed });
      return {
        content: [{ type: "text", text: `Step ${step_id} updated` }],
      };
    },

    fizzy_delete_step: async ({ account_slug, card_number, step_id }: any) => {
      await client.deleteStep(account_slug, card_number, step_id);
      return {
        content: [{ type: "text", text: `Step ${step_id} deleted` }],
      };
    },

    // ============ Column Tools ============
    fizzy_get_columns: async ({ account_slug, board_id }: any) => {
      const columns = await client.getColumns(account_slug, board_id);
      return {
        content: [{ type: "text", text: JSON.stringify(columns, null, 2) }],
      };
    },

    fizzy_get_column: async ({ account_slug, board_id, column_id }: any) => {
      const column = await client.getColumn(account_slug, board_id, column_id);
      return {
        content: [{ type: "text", text: JSON.stringify(column, null, 2) }],
      };
    },

    fizzy_create_column: async ({ account_slug, board_id, name, color }: any) => {
      const column = await client.createColumn(account_slug, board_id, {
        name,
        color: getColumnColorValue(color),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(column, null, 2) }],
      };
    },

    fizzy_update_column: async ({ account_slug, board_id, column_id, name, color }: any) => {
      await client.updateColumn(account_slug, board_id, column_id, {
        name,
        color: getColumnColorValue(color),
      });
      return {
        content: [{ type: "text", text: `Column ${column_id} updated successfully` }],
      };
    },

    fizzy_delete_column: async ({ account_slug, board_id, column_id }: any) => {
      await client.deleteColumn(account_slug, board_id, column_id);
      return {
        content: [{ type: "text", text: `Column ${column_id} deleted successfully` }],
      };
    },

    // ============ Tag Tools ============
    fizzy_get_tags: async ({ account_slug }: any) => {
      const tags = await client.getTags(account_slug);
      return {
        content: [{ type: "text", text: JSON.stringify(tags, null, 2) }],
      };
    },

    // ============ User Tools ============
    fizzy_get_users: async ({ account_slug }: any) => {
      const users = await client.getUsers(account_slug);
      return {
        content: [{ type: "text", text: JSON.stringify(users, null, 2) }],
      };
    },

    fizzy_get_user: async ({ account_slug, user_id }: any) => {
      const user = await client.getUser(account_slug, user_id);
      return {
        content: [{ type: "text", text: JSON.stringify(user, null, 2) }],
      };
    },

    fizzy_update_user: async ({ account_slug, user_id, name }: any) => {
      await client.updateUser(account_slug, user_id, { name });
      return {
        content: [{ type: "text", text: `User ${user_id} updated successfully` }],
      };
    },

    fizzy_deactivate_user: async ({ account_slug, user_id }: any) => {
      await client.deactivateUser(account_slug, user_id);
      return {
        content: [{ type: "text", text: `User ${user_id} deactivated successfully` }],
      };
    },

    // ============ Notification Tools ============
    fizzy_get_notifications: async ({ account_slug }: any) => {
      const notifications = await client.getNotifications(account_slug);
      return {
        content: [{ type: "text", text: JSON.stringify(notifications, null, 2) }],
      };
    },

    fizzy_mark_notification_read: async ({ account_slug, notification_id }: any) => {
      await client.markNotificationAsRead(account_slug, notification_id);
      return {
        content: [{ type: "text", text: `Notification ${notification_id} marked as read` }],
      };
    },

    fizzy_mark_notification_unread: async ({ account_slug, notification_id }: any) => {
      await client.markNotificationAsUnread(account_slug, notification_id);
      return {
        content: [{ type: "text", text: `Notification ${notification_id} marked as unread` }],
      };
    },

    fizzy_mark_all_notifications_read: async ({ account_slug }: any) => {
      await client.markAllNotificationsAsRead(account_slug);
      return {
        content: [{ type: "text", text: "All notifications marked as read" }],
      };
    },
  };

  // ============ Register All Tools ============
  // Loop through all tool definitions and register them with their handlers
  for (const toolDef of ALL_TOOLS) {
    const handler = toolHandlers[toolDef.name];
    
    if (!handler) {
      console.warn(`No handler found for tool: ${toolDef.name}`);
      continue;
    }

    server.registerTool(
      toolDef.name,
      {
        title: toolDef.title,
        description: toolDef.description,
        inputSchema: toolDef.schema,
        annotations: toolDef.annotations,
      },
      handler as any // Type assertion needed due to dynamic schema mapping
    );
  }

  return server;
}
