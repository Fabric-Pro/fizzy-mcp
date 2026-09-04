/**
 * Centralized MCP Tool Definitions
 * 
 * This file defines all Fizzy MCP tools with complete metadata per the MCP specification.
 * Each tool includes:
 * - name: Unique identifier (1-128 chars, alphanumeric + _-.)
 * - title: Human-readable display name
 * - description: Detailed functionality description
 * - inputSchema: JSON Schema (from Zod)
 * - annotations: Behavioral hints (readOnly, destructive)
 * 
 * @see https://modelcontextprotocol.io/specification/draft/server/tools
 */

import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import * as schemas from "./schemas.js";

/**
 * Tool definition with MCP metadata
 */
export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  schema: typeof schemas[keyof typeof schemas];
  annotations: ToolAnnotations;
}

/**
 * All Fizzy MCP tool definitions organized by category
 */
export const TOOL_DEFINITIONS = {
  // ============ Identity Tools ============
  identity: [
    {
      name: "fizzy_get_identity",
      title: "Get User Identity",
      description:
        "Get the current authenticated user's identity and all associated Fizzy accounts. " +
        "Returns user information including email, name, and list of accounts with their slugs and permissions.",
      schema: schemas.getIdentitySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_get_accounts",
      title: "List Accounts",
      description:
        "Get all Fizzy accounts accessible to the current user. " +
        "Returns account details including slugs, names, and access levels.",
      schema: schemas.getAccountsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
  ] as ToolDefinition[],

  // ============ Board Tools ============
  boards: [
    {
      name: "fizzy_get_boards",
      title: "List Boards",
      description:
        "Get all boards in a Fizzy account. Returns board details including IDs, names, descriptions, and URLs. " +
        "Use this to discover available boards before working with cards. " +
        "The result is the complete list: every upstream page is fetched server-side, so there is no page " +
        "parameter and nothing further to request.",
      schema: schemas.getBoardsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_get_board",
      title: "Get Board Details",
      description:
        "Get detailed information about a specific board including its name, description, URL, and metadata. " +
        "Use this to understand board structure before querying cards or columns.",
      schema: schemas.getBoardSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_create_board",
      title: "Create Board",
      description:
        "Create a new board in a Fizzy account. Boards are top-level containers for organizing cards. " +
        "Returns the newly created board with its ID and URL.",
      schema: schemas.createBoardSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_update_board",
      title: "Update Board",
      description:
        "Update an existing board's name or other properties. " +
        "This operation modifies board metadata but does not affect cards or columns.",
      schema: schemas.updateBoardSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_delete_board",
      title: "Delete Board",
      description:
        "Permanently delete a board and all its contents including cards, columns, and associated data. " +
        "⚠️ This is a destructive operation that cannot be undone. Use with caution.",
      schema: schemas.deleteBoardSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
  ] as ToolDefinition[],

  // ============ Card Tools ============
  cards: [
    {
      name: "fizzy_get_cards",
      title: "List Cards",
      description:
        "Get a page of cards in an account with optional filtering by board, indexed_by (e.g., 'golden' for priority cards), " +
        "column, assignees, tags, or search terms. " +
        "search OR-matches its words by default; set search_mode='all' to require every usable word " +
        "(stopwords and words under 3 characters are dropped and listed in ignored_search_terms), " +
        "which is the mode to use when checking whether a card already exists. " +
        "Use board_id to scope results to a specific board and column_id to scope to a workflow column. " +
        "Results are PAGINATED with a server-controlled, variable page size, so never compute a page count " +
        "from the length of one page. " +
        "Returns an object {cards, page, total_count, has_more, next_page}, where total_count is the total number " +
        "of cards matching the filters (NOT the length of this page). " +
        "To enumerate every match, call repeatedly with page = next_page until has_more is false OR cards comes back " +
        "empty — an out-of-range page returns empty cards but may still report has_more true. " +
        "A board's cards_count from fizzy_get_boards can exceed a single page of results; that is expected, not a discrepancy. " +
        "Use fields='summary' when browsing, searching, or scanning many cards — it drops full descriptions/HTML and " +
        "returns a much smaller payload (often 100x+ smaller). Once you've identified the specific card you need, " +
        "call fizzy_get_card for its full detail.",
      schema: schemas.getCardsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_get_pins",
      title: "List Pinned Cards",
      description:
        "Get the cards the current user has pinned in an account, as a plain array of cards. " +
        "Pins are per-user and per-account, so this returns only the authenticated user's pins — " +
        "it is not a view of what anyone else pinned. " +
        "This listing is NOT paginated: the server returns at most 100 pinned cards, and there is " +
        "no page or next_page to follow. " +
        "Strongly prefer fields='summary' here — the response carries full card descriptions and " +
        "HTML by default, so a large pin list can run to several megabytes; summary returns the " +
        "same cards far smaller. Call fizzy_get_card for the full detail of a specific pin. " +
        "Use fizzy_pin_card and fizzy_unpin_card to change what appears in this list.",
      schema: schemas.getPinsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_get_card",
      title: "Get Card Details",
      description:
        "Get detailed information about a specific card including full description (HTML), " +
        "assignees, tags, due dates, steps (to-dos), and metadata. " +
        "Use this to see complete card content before making updates. " +
        "Attachments — screenshots, images, PDFs, logs — appear in the description only as " +
        "raw <action-text-attachment> markup, and the plain-text description flattens them " +
        "to a bare filename with no way to fetch them. Pass include_attachments=true to also " +
        "get an 'attachments' array with each file's filename, content_type, byte_size, " +
        "dimensions and signed_id; pass that signed_id and filename to fizzy_get_attachment " +
        "to actually see an image. Do that whenever a card mentions a screenshot or the " +
        "answer depends on what a picture shows.",
      schema: schemas.getCardSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_create_card",
      title: "Create Card",
      description:
        "Create a new card on a board with optional title, description (HTML supported), " +
        "status (draft/published), column placement, assignees, tags, and due date. " +
        "Cards start in triage by default unless a column is specified.",
      schema: schemas.createCardSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_update_card",
      title: "Update Card",
      description:
        "Update an existing card's properties including title, description, status, " +
        "column placement, assignees, tags, and due date. " +
        "Partial updates are supported - only provided fields will be changed.",
      schema: schemas.updateCardSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_delete_card",
      title: "Delete Card",
      description:
        "Permanently delete a card and all its contents including comments, steps, and attachments. " +
        "⚠️ This is a destructive operation that cannot be undone.",
      schema: schemas.deleteCardSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
  ] as ToolDefinition[],

  // ============ Card Action Tools ============
  cardActions: [
    {
      name: "fizzy_close_card",
      title: "Close Card",
      description:
        "Close a card to mark it as done/completed. Closed cards are archived and removed from active view. " +
        "Use this when work on a card is finished.",
      schema: schemas.closeCardSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_reopen_card",
      title: "Reopen Card",
      description:
        "Reopen a previously closed card to make it active again. " +
        "Use this to resume work on completed cards or undo accidental closures.",
      schema: schemas.reopenCardSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_move_card_to_not_now",
      title: "Move Card to Not Now",
      description:
        "Move a card to the 'Not Now' triage area, indicating it's not a current priority. " +
        "This removes the card from workflow columns but keeps it accessible.",
      schema: schemas.moveCardToNotNowSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_move_card_to_column",
      title: "Move Card to Column",
      description:
        "Move a card from triage to a specific workflow column. " +
        "Use this to transition cards through your workflow stages.",
      schema: schemas.moveCardToColumnSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_send_card_to_triage",
      title: "Send Card to Triage",
      description:
        "Send a card back to the triage area by removing it from its current column. " +
        "Use this to reassess or reprioritize cards that need more planning.",
      schema: schemas.sendCardToTriageSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_toggle_card_tag",
      title: "Toggle Card Tag",
      description:
        "Add or remove a tag from a card. If the tag doesn't exist in the account, it will be created automatically. " +
        "Tags help organize and categorize cards. Leading '#' characters are automatically stripped from tag titles.",
      schema: schemas.toggleCardTagSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_toggle_card_assignment",
      title: "Toggle Card Assignment",
      description:
        "Assign or unassign a user to/from a card. If the user is already assigned, they will be unassigned. " +
        "If not assigned, they will be assigned. Use this to manage card ownership and responsibilities.",
      schema: schemas.toggleCardAssignmentSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_watch_card",
      title: "Watch Card",
      description:
        "Subscribe to notifications for a card. You'll receive notifications when the card is updated, " +
        "commented on, or when its status changes.",
      schema: schemas.watchCardSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_unwatch_card",
      title: "Unwatch Card",
      description:
        "Unsubscribe from notifications for a card. You'll stop receiving updates about card changes. " +
        "Use this to reduce notification noise for cards you're no longer actively involved with.",
      schema: schemas.unwatchCardSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_gild_card",
      title: "Gild Card",
      description:
        "Mark a card as golden (priority/important). Golden cards are highlighted and can be filtered " +
        "using indexed_by='golden' in fizzy_get_cards. Use this to flag high-priority work items.",
      schema: schemas.gildCardSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_ungild_card",
      title: "Ungild Card",
      description:
        "Remove golden status from a card. The card will no longer appear in golden card filters " +
        "and will lose its priority highlighting.",
      schema: schemas.ungildCardSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_pin_card",
      title: "Pin Card",
      description:
        "Pin a card for the current user, keeping it in their personal quick-access list. " +
        "Pins are per-user and per-account: pinning affects only the authenticated user's list, " +
        "not what teammates see. Use this to keep track of a card you need to return to. " +
        "Retrieve the resulting list with fizzy_get_pins. " +
        "To flag a card as high-priority for the whole team instead, use fizzy_gild_card.",
      schema: schemas.pinCardSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_unpin_card",
      title: "Unpin Card",
      description:
        "Unpin a card for the current user, removing it from their personal quick-access list. " +
        "Only affects the authenticated user's pins; the card itself is unchanged and remains " +
        "on its board.",
      schema: schemas.unpinCardSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
  ] as ToolDefinition[],

  // ============ Comment Tools ============
  comments: [
    {
      name: "fizzy_get_card_comments",
      title: "List Card Comments",
      description:
        "Get all comments on a card in chronological order. Returns comment text (HTML), authors, timestamps, " +
        "and reaction counts. Use this to review discussion and feedback on a card. " +
        "The result is the complete thread: every upstream page is fetched server-side, so there is no page " +
        "parameter and nothing further to request. " +
        "Use fields='summary' to drop the duplicated HTML body and the repeated per-comment card/creator " +
        "detail — comment text itself is never truncated in either mode. " +
        "Attachments posted in a comment appear only as raw <action-text-attachment> markup inside the " +
        "HTML body, which fields='summary' drops entirely. Pass include_attachments=true to add a " +
        "per-comment 'attachments' array with each file's filename, content_type, byte_size, dimensions " +
        "and signed_id — it works in both modes — then pass that signed_id and filename to " +
        "fizzy_get_attachment to actually see an image.",
      schema: schemas.getCardCommentsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_get_comment",
      title: "Get Comment Details",
      description:
        "Get detailed information about a specific comment including full HTML content, author, timestamp, " +
        "and reactions. Use this to read a specific comment in detail.",
      schema: schemas.getCommentSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_create_comment",
      title: "Create Comment",
      description:
        "Add a new comment to a card. Supports HTML formatting for rich text content including " +
        "bold, italic, links, code blocks, and lists. Use this to provide feedback or updates on cards.",
      schema: schemas.createCommentSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_update_comment",
      title: "Update Comment",
      description:
        "Edit an existing comment's content. Supports HTML formatting. " +
        "Only the comment author can update their own comments.",
      schema: schemas.updateCommentSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_delete_comment",
      title: "Delete Comment",
      description:
        "Permanently delete a comment from a card. " +
        "⚠️ This is a destructive operation that cannot be undone. Only the comment author can delete their own comments.",
      schema: schemas.deleteCommentSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
  ] as ToolDefinition[],

  // ============ Reaction Tools ============
  reactions: [
    {
      name: "fizzy_get_reactions",
      title: "List Comment Reactions",
      description:
        "Get all emoji reactions on a comment. Returns reaction content (emoji or text), authors, and timestamps. " +
        "Use this to see how team members respond to comments.",
      schema: schemas.getReactionsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_add_reaction",
      title: "Add Reaction",
      description:
        "Add an emoji reaction to a comment. Reactions can be emojis (👍, ❤️, 🎉) or short text (max 16 characters). " +
        "Use this to quickly acknowledge or respond to comments without writing a full reply.",
      schema: schemas.addReactionSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_remove_reaction",
      title: "Remove Reaction",
      description:
        "Remove an emoji reaction from a comment. " +
        "Only the user who added the reaction can remove it.",
      schema: schemas.removeReactionSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
  ] as ToolDefinition[],

  // ============ Step (To-Do) Tools ============
  steps: [
    {
      name: "fizzy_get_step",
      title: "Get Step Details",
      description:
        "Get detailed information about a specific to-do step on a card including description and completion status. " +
        "Steps are checklist items that break down card work into smaller tasks.",
      schema: schemas.getStepSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_create_step",
      title: "Create Step",
      description:
        "Create a new to-do step (checklist item) on a card. Steps help break down work into manageable tasks. " +
        "New steps are created as incomplete by default.",
      schema: schemas.createStepSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_update_step",
      title: "Update Step",
      description:
        "Update a to-do step's description or completion status. " +
        "Use this to mark steps as complete/incomplete or edit their descriptions.",
      schema: schemas.updateStepSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_delete_step",
      title: "Delete Step",
      description:
        "Permanently delete a to-do step from a card. " +
        "⚠️ This is a destructive operation that cannot be undone.",
      schema: schemas.deleteStepSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
  ] as ToolDefinition[],

  // ============ Column Tools ============
  columns: [
    {
      name: "fizzy_get_columns",
      title: "List Board Columns",
      description:
        "Get all workflow columns on a board. Columns represent workflow stages (e.g., To Do, In Progress, Done). " +
        "Returns column IDs, names, colors, and positions in the workflow.",
      schema: schemas.getColumnsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_get_column",
      title: "Get Column Details",
      description:
        "Get detailed information about a specific workflow column including its name, color, " +
        "position, and card count.",
      schema: schemas.getColumnSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_create_column",
      title: "Create Column",
      description:
        "Create a new workflow column on a board with specified name and color. " +
        "Columns define workflow stages and help organize cards through your process. " +
        "Available colors: blue, gray, tan, yellow, lime, aqua, violet, purple, pink.",
      schema: schemas.createColumnSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_update_column",
      title: "Update Column",
      description:
        "Update a workflow column's name or color. Use this to refine your workflow stages or improve visual organization. " +
        "This does not affect cards in the column.",
      schema: schemas.updateColumnSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_delete_column",
      title: "Delete Column",
      description:
        "Permanently delete a workflow column from a board. Cards in this column will be moved to triage. " +
        "⚠️ This is a destructive operation that cannot be undone.",
      schema: schemas.deleteColumnSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
  ] as ToolDefinition[],

  // ============ Tag Tools ============
  tags: [
    {
      name: "fizzy_get_tags",
      title: "List Tags",
      description:
        "Get all tags used in an account. Tags are labels for categorizing and organizing cards. " +
        "Returns tag IDs, titles, and usage counts across cards. " +
        "The result is the complete list: every upstream page is fetched server-side, so there is no page " +
        "parameter and nothing further to request.",
      schema: schemas.getTagsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
  ] as ToolDefinition[],

  // ============ User Tools ============
  users: [
    {
      name: "fizzy_get_users",
      title: "List Users",
      description:
        "Get all active users in an account. Returns user IDs, names, emails, and access levels. " +
        "Use this to discover available users for card assignments. " +
        "The result is the complete roster: every upstream page is fetched server-side, so there is no page " +
        "parameter and nothing further to request.",
      schema: schemas.getUsersSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_get_user",
      title: "Get User Details",
      description:
        "Get detailed information about a specific user including their name, email, role, and permissions.",
      schema: schemas.getUserSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_update_user",
      title: "Update User",
      description:
        "Update a user's display name or other profile information. " +
        "Requires appropriate permissions for user management.",
      schema: schemas.updateUserSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_deactivate_user",
      title: "Deactivate User",
      description:
        "Deactivate a user account, revoking their access to the Fizzy account. " +
        "⚠️ This is a significant operation that affects user access. Use with caution.",
      schema: schemas.deactivateUserSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
  ] as ToolDefinition[],

  // ============ Notification Tools ============
  notifications: [
    {
      name: "fizzy_get_notifications",
      title: "List Notifications",
      description:
        "Get notifications for the current user in an account. Returns notification content, " +
        "read/unread status, timestamps, and related cards or comments. " +
        "By default (page omitted) returns up to 100 unread notifications followed by the most recent page " +
        "of already-read ones — this is what you want for 'what needs my attention'. " +
        "Pages 2 and up contain ONLY older, already-read notifications; no unread notification ever appears " +
        "there. To walk back through history, call with page=2, then 3, and so on until the array comes back " +
        "empty. Page size is server-controlled and variable, so never derive counts or remaining history from " +
        "the length of a page. " +
        "Use fields='summary' to shrink the embedded card and creator objects down to their key " +
        "identifying fields — typically several times smaller than the full payload.",
      schema: schemas.getNotificationsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_mark_notification_read",
      title: "Mark Notification Read",
      description:
        "Mark a specific notification as read. Use this to acknowledge notifications and clear them from unread status.",
      schema: schemas.markNotificationReadSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_mark_notification_unread",
      title: "Mark Notification Unread",
      description:
        "Mark a specific notification as unread. Use this to flag notifications for later attention.",
      schema: schemas.markNotificationUnreadSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_mark_all_notifications_read",
      title: "Mark All Notifications Read",
      description:
        "Mark all notifications in an account as read at once. Use this to clear your notification inbox " +
        "after reviewing all updates.",
      schema: schemas.markAllNotificationsReadSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
  ] as ToolDefinition[],

  // ============ Attachment Tools ============
  attachments: [
    {
      name: "fizzy_upload_file",
      title: "Upload File",
      description:
        "Upload a file (screenshot, image, PDF, log) to Fizzy and get back the HTML needed to embed it. " +
        "This does not attach the file on its own — it returns an 'attachment_html' snippet that you then " +
        "include in any rich-text field: pass it in 'body' to fizzy_create_comment or fizzy_update_comment, " +
        "or in 'description' to fizzy_create_card or fizzy_update_card. Combine it with your own HTML, " +
        "e.g. body: \"<p>Steps to reproduce:</p>\" + attachment_html. " +
        "Provide the file as 'file_path' (a local path — stdio transport only) or as 'base64_data' with " +
        "'filename' (works everywhere).",
      schema: schemas.uploadFileSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: "fizzy_get_attachment",
      title: "Get Attachment",
      description:
        "Fetch a file already attached to a card or comment and return it so it can actually be " +
        "looked at. Images (PNG, JPEG, GIF, WebP) come back as an image the model can see; any " +
        "other type comes back as metadata with a note that it cannot be rendered, and its bytes " +
        "are not downloaded. " +
        "Get the 'signed_id' and 'filename' to pass here from fizzy_get_card or " +
        "fizzy_get_card_comments called with include_attachments=true — this tool takes no URL, " +
        "and building the arguments from a URL by hand will not work. " +
        "Prefer the preview: when the attachment reports a 'preview_variation', pass it as " +
        "'variation' to get the resized version, which is a fraction of the bytes and is what a " +
        "full-resolution screenshot is refused in favour of. " +
        "Use this whenever a card or comment references a screenshot, mockup, diagram, or error " +
        "image and the answer depends on what it shows.",
      schema: schemas.getAttachmentSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
  ] as ToolDefinition[],
} as const;

/**
 * Flat array of all tool definitions for iteration
 */
export const ALL_TOOLS: ToolDefinition[] = Object.values(TOOL_DEFINITIONS).flat();

/**
 * Tool lookup by name for O(1) access
 */
export const TOOLS_BY_NAME = new Map<string, ToolDefinition>(
  ALL_TOOLS.map((tool) => [tool.name, tool])
);

/**
 * Get tool definition by name
 */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOLS_BY_NAME.get(name);
}
