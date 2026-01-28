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
  assignees?: FizzyUser[];
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

export interface FizzyComment {
  id: string;
  body: string;
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
  description: string;
  completed: boolean;
  completed_at?: string;
  creator: FizzyUser;
  created_at: string;
}

// Request types
export interface CreateCardRequest {
  title: string;
  description?: string;
  status?: "draft" | "published";
  column_id?: string;
  assignee_ids?: string[];
  tag_ids?: string[];
  due_on?: string;
}

export interface UpdateCardRequest {
  title?: string;
  description?: string;
  status?: "draft" | "published" | "archived";
  column_id?: string;
  assignee_ids?: string[];
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
  description: string;
}

export interface UpdateStepRequest {
  description?: string;
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

// API Response types
export interface PaginatedResponse<T> {
  data: T[];
  nextPageUrl?: string;
}

// Identity - Response from GET /my/identity
// Note: User info is embedded in accounts[].user, not at the top level
export interface FizzyIdentity {
  accounts: FizzyAccount[];
}

// Card filtering options
export interface CardFilterOptions {
  [key: string]: string | string[] | undefined;
  indexed_by?: "all" | "closed" | "not_now" | "stalled" | "postponing_soon" | "golden";
  status?: "draft" | "published" | "archived";
  column_id?: string;
  assignee_ids?: string[];
  tag_ids?: string[];
  due_before?: string;
  due_after?: string;
  search?: string;
}
