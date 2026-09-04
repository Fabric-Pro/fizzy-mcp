/**
 * Zod schemas for MCP tool parameters
 */

import { z } from "zod";

// Common ID schemas with detailed descriptions
export const accountSlugSchema = z.string().describe(
  "The account slug identifier (e.g., '123456' or '/123456'). " +
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

// Shared `fields` projection schema for the list tools whose full payloads are
// dominated by fields most callers don't need (long descriptions, duplicated
// HTML bodies, repeated embedded objects). Referenced by getCardsSchema,
// getCardCommentsSchema, getNotificationsSchema, and getPinsSchema.
export const fieldsSchema = z
  .enum(["summary", "full"])
  .optional()
  .describe(
    "Response projection. 'full' (the default — used when this parameter is omitted) " +
    "returns every field exactly as the API provides it, unchanged from prior behavior. " +
    "'summary' strips large, rarely-needed fields — full HTML/rich-text bodies and " +
    "descriptions, duplicated plain-text/HTML pairs, and repeated embedded objects like " +
    "the full creator or card — keeping only IDs, names, and short previews. Summary " +
    "responses are typically 4x to over 100x smaller depending on the tool. Prefer " +
    "'summary' when scanning, searching, or listing many results; switch to 'full' (or a " +
    "single-item fetch tool) once you need complete detail on a specific item."
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
    "'postponing_soon' = cards nearing their board's auto-postpone period (about to move to Not Now), " +
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
  board_id: z.string().optional().describe(
    "Filter cards by board. Only returns cards belonging to the specified board. " +
    "Get available board IDs from fizzy_get_boards. " +
    "Omit to include cards from all boards."
  ),
  indexed_by: indexedBySchema,
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
    "Text search over card titles, descriptions and comments. Fizzy splits the input on whitespace " +
    "and punctuation (hyphens included), stems the words, and OR-matches them; results are ordered " +
    "by last activity, not relevance. There is no phrase or exact-match syntax, and quotes are ignored. " +
    "A multi-word or hyphenated query is therefore a broad recall query: total_count > 0 does not " +
    "prove the exact string exists. For an existence check, set search_mode to 'all' or search a " +
    "single distinctive alphanumeric token, and confirm the match in the returned cards. " +
    "Omit to return all cards (subject to other filters)."
  ),
  search_mode: z.enum(["any", "all"]).optional().describe(
    "How the words of `search` combine. 'any' (default) sends the whole string as one term, which " +
    "Fizzy OR-matches word by word. 'all' splits it on whitespace and punctuation and requires every " +
    "usable word to match, which makes search usable as an existence check before creating a card " +
    "(still confirm the match in the returned cards: words are stemmed, not matched exactly). In 'all' " +
    "mode, words shorter than 3 characters and MySQL full-text stopwords (the, to, with, for, ...) are " +
    "dropped before the request because on their own they match nothing and would empty the result; " +
    "the response then includes search_terms (sent) and ignored_search_terms (dropped). " +
    "Errors if no usable word remains. Has no effect without `search`."
  ),
  // Use .min(1) rather than .positive(): both mean "page >= 1" for an integer, but
  // .positive() is an *exclusive* bound, which zod-to-json-schema renders as the
  // draft-04 `exclusiveMinimum: true` flag. Draft 2020-12 requires a numeric bound,
  // so the exclusive form makes the whole tool list unusable for strict clients.
  page: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional().describe(
    "Page number to fetch (1-based). Card listings are paginated with a server-controlled, variable page size " +
    "(early pages are small, e.g. 15 cards; later pages are larger). Omit for the first page; " +
    "pass the next_page value from the previous response to fetch subsequent pages."
  ),
  fields: fieldsSchema,
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
    "about card updates and are responsible for the work. Omit for unassigned cards. " +
    "Users must be members of the card's board; ids that aren't are reported back in " +
    "an 'assignment_warnings' field on the created card rather than failing the create."
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
    "⚠️ This replaces all assignees - it's not additive. Pass [] to unassign everyone. " +
    "Cards with more than 5 assignees are rejected, because the API reports only the " +
    "first 5 and the rest cannot be replaced safely - use fizzy_toggle_card_assignment " +
    "there, and for adding/removing individual users generally. " +
    "The resulting assignee list is read back and reported, so check the response: it " +
    "names any user that did not end up in the state you asked for."
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

// Comment schemas with HTML formatting guidance.
//
// These deliberately carry no `.refine()`. McpServer reads a tool's fields off
// its schema's shape, and refining produces a ZodEffects, which has none — so a
// refined schema publishes `{"type":"object","properties":{}}` to stdio clients
// and leaves the model unable to see any argument at all.
//
// The "one of card_id or card_number" rule is not lost by dropping it here: it
// is enforced a layer down by resolveCardNumber, which throws when neither is
// supplied. That layer has to own it regardless, because the Cloudflare
// transport dispatches raw arguments without running Zod at all — so before
// this, stdio and Cloudflare rejected the same call with different errors.
const commentCardSelectorBase = z.object({
  account_slug: accountSlugSchema,
  card_id: cardIdSchema
    .optional()
    .describe(
      "The unique card identifier (numeric string, e.g., '67890'). " +
      "Provide either card_id or card_number. " +
      "Get available card IDs from fizzy_get_cards."
    ),
  card_number: cardNumberSchema
    .optional()
    .describe(
      "The card number - the visible ID shown on the board (e.g., '#123'). " +
      "Provide either card_id or card_number."
    ),
});

export const getCardCommentsSchema = commentCardSelectorBase.extend({
  fields: fieldsSchema,
});

export const createCommentSchema = commentCardSelectorBase.extend({
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
  card_number: cardNumberSchema, // Card number required for delete endpoint
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
  // Same .min(1) reasoning as getCardsSchema.page: .positive() is an exclusive
  // bound, which zod-to-json-schema renders as draft-04 `exclusiveMinimum: true`
  // and makes the whole tool list unusable for strict clients.
  page: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional().describe(
    "Page of already-read notification history to fetch (1-based). Omit (or pass 1) for the " +
    "default response: up to 100 unread notifications followed by the most recent page of read " +
    "ones. Pages 2 and up contain ONLY older, already-read notifications - no unread ones ever " +
    "appear there. Page size is server-controlled and variable, so never infer counts or how " +
    "much history is left from how many items a page returns; walk with page=2, 3, ... until " +
    "the array comes back empty."
  ),
  fields: fieldsSchema,
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

// ============ Pin schemas ============

export const pinCardSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
});

export const unpinCardSchema = z.object({
  account_slug: accountSlugSchema,
  card_number: cardNumberSchema,
});

// No `page` field: unlike the card listing, GET /:account_slug/my/pins is not
// paginated — it returns at most 100 pinned cards in one bare array.
export const getPinsSchema = z.object({
  account_slug: accountSlugSchema,
  fields: fieldsSchema,
});

// ============ Attachment schemas ============

// Deliberately a plain object with no .refine(): McpServer.registerTool reads its
// fields off the schema's shape, and a refined schema is a ZodEffects wrapper with
// no shape to read — so refining this would publish `properties: {}` to stdio
// clients and leave the model unable to see any argument.
// The either/or rules below are enforced at runtime by resolveAttachment, which
// has to own them regardless: the Cloudflare transport dispatches raw arguments
// without Zod at all.
export const uploadFileSchema = z
  .object({
    account_slug: accountSlugSchema,
    file_path: z
      .string()
      .optional()
      .describe(
        "Absolute path to a local file. Provide exactly one of file_path or base64_data. " +
        "Only available over the stdio transport, where the caller and the server are the " +
        "same user; hosted transports reject it. Preferred locally — it avoids inlining " +
        "the file's bytes into the request."
      ),
    base64_data: z
      .string()
      .optional()
      .describe(
        "The file's bytes, Base64-encoded. Provide exactly one of file_path or base64_data. " +
        "Works on every transport, and requires filename. Use this when file_path is " +
        "unavailable."
      ),
    filename: z
      .string()
      .optional()
      .describe(
        "Name to store the file under, e.g. 'screenshot.png'. Required with base64_data; " +
        "defaults to the basename of file_path otherwise."
      ),
    content_type: z
      .string()
      .optional()
      .describe(
        "MIME type, e.g. 'image/png'. Inferred from the filename extension when omitted, " +
        "falling back to application/octet-stream."
      ),
  });
