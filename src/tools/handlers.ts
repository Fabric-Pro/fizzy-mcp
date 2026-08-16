/**
 * Shared Tool Handlers
 *
 * Single source of truth for all tool handler logic.
 * Used by both the standard server and Cloudflare Durable Objects paths.
 *
 * Each handler returns the raw result - the calling code is responsible
 * for wrapping it in the appropriate MCP response format.
 */

import type { FizzyClient } from "../client/fizzy-client.js";
import { COLUMN_COLORS, type ColumnColor, type CardListOptions } from "../client/types.js";
import { resolveCardNumber } from "../utils/card-resolver.js";
import { attachmentHtml, resolveAttachment } from "../utils/attachments.js";
import {
  parseFieldsMode,
  summarizeCard,
  summarizeComment,
  summarizeNotification,
} from "../utils/projections.js";

/**
 * Tool handler result - either data to serialize or a success message
 */
export type HandlerResult = unknown;

/**
 * Tool handler function signature
 */
export type ToolHandler = (
  client: FizzyClient,
  args: Record<string, unknown>
) => Promise<HandlerResult>;

/**
 * Helper to convert column color name to CSS variable
 */
function getColumnColorValue(color?: string): string | undefined {
  if (!color) return undefined;
  return COLUMN_COLORS[color as ColumnColor];
}

/**
 * Validate the optional 1-based `page` argument of fizzy_get_cards.
 *
 * Like the unsupported-filter guard below, this has to run here because the
 * Cloudflare transport executes raw args without zod. Digit strings are accepted
 * because LLM clients routinely send "2"; the stdio path rejects those upstream,
 * and being lenient here costs nothing.
 */
function parseCardsPage(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = parseInt(value, 10);
    if (Number.isSafeInteger(parsed) && parsed >= 1) return parsed;
  }
  throw new Error("page must be a positive integer (1-based), e.g. 2");
}

/**
 * All tool handlers indexed by tool name
 */
export const toolHandlers: Record<string, ToolHandler> = {
  // ============ Identity Tools ============
  fizzy_get_identity: async (client) => {
    return client.getIdentity();
  },

  fizzy_get_accounts: async (client) => {
    return client.getAccounts();
  },

  // ============ Board Tools ============
  fizzy_get_boards: async (client, args) => {
    return client.getBoards(args.account_slug as string);
  },

  fizzy_get_board: async (client, args) => {
    return client.getBoard(args.account_slug as string, args.board_id as string);
  },

  fizzy_create_board: async (client, args) => {
    return client.createBoard(args.account_slug as string, {
      name: args.name as string,
    });
  },

  fizzy_update_board: async (client, args) => {
    await client.updateBoard(args.account_slug as string, args.board_id as string, {
      name: args.name as string,
    });
    return `Board ${args.board_id} updated successfully`;
  },

  fizzy_delete_board: async (client, args) => {
    await client.deleteBoard(args.account_slug as string, args.board_id as string);
    return `Board ${args.board_id} deleted successfully`;
  },

  // ============ Card Tools ============
  fizzy_get_cards: async (client, args) => {
    // The Cloudflare transport executes raw args without zod validation, so stale
    // clients sending these removed fields must get a visible error here rather
    // than a silently unfiltered payload. The stdio/Node MCP SDK path strips
    // unknown keys before the handler runs, so this only fires there if a
    // pre-validation bug ever reintroduces one of these fields.
    const unsupported = ["status", "due_before", "due_after"].filter(
      (key) => args[key] !== undefined
    );
    if (unsupported.length > 0) {
      throw new Error(
        `Unsupported filter(s): ${unsupported.join(", ")}. ` +
        `The Fizzy cards API cannot filter by status or due date. ` +
        `Card listings always contain published cards; use indexed_by="closed" for closed cards.`
      );
    }
    const fieldsMode = parseFieldsMode(args.fields);
    const options: CardListOptions = {
      board_ids: args.board_id ? [args.board_id as string] : undefined,
      column_ids: args.column_id ? [args.column_id as string] : undefined,
      terms: args.search ? [args.search as string] : undefined,
      indexed_by: args.indexed_by as CardListOptions["indexed_by"],
      assignee_ids: args.assignee_ids as string[] | undefined,
      tag_ids: args.tag_ids as string[] | undefined,
      page: parseCardsPage(args.page),
    };
    const result = await client.getCards(args.account_slug as string, options);
    if (fieldsMode === "full") return result;
    return {
      cards: result.cards.map((card) =>
        summarizeCard(card as unknown as Record<string, unknown>)
      ),
      page: result.page,
      total_count: result.total_count,
      has_more: result.has_more,
      next_page: result.next_page,
    };
  },

  fizzy_get_card: async (client, args) => {
    return client.getCard(args.account_slug as string, args.card_id as string);
  },

  fizzy_create_card: async (client, args) => {
    return client.createCard(args.account_slug as string, args.board_id as string, {
      title: args.title as string,
      description: args.description as string,
      status: args.status as "draft" | "published" | undefined,
      column_id: args.column_id as string,
      assignee_ids: args.assignee_ids as string[],
      tag_ids: args.tag_ids as string[],
      due_on: args.due_on as string,
    });
  },

  fizzy_update_card: async (client, args) => {
    await client.updateCard(args.account_slug as string, args.card_id as string, {
      title: args.title as string,
      description: args.description as string,
      status: args.status as "draft" | "published" | "archived" | undefined,
      column_id: args.column_id as string,
      assignee_ids: args.assignee_ids as string[],
      tag_ids: args.tag_ids as string[],
      due_on: args.due_on as string,
    });
    return `Card ${args.card_id} updated successfully`;
  },

  fizzy_delete_card: async (client, args) => {
    await client.deleteCard(args.account_slug as string, args.card_id as string);
    return `Card ${args.card_id} deleted successfully`;
  },

  // ============ Card Action Tools ============
  fizzy_close_card: async (client, args) => {
    await client.closeCard(args.account_slug as string, args.card_number as string);
    return `Card ${args.card_number} closed`;
  },

  fizzy_reopen_card: async (client, args) => {
    await client.reopenCard(args.account_slug as string, args.card_number as string);
    return `Card ${args.card_number} reopened`;
  },

  fizzy_move_card_to_not_now: async (client, args) => {
    await client.moveCardToNotNow(args.account_slug as string, args.card_number as string);
    return `Card ${args.card_number} moved to Not Now`;
  },

  fizzy_move_card_to_column: async (client, args) => {
    await client.moveCardToColumn(
      args.account_slug as string,
      args.card_number as string,
      args.column_id as string
    );
    return `Card ${args.card_number} moved to column ${args.column_id}`;
  },

  fizzy_send_card_to_triage: async (client, args) => {
    await client.sendCardToTriage(args.account_slug as string, args.card_number as string);
    return `Card ${args.card_number} sent to triage`;
  },

  fizzy_toggle_card_tag: async (client, args) => {
    await client.toggleCardTag(
      args.account_slug as string,
      args.card_number as string,
      args.tag_title as string
    );
    return `Tag "${args.tag_title}" toggled on card ${args.card_number}`;
  },

  fizzy_toggle_card_assignment: async (client, args) => {
    await client.toggleCardAssignment(
      args.account_slug as string,
      args.card_number as string,
      args.assignee_id as string
    );
    return `User ${args.assignee_id} assignment toggled on card ${args.card_number}`;
  },

  fizzy_watch_card: async (client, args) => {
    await client.watchCard(args.account_slug as string, args.card_number as string);
    return `Now watching card ${args.card_number}`;
  },

  fizzy_unwatch_card: async (client, args) => {
    await client.unwatchCard(args.account_slug as string, args.card_number as string);
    return `Stopped watching card ${args.card_number}`;
  },

  fizzy_gild_card: async (client, args) => {
    await client.gildCard(args.account_slug as string, args.card_number as string);
    return `Card ${args.card_number} marked as golden`;
  },

  fizzy_ungild_card: async (client, args) => {
    await client.ungildCard(args.account_slug as string, args.card_number as string);
    return `Card ${args.card_number} golden status removed`;
  },

  // ============ Comment Tools ============
  fizzy_get_card_comments: async (client, args) => {
    const cardNumber = await resolveCardNumber(
      client,
      args.account_slug as string,
      args.card_id as string | undefined,
      args.card_number as string | undefined
    );
    const fieldsMode = parseFieldsMode(args.fields);
    const comments = await client.getCardComments(args.account_slug as string, cardNumber);
    if (fieldsMode === "full") return comments;
    return comments.map((comment) =>
      summarizeComment(comment as unknown as Record<string, unknown>)
    );
  },

  fizzy_get_comment: async (client, args) => {
    return client.getComment(
      args.account_slug as string,
      args.card_number as string,
      args.comment_id as string
    );
  },

  fizzy_create_comment: async (client, args) => {
    const cardNumber = await resolveCardNumber(
      client,
      args.account_slug as string,
      args.card_id as string | undefined,
      args.card_number as string | undefined
    );
    return client.createCardComment(args.account_slug as string, cardNumber, {
      body: args.body as string,
    });
  },

  fizzy_update_comment: async (client, args) => {
    await client.updateComment(
      args.account_slug as string,
      args.card_number as string,
      args.comment_id as string,
      { body: args.body as string }
    );
    return `Comment ${args.comment_id} updated`;
  },

  fizzy_delete_comment: async (client, args) => {
    await client.deleteComment(
      args.account_slug as string,
      args.card_number as string,
      args.comment_id as string
    );
    return `Comment ${args.comment_id} deleted successfully`;
  },

  // ============ Reaction Tools ============
  fizzy_get_reactions: async (client, args) => {
    return client.getReactions(
      args.account_slug as string,
      args.card_number as string,
      args.comment_id as string
    );
  },

  fizzy_add_reaction: async (client, args) => {
    return client.addReaction(
      args.account_slug as string,
      args.card_number as string,
      args.comment_id as string,
      args.content as string
    );
  },

  fizzy_remove_reaction: async (client, args) => {
    await client.removeReaction(
      args.account_slug as string,
      args.card_number as string,
      args.comment_id as string,
      args.reaction_id as string
    );
    return `Reaction ${args.reaction_id} removed`;
  },

  // ============ Step (To-Do) Tools ============
  fizzy_get_step: async (client, args) => {
    return client.getStep(
      args.account_slug as string,
      args.card_number as string,
      args.step_id as string
    );
  },

  fizzy_create_step: async (client, args) => {
    return client.createStep(args.account_slug as string, args.card_number as string, {
      content: args.content as string,
    });
  },

  fizzy_update_step: async (client, args) => {
    await client.updateStep(
      args.account_slug as string,
      args.card_number as string,
      args.step_id as string,
      {
        content: args.content as string,
        completed: args.completed as boolean,
      }
    );
    return `Step ${args.step_id} updated`;
  },

  fizzy_delete_step: async (client, args) => {
    await client.deleteStep(
      args.account_slug as string,
      args.card_number as string,
      args.step_id as string
    );
    return `Step ${args.step_id} deleted`;
  },

  // ============ Column Tools ============
  fizzy_get_columns: async (client, args) => {
    return client.getColumns(args.account_slug as string, args.board_id as string);
  },

  fizzy_get_column: async (client, args) => {
    return client.getColumn(
      args.account_slug as string,
      args.board_id as string,
      args.column_id as string
    );
  },

  fizzy_create_column: async (client, args) => {
    return client.createColumn(args.account_slug as string, args.board_id as string, {
      name: args.name as string,
      color: getColumnColorValue(args.color as string),
    });
  },

  fizzy_update_column: async (client, args) => {
    await client.updateColumn(
      args.account_slug as string,
      args.board_id as string,
      args.column_id as string,
      {
        name: args.name as string,
        color: getColumnColorValue(args.color as string),
      }
    );
    return `Column ${args.column_id} updated successfully`;
  },

  fizzy_delete_column: async (client, args) => {
    await client.deleteColumn(
      args.account_slug as string,
      args.board_id as string,
      args.column_id as string
    );
    return `Column ${args.column_id} deleted successfully`;
  },

  // ============ Tag Tools ============
  fizzy_get_tags: async (client, args) => {
    return client.getTags(args.account_slug as string);
  },

  // ============ User Tools ============
  fizzy_get_users: async (client, args) => {
    return client.getUsers(args.account_slug as string);
  },

  fizzy_get_user: async (client, args) => {
    return client.getUser(args.account_slug as string, args.user_id as string);
  },

  fizzy_update_user: async (client, args) => {
    await client.updateUser(args.account_slug as string, args.user_id as string, {
      name: args.name as string,
    });
    return `User ${args.user_id} updated successfully`;
  },

  fizzy_deactivate_user: async (client, args) => {
    await client.deactivateUser(args.account_slug as string, args.user_id as string);
    return `User ${args.user_id} deactivated successfully`;
  },

  // ============ Notification Tools ============
  fizzy_get_notifications: async (client, args) => {
    const fieldsMode = parseFieldsMode(args.fields);
    const notifications = await client.getNotifications(args.account_slug as string);
    if (fieldsMode === "full") return notifications;
    return notifications.map((notification) =>
      summarizeNotification(notification as unknown as Record<string, unknown>)
    );
  },

  fizzy_mark_notification_read: async (client, args) => {
    await client.markNotificationAsRead(
      args.account_slug as string,
      args.notification_id as string
    );
    return `Notification ${args.notification_id} marked as read`;
  },

  fizzy_mark_notification_unread: async (client, args) => {
    await client.markNotificationAsUnread(
      args.account_slug as string,
      args.notification_id as string
    );
    return `Notification ${args.notification_id} marked as unread`;
  },

  fizzy_mark_all_notifications_read: async (client, args) => {
    await client.markAllNotificationsAsRead(args.account_slug as string);
    return "All notifications marked as read";
  },

  // ============ Attachment Tools ============
  fizzy_upload_file: async (client, args) => {
    const file = await resolveAttachment(args);
    const upload = await client.uploadFile(args.account_slug as string, file);

    return {
      // attachable_sgid, not signed_id — see FizzyDirectUpload for why they differ.
      attachable_sgid: upload.attachable_sgid,
      filename: upload.filename,
      content_type: upload.content_type,
      byte_size: upload.byte_size,
      attachment_html: attachmentHtml(upload.attachable_sgid),
      next_step:
        "Include attachment_html verbatim in a rich-text field to attach the file — for " +
        "example as the 'body' of fizzy_create_comment, or the 'description' of " +
        "fizzy_update_card. Do not rebuild the tag by hand.",
    };
  },
};

/**
 * Execute a tool by name
 */
export async function executeToolHandler(
  client: FizzyClient,
  toolName: string,
  args: Record<string, unknown>
): Promise<HandlerResult> {
  const handler = toolHandlers[toolName];
  if (!handler) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  return handler(client, args);
}
