/**
 * Zod schemas for MCP tool parameters
 */

import { z } from "zod";

// Common ID schemas with detailed descriptions
export const accountSlugSchema = z.string().describe(
  "The account slug identifier (e.g., '6117483' or '/6117483'). " +
  "This identifies which Fizzy account to operate on. " +
  "Get available account slugs from fizzy_get_identity or fizzy_get_accounts."
);

export const boardIdSchema = z.string().describe(
  "The unique board identifier (numeric string, e.g., '12345'). " +
  "Get available board IDs from fizzy_get_boards."
);

export const cardIdSchema = z.string().describe(
  "The unique card identifier (numeric string, e.g., '67890'). " +
  "Get available card IDs from fizzy_get_cards."
);

export const cardNumberSchema = z.string().describe(
  "The card number - the visible ID shown on the board (e.g., '#123'). " +
  "This is different from card_id and is used for some endpoints. " +
  "Card numbers are shown in the Fizzy UI and are user-friendly identifiers."
);

export const columnIdSchema = z.string().describe(
  "The unique column identifier (numeric string). Columns represent workflow stages. " +
  "Get available column IDs from fizzy_get_columns."
);

export const tagIdSchema = z.string().describe(
  "The unique tag identifier (numeric string). Tags are labels for categorizing cards. " +
  "Get available tag IDs from fizzy_get_tags."
);

export const userIdSchema = z.string().describe(
  "The unique user identifier (numeric string). " +
  "Get available user IDs from fizzy_get_users."
);

export const notificationIdSchema = z.string().describe(
  "The unique notification identifier (numeric string). " +
  "Get notification IDs from fizzy_get_notifications."
);

export const commentIdSchema = z.string().describe(
  "The unique comment identifier (numeric string). " +
  "Get comment IDs from fizzy_get_card_comments."
);

export const reactionIdSchema = z.string().describe(
  "The unique reaction identifier (numeric string). " +
  "Get reaction IDs from fizzy_get_reactions."
);

export const stepIdSchema = z.string().describe(
  "The unique step/to-do identifier (numeric string). Steps are checklist items on cards. " +
  "Step IDs are returned when creating steps or fetching card details."
);

// Status schemas with detailed descriptions
export const cardStatusSchema = z
  .enum(["draft", "published", "archived"])
  .describe(
    "Card visibility status: " +
    "'draft' = not yet published (hidden from general view), " +
    "'published' = active and visible to team, " +
    "'archived' = completed/closed (hidden from active view)"
  );

export const cardStatusFilterSchema = z
  .enum(["draft", "published", "archived"])
  .optional()
  .describe(
    "Optional filter to limit results by card status. " +
    "Omit to include all statuses. " +
    "'draft' = unpublished cards, 'published' = active cards, 'archived' = closed cards"
  );

// Indexed by schema for special card filters
export const indexedBySchema = z
  .enum(["all", "closed", "not_now", "stalled", "postponing_soon", "golden"])
  .optional()
  .describe(
    "Filter cards by special index. Options: " +
    "'all' = all cards including closed, " +
    "'closed' = only closed/archived cards, " +
    "'not_now' = cards in Not Now triage, " +
    "'stalled' = cards with no recent activity, " +
    "'postponing_soon' = cards with upcoming due dates, " +
    "'golden' = priority/important cards marked as golden"
  );

// Column color schema with visual context
export const columnColorSchema = z
  .enum(["blue", "gray", "tan", "yellow", "lime", "aqua", "violet", "purple", "pink"])
  .optional()
  .describe(
    "Visual color for the workflow column. Available colors: " +
    "blue (default), gray (neutral), tan (warm), yellow (attention), " +
    "lime (success), aqua (info), violet (creative), purple (priority), pink (highlight). " +
    "Colors help visually organize and distinguish workflow stages."
  );

// Tool parameter schemas
export const getIdentitySchema = z.object({});

export const getAccountsSchema = z.object({});

// Board schemas
export const getBoardsSchema = z.object({
  account_slug: accountSlugSchema,
});

export const getBoardSchema = z.object({
  account_slug: accountSlugSchema,
  board_id: boardIdSchema,
});

export const createBoardSchema = z.object({
  account_slug: accountSlugSchema,
  name: z.string().describe("The name of the board"),
});

export const updateBoardSchema = z.object({
  account_slug: accountSlugSchema,
  board_id: boardIdSchema,
  name: z.string().describe("The new name of the board"),
});

export const deleteBoardSchema = z.object({
  account_slug: accountSlugSchema,
  board_id: boardIdSchema,
});

// Card schemas with comprehensive descriptions
export const getCardsSchema = z.object({
  account_slug: accountSlugSchema,
  indexed_by: indexedBySchema,
  status: cardStatusFilterSchema,
  column_id: z.string().optional().describe(
    "Filter cards by workflow column. Only returns cards in the specified column. " +
    "Omit to include cards from all columns and triage."
  ),
  assignee_ids: z.array(z.string()).optional().describe(
    "Filter cards by assigned users. Provide an array of user IDs. " +
    "Only returns cards assigned to ANY of the specified users (OR logic). " +
    "Omit to include cards regardless of assignments."
  ),
  tag_ids: z.array(z.string()).optional().describe(
    "Filter cards by tags. Provide an array of tag IDs. " +
    "Only returns cards that have ANY of the specified tags (OR logic). " +
    "Omit to include cards regardless of tags."
  ),
  search: z.string().optional().describe(
    "Full-text search query to filter cards by title or description content. " +
    "Performs fuzzy matching across card text. " +
    "Omit to return all cards (subject to other filters)."
  ),
});


export const getCardSchema = z.object({
  account_slug: accountSlugSchema,
  card_id: cardNumberSchema,
});

export const createCardSchema = z.object({
  account_slug: accountSlugSchema,
  board_id: boardIdSchema,
  title: z.string().describe(
    "The card title (required). Keep concise and descriptive. " +
    "This is the main identifier shown in card lists and boards."
  ),
  description: z.string().optional().describe(
    "Detailed card description. Supports HTML formatting including: " +
    "<b>bold</b>, <i>italic</i>, <a href='...'>links</a>, <code>code</code>, " +
    "<ul><li>lists</li></ul>, <pre>code blocks</pre>. " +
    "Omit for cards that don't need detailed descriptions."
  ),
  status: z.enum(["draft", "published"]).optional().describe(
    "Initial card status. 'draft' = not yet visible to team, 'published' = visible (default). " +
    "Draft cards are useful for preparing work before sharing."
  ),
  column_id: z.string().optional().describe(
    "Workflow column to place the card in. Omit to place card in triage (default). " +
    "Cards in triage haven't been prioritized into workflow yet."
  ),
  assignee_ids: z.array(z.string()).optional().describe(
    "Array of user IDs to assign to this card. Assigned users receive notifications " +
    "about card updates and are responsible for the work. Omit for unassigned cards."
  ),
  tag_ids: z.array(z.string()).optional().describe(
    "Array of tag IDs to categorize the card. Tags help with organization and filtering. " +
    "Omit to create card without tags."
  ),
  due_on: z.string().optional().describe(
    "Due date in ISO 8601 format (e.g., '2024-12-31' or '2024-12-31T17:00:00Z'). " +
    "Used for deadline tracking. Omit for cards without deadlines."
  ),
});

export const updateCardSchema = z.object({
  account_slug: accountSlugSchema,
  card_id: cardNumberSchema,
  title: z.string().optional().describe(
    "New card title. Omit to keep current title unchanged."
  ),
  description: z.string().optional().describe(
    "New card description (HTML supported). Omit to keep current description. " +
    "⚠️ This replaces the entire description - it's not a partial update."
  ),
  status: cardStatusSchema.optional().describe(
    "New card status. Omit to keep current status. " +
    "Note: Use fizzy_close_card/fizzy_reopen_card for archiving workflows."
  ),
  column_id: z.string().optional().describe(
    "Move card to specified workflow column. Omit to keep in current location. " +
    "⚠️ This replaces column assignment completely."
  ),
  assignee_ids: z.array(z.string()).optional().describe(
    "New array of assignee user IDs. Omit to keep current assignments. " +
    "⚠️ This replaces all assignees - it's not additive. " +
    "Note: Use fizzy_toggle_card_assignment for adding/removing individual users."
  ),
  tag_ids: z.array(z.string()).optional().describe(
    "New array of tag IDs. Omit to keep current tags. " +
    "⚠️ This replaces all tags - it's not additive. " +
    "Note: Use fizzy_toggle_card_tag for adding/removing individual tags."
  ),
  due_on: z.string().optional().describe(
    "New due date in ISO 8601 format. Omit to keep current due date. " +
    "Set to null to remove due date."
  ),
});

export const deleteCardSchema = z.object({
  account_slug: accountSlugSchema,
  card_id: cardNumberSchema,
});

// Comment schemas with HTML formatting guidance
export const getCardCommentsSchema = z.object({
  account_slug: accountSlugSchema,
  card_id: cardIdSchema,
});

export const createCommentSchema = z.object({
  account_slug: accountSlugSchema,
  card_id: cardIdSchema,
  body: z.string().describe(
    "Comment content (required). Supports HTML formatting: " +
    "<b>bold</b>, <i>italic</i>, <a href='...'>links</a>, <code>code</code>, " +
    "<ul><li>bullet lists</li></ul>, <ol><li>numbered lists</li></ol>, " +
    "<pre>code blocks</pre>, <blockquote>quotes</blockquote>. " +
    "Use plain text for simple comments."
  ),
});

export const deleteCommentSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardIdSchema, // Card number required for delete endpoint
  comment_id: commentIdSchema,
});

// Column schemas
export const getColumnsSchema = z.object({
  account_slug: accountSlugSchema,
  board_id: boardIdSchema,
});

export const getColumnSchema = z.object({
  account_slug: accountSlugSchema,
  board_id: boardIdSchema,
  column_id: columnIdSchema,
});

export const createColumnSchema = z.object({
  account_slug: accountSlugSchema,
  board_id: boardIdSchema,
  name: z.string().describe("The name of the column"),
  color: columnColorSchema,
});

export const updateColumnSchema = z.object({
  account_slug: accountSlugSchema,
  board_id: boardIdSchema,
  column_id: columnIdSchema,
  name: z.string().optional().describe("The new name of the column"),
  color: columnColorSchema,
});

export const deleteColumnSchema = z.object({
  account_slug: accountSlugSchema,
  board_id: boardIdSchema,
  column_id: columnIdSchema,
});

// Tag schemas
export const getTagsSchema = z.object({
  account_slug: accountSlugSchema,
});

// Note: POST/DELETE /:account_slug/tags endpoints return 404
// Tag creation/deletion is not available via API

// User schemas
export const getUsersSchema = z.object({
  account_slug: accountSlugSchema,
});

export const getUserSchema = z.object({
  account_slug: accountSlugSchema,
  user_id: userIdSchema,
});

export const updateUserSchema = z.object({
  account_slug: accountSlugSchema,
  user_id: userIdSchema,
  name: z.string().describe("The new display name of the user"),
});

export const deactivateUserSchema = z.object({
  account_slug: accountSlugSchema,
  user_id: userIdSchema,
});

// Notification schemas
export const getNotificationsSchema = z.object({
  account_slug: accountSlugSchema,
});

export const markNotificationReadSchema = z.object({
  account_slug: accountSlugSchema,
  notification_id: notificationIdSchema,
});

export const markNotificationUnreadSchema = z.object({
  account_slug: accountSlugSchema,
  notification_id: notificationIdSchema,
});

export const markAllNotificationsReadSchema = z.object({
  account_slug: accountSlugSchema,
});

// ============ Card Action schemas ============

export const closeCardSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
});

export const reopenCardSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
});

export const moveCardToNotNowSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
});

export const moveCardToColumnSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
  column_id: columnIdSchema,
});

export const sendCardToTriageSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
});

export const toggleCardTagSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
  tag_title: z.string().describe(
    "The tag title/name (e.g., 'urgent', 'bug', 'feature'). " +
    "Leading '#' characters are automatically stripped. " +
    "✨ If the tag doesn't exist in the account, it will be created automatically. " +
    "If the card already has this tag, it will be removed. If not, it will be added."
  ),
});

export const toggleCardAssignmentSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
  assignee_id: userIdSchema.describe("The ID of the user to assign/unassign"),
});

export const watchCardSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
});

export const unwatchCardSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
});

// ============ Additional Comment schemas ============

export const getCommentSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
  comment_id: commentIdSchema,
});

export const updateCommentSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
  comment_id: commentIdSchema,
  body: z.string().describe("The new comment body (supports HTML)"),
});

// ============ Reaction schemas ============

export const getReactionsSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
  comment_id: commentIdSchema,
});

export const addReactionSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
  comment_id: commentIdSchema,
  content: z.string().max(16).describe(
    "The reaction content (max 16 characters). Can be: " +
    "emojis (👍, ❤️, 🎉, 👏, 🚀), " +
    "short text ('Nice!', 'LGTM', '+1', 'Thanks'), " +
    "or emoji shortcodes (':thumbsup:', ':heart:'). " +
    "Reactions provide quick, lightweight responses to comments."
  ),
});

export const removeReactionSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
  comment_id: commentIdSchema,
  reaction_id: reactionIdSchema,
});

// ============ Step schemas ============

export const getStepSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
  step_id: stepIdSchema,
});

export const createStepSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
  content: z.string().describe(
    "The to-do step content (required). Keep concise - steps are checklist items. " +
    "Examples: 'Review PR', 'Update tests', 'Deploy to staging'. " +
    "Steps are created as incomplete by default."
  ),
});

export const updateStepSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
  step_id: stepIdSchema,
  content: z.string().optional().describe(
    "New step content. Omit to keep current content unchanged."
  ),
  completed: z.boolean().optional().describe(
    "Completion status. true = mark as complete/done, false = mark as incomplete/pending. " +
    "Omit to keep current completion status. This is how you check off checklist items."
  ),
});

export const deleteStepSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
  step_id: stepIdSchema,
});

// ============ Golden Card schemas ============

export const gildCardSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
});

export const ungildCardSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
});

