/**
 * Zod schemas for MCP tool parameters
 */

import { z } from "zod";

// Common schemas
export const accountSlugSchema = z.string().describe("The account slug identifier");
export const boardIdSchema = z.string().describe("The board ID");
export const cardIdSchema = z.string().describe("The card ID");
export const cardNumberSchema = z.string().describe("The card number (visible ID on board)");
export const columnIdSchema = z.string().describe("The column ID");
export const tagIdSchema = z.string().describe("The tag ID");
export const userIdSchema = z.string().describe("The user ID");
export const notificationIdSchema = z.string().describe("The notification ID");
export const commentIdSchema = z.string().describe("The comment ID");
export const reactionIdSchema = z.string().describe("The reaction ID");
export const stepIdSchema = z.string().describe("The step ID");

// Status schemas
export const cardStatusSchema = z
  .enum(["draft", "published", "archived"])
  .describe("Card status");

export const cardStatusFilterSchema = z
  .enum(["draft", "published", "archived"])
  .optional()
  .describe("Filter by card status");

// Column color schema
export const columnColorSchema = z
  .enum(["blue", "gray", "tan", "yellow", "lime", "aqua", "violet", "purple", "pink"])
  .optional()
  .describe("Column color (blue, gray, tan, yellow, lime, aqua, violet, purple, pink)");

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

// Card schemas
export const getCardsSchema = z.object({
  account_slug: accountSlugSchema,
  status: cardStatusFilterSchema,
  column_id: z.string().optional().describe("Filter by column ID"),
  assignee_ids: z.array(z.string()).optional().describe("Filter by assignee IDs"),
  tag_ids: z.array(z.string()).optional().describe("Filter by tag IDs"),
  search: z.string().optional().describe("Search query"),
});


export const getCardSchema = z.object({
  account_slug: accountSlugSchema,
  card_id: cardIdSchema,
});

export const createCardSchema = z.object({
  account_slug: accountSlugSchema,
  board_id: boardIdSchema,
  title: z.string().describe("The title of the card"),
  description: z.string().optional().describe("The description of the card (supports HTML)"),
  status: z.enum(["draft", "published"]).optional().describe("Card status (draft or published)"),
  column_id: z.string().optional().describe("The column ID to place the card in"),
  assignee_ids: z.array(z.string()).optional().describe("User IDs to assign to the card"),
  tag_ids: z.array(z.string()).optional().describe("Tag IDs to add to the card"),
  due_on: z.string().optional().describe("Due date in ISO 8601 format"),
});

export const updateCardSchema = z.object({
  account_slug: accountSlugSchema,
  card_id: cardIdSchema,
  title: z.string().optional().describe("The new title of the card"),
  description: z.string().optional().describe("The new description of the card"),
  status: cardStatusSchema.optional(),
  column_id: z.string().optional().describe("Move card to this column"),
  assignee_ids: z.array(z.string()).optional().describe("New assignee user IDs"),
  tag_ids: z.array(z.string()).optional().describe("New tag IDs"),
  due_on: z.string().optional().describe("New due date in ISO 8601 format"),
});

export const deleteCardSchema = z.object({
  account_slug: accountSlugSchema,
  card_id: cardIdSchema,
});

// Comment schemas
export const getCardCommentsSchema = z.object({
  account_slug: accountSlugSchema,
  card_id: cardIdSchema,
});

export const createCommentSchema = z.object({
  account_slug: accountSlugSchema,
  card_id: cardIdSchema,
  body: z.string().describe("The comment body (supports HTML)"),
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
  tag_title: z.string().describe("The title of the tag (leading '#' is stripped). If tag doesn't exist, it will be created."),
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
  content: z.string().max(16).describe("The reaction text (max 16 characters, e.g., '👍', 'Great!', '❤️')"),
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
  description: z.string().describe("The to-do step description"),
});

export const updateStepSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
  step_id: stepIdSchema,
  description: z.string().optional().describe("The new step description"),
  completed: z.boolean().optional().describe("Mark step as completed or not"),
});

export const deleteStepSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
  step_id: stepIdSchema,
});

