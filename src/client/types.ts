/**
 * Fizzy API Types
 * Based on Fizzy API documentation: https://raw.githubusercontent.com/basecamp/fizzy/main/docs/API.md
 */

// Base types
export interface FizzyUser {
  id: string;
  name: string;
  role: "owner" | "member";
  active: boolean;
  email_address: string;
  created_at: string;
  url: string;
}

export interface FizzyAccount {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  url?: string;
  /** The current user's info within this account (returned in /my/identity) */
  user?: FizzyUser;
}

export interface FizzyBoard {
  id: string;
  name: string;
  created_at: string;
  url: string;
  cards_count?: number;
}

export interface FizzyCard {
  id: string;
  number?: number;
  title: string;
  description?: string;
  status: "draft" | "published" | "archived";
  column?: FizzyColumn;
  creator?: FizzyUser;
  /**
   * Capped at five entries by the API (`app/views/cards/_card.json.jbuilder`
   * renders `card.assignees.limit(5)`), so this is not necessarily the full
   * roster — check `has_more_assignees` before treating it as complete.
   */
  assignees?: FizzyUser[];
  /** True when the card has more assignees than the five `assignees` carries. */
  has_more_assignees?: boolean;
  tags?: FizzyTag[];
  due_on?: string;
  created_at: string;
  updated_at?: string;
  url: string;
}

export interface FizzyColumn {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface FizzyTag {
  id: string;
  title: string;
  created_at: string;
  url: string;
}

/**
 * A rich-text field as the API returns it. Both representations of the same
 * content: `html` carries the markup, including `<action-text-attachment>`
 * elements; `plain_text` is the same content flattened.
 *
 * Only responses use this shape. Rich text is *written* as a plain HTML string
 * — see `CreateCommentRequest.body`.
 *
 * @see https://github.com/basecamp/fizzy/blob/main/docs/api/sections/comments.md
 */
export interface FizzyRichText {
  plain_text: string;
  html: string;
}

export interface FizzyComment {
  id: string;
  /**
   * Rich text, not a string. Reading `.html` or `.plain_text` is required;
   * treating this as a string yields "[object Object]".
   */
  body: FizzyRichText;
  creator: FizzyUser;
  created_at: string;
  updated_at?: string;
}

export interface FizzyNotification {
  id: string;
  read: boolean;
  read_at: string | null;
  created_at: string;
  title: string;
  body: string;
  creator: FizzyUser;
  card: {
    id: string;
    title: string;
    status: string;
    url: string;
  };
  url: string;
}

export interface FizzyReaction {
  id: string;
  emoji: string;
  creator: FizzyUser;
  created_at: string;
}

export interface FizzyStep {
  id: string;
  content: string;
  completed: boolean;
  completed_at?: string;
  creator: FizzyUser;
  created_at: string;
}

// Request types
//
// `assignee_ids` is deliberately absent from both card request types. Upstream's
// `CardsController#card_params` permits only
// `[ :title, :description, :image, :created_at, :last_active_at ]`, so Rails
// strong params silently drop it and the card comes back unassigned. Assignments
// are only reachable through `POST /:slug/cards/:number/assignments`, which the
// card handlers call after the create/update lands.
export interface CreateCardRequest {
  title: string;
  description?: string;
  status?: "draft" | "published";
  column_id?: string;
  tag_ids?: string[];
  due_on?: string;
}

export interface UpdateCardRequest {
  title?: string;
  description?: string;
  status?: "draft" | "published" | "archived";
  column_id?: string;
  tag_ids?: string[];
  due_on?: string;
}

export interface CreateBoardRequest {
  name: string;
}

export interface UpdateBoardRequest {
  name?: string;
}

export interface CreateColumnRequest {
  name: string;
  color?: string;
}

export interface UpdateColumnRequest {
  name?: string;
  color?: string;
}

export interface CreateCommentRequest {
  body: string;
}

export interface UpdateCommentRequest {
  body: string;
}

export interface CreateTagRequest {
  title: string;
}

export interface CreateStepRequest {
  content: string;
}

export interface UpdateStepRequest {
  content?: string;
  completed?: boolean;
}

export interface MoveToColumnRequest {
  column_id: string;
}

export interface ToggleTagRequest {
  tag_id: string;
}

export interface ToggleAssignmentRequest {
  user_id: string;
}

export interface CreateReactionRequest {
  emoji: string;
}

export interface UpdateUserRequest {
  name?: string;
}

// Column colors
export const COLUMN_COLORS = {
  blue: "var(--color-card-default)",
  gray: "var(--color-card-1)",
  tan: "var(--color-card-2)",
  yellow: "var(--color-card-3)",
  lime: "var(--color-card-4)",
  aqua: "var(--color-card-5)",
  violet: "var(--color-card-6)",
  purple: "var(--color-card-7)",
  pink: "var(--color-card-8)",
} as const;

export type ColumnColor = keyof typeof COLUMN_COLORS;

// Identity - Response from GET /my/identity
// Note: User info is embedded in accounts[].user, not at the top level
export interface FizzyIdentity {
  accounts: FizzyAccount[];
}

// Card filtering options — GET /:account_slug/cards
// The filter params this client currently exposes. Array-valued filters use the
// API's plural form (Rails strong params silently drop singular keys like
// board_id/column_id).
// The upstream API also accepts other params (card_ids, creator_ids, closer_ids,
// assignment_status, sorted_by, creation, closure) not yet exposed here.
// See https://github.com/basecamp/fizzy/blob/main/docs/api/sections/cards.md
export type CardFilterOptions = {
  board_ids?: string[];
  column_ids?: string[];
  terms?: string[];
  indexed_by?: "all" | "closed" | "not_now" | "stalled" | "postponing_soon" | "golden";
  assignee_ids?: string[];
  tag_ids?: string[];
};

// Options accepted by getCards: the filters above plus `page`, which is a
// pagination param (1-based), not a filter.
export type CardListOptions = CardFilterOptions & { page?: number };

// One page of GET /:account_slug/cards. The endpoint is paginated upstream
// (geared_pagination in offset mode) with a server-controlled, variable page size.
export interface CardsPage {
  cards: FizzyCard[];
  page: number;               // the page that was fetched (1-based)
  total_count: number | null; // X-Total-Count: total cards matching the filters (advisory; null if header absent)
  has_more: boolean;          // Link header contained rel="next"
  next_page: number | null;   // page + 1 when has_more, else null
}

// ActionText direct uploads — POST /:account_slug/rails/active_storage/direct_uploads
// See https://github.com/basecamp/fizzy/blob/main/docs/api/sections/rich_text.md

// Serialized directly as the `blob` request body, so these names are the API's.
export interface DirectUploadBlobRequest {
  filename: string;
  byte_size: number;
  /** Base64-encoded MD5 of the file. Hex is rejected, with an error that does not say so. */
  checksum: string;
  content_type: string;
}

export interface FizzyDirectUpload {
  id: string;
  key: string;
  filename: string;
  content_type: string;
  byte_size: number;
  checksum: string;
  /**
   * The signed global id that `<action-text-attachment sgid="…">` requires —
   * purpose "attachable", wrapping `gid://fizzy/ActiveStorage::Blob/…`.
   *
   * Not to be confused with `signed_id` below. Fizzy's rich-text documentation
   * says to use `signed_id` here; doing so is accepted by the API and then
   * renders as an unresolved-attachment placeholder, because that token is
   * scoped to purpose "blob_id" instead. This is the field that works.
   */
  attachable_sgid: string;
  /** Purpose "blob_id" — identifies the blob to ActiveStorage, not to ActionText. */
  signed_id: string;
  direct_upload: {
    /** Storage endpoint, on a different host to the API. */
    url: string;
    /** Must be echoed back verbatim on the upload PUT — the signature covers them. */
    headers: Record<string, string>;
  };
}

/** A file to upload, already resolved to bytes by the caller. */
export interface FileUpload {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}
