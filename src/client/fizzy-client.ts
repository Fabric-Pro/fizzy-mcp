/**
 * Fizzy API Client
 * HTTP client wrapper for interacting with Fizzy's REST API
 */

import type {
  FizzyIdentity,
  FizzyAccount,
  FizzyBoard,
  FizzyCard,
  FizzyColumn,
  FizzyTag,
  FizzyUser,
  FizzyComment,
  FizzyNotification,
  FizzyReaction,
  FizzyStep,
  CreateCardRequest,
  UpdateCardRequest,
  CreateBoardRequest,
  UpdateBoardRequest,
  CreateColumnRequest,
  UpdateColumnRequest,
  CreateCommentRequest,
  UpdateCommentRequest,
  UpdateUserRequest,
  CreateStepRequest,
  UpdateStepRequest,
  CardFilterOptions,
} from "./types.js";
import {
  createAPIError,
  FizzyNetworkError,
  FizzyTimeoutError,
  FizzyParseError,
  FizzyRateLimitError,
  isRetryableError,
} from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { ETagCache } from "../utils/etag-cache.js";

export interface FizzyClientConfig {
  accessToken: string;
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  retryBaseDelay?: number;
  /** Enable ETag caching for GET requests (default: true) */
  enableCache?: boolean;
  /** Maximum age for cached responses in ms (default: 1 hour) */
  cacheMaxAge?: number;
}

export class FizzyClient {
  private accessToken: string;
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;
  private retryBaseDelay: number;
  private log = logger.child("client");
  private requestCounter = 0;
  private cache: ETagCache | null;

  constructor(config: FizzyClientConfig) {
    this.accessToken = config.accessToken;
    this.baseUrl = config.baseUrl || "https://app.fizzy.do";
    this.timeout = config.timeout ?? 30000;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseDelay = config.retryBaseDelay ?? 1000;
    
    // Initialize ETag cache if enabled (default: true)
    this.cache = (config.enableCache ?? true)
      ? new ETagCache({ maxAge: config.cacheMaxAge ?? 60 * 60 * 1000 })
      : null;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxEntries: number; oldestEntry: number | null } | null {
    return this.cache?.getStats() ?? null;
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache?.clear();
  }

  /**
   * Invalidate cache for URLs matching a prefix
   */
  invalidateCachePrefix(prefix: string): void {
    this.cache?.invalidatePrefix(prefix);
  }

  /**
   * Invalidate related cache entries after a mutation (POST/PUT/DELETE)
   * Uses URL patterns to determine what to invalidate
   */
  private invalidateCacheForMutation(mutationUrl: string): void {
    if (!this.cache) return;

    // Extract the base path to invalidate related list endpoints
    // e.g., /123/cards/456 -> invalidate /123/cards
    const parts = mutationUrl.replace(this.baseUrl, "").split("/");
    
    // Invalidate parent collection
    if (parts.length >= 3) {
      // Remove the specific resource ID to get the collection
      const collectionPath = parts.slice(0, -1).join("/");
      this.cache.invalidatePrefix(this.baseUrl + collectionPath);
    }

    // Also invalidate the specific resource
    this.cache.invalidate(mutationUrl);
  }

  /**
   * Generate a unique request ID for tracing
   */
  private generateRequestId(): string {
    this.requestCounter++;
    const timestamp = Date.now().toString(36);
    const counter = this.requestCounter.toString(36).padStart(4, "0");
    return `req_${timestamp}_${counter}`;
  }

  /**
   * Normalize account slug by removing leading slash if present.
   * The Fizzy API returns slugs like "/6117483" but API paths need "6117483"
   */
  private normalizeSlug(slug: string): string {
    return slug.startsWith("/") ? slug.slice(1) : slug;
  }

  /**
   * Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Calculate delay for exponential backoff with jitter
   */
  private getRetryDelay(attempt: number): number {
    const exponentialDelay = this.retryBaseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 1000;
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  }

  /**
   * Make an HTTP request with timeout, retry, and error handling
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const requestId = this.generateRequestId();
    let lastError: Error | undefined;

    this.log.debug(`[${requestId}] Starting request`, { method, path });

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.executeRequest<T>(method, url, body, requestId);
        this.log.debug(`[${requestId}] Request completed successfully`);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if we should retry
        if (attempt < this.maxRetries && isRetryableError(error)) {
          let delay = this.getRetryDelay(attempt);
          
          // Handle rate limit retry-after header
          if (error instanceof FizzyRateLimitError && error.retryAfter) {
            delay = error.retryAfter * 1000;
            this.log.warn(`[${requestId}] Rate limited. Retrying after ${error.retryAfter}s`, {
              attempt: attempt + 1,
              maxRetries: this.maxRetries,
            });
          } else {
            this.log.warn(`[${requestId}] Request failed, retrying in ${Math.round(delay)}ms`, {
              attempt: attempt + 1,
              maxRetries: this.maxRetries,
              error: lastError.message,
            });
          }
          await this.sleep(delay);
          continue;
        }

        // Not retryable, throw immediately
        this.log.error(`[${requestId}] Request failed permanently`, error);
        throw error;
      }
    }

    // All retries exhausted
    this.log.error(`[${requestId}] All retries exhausted`, lastError);
    throw lastError;
  }

  /**
   * Execute a single HTTP request with timeout and ETag caching
   */
  private async executeRequest<T>(
    method: string,
    url: string,
    body?: unknown,
    requestId?: string
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: "application/json",
    };

    // Add request ID header for server-side tracing if supported
    if (requestId) {
      headers["X-Request-ID"] = requestId;
    }

    if (body && method !== "GET") {
      headers["Content-Type"] = "application/json";
    }

    // For GET requests, check for cached ETag and add If-None-Match header
    // See: https://github.com/basecamp/fizzy/blob/main/docs/API.md#caching
    const isGetRequest = method === "GET";
    if (isGetRequest && this.cache) {
      const cachedETag = this.cache.getETag(url);
      if (cachedETag) {
        headers["If-None-Match"] = cachedETag;
      }
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    const logPrefix = requestId ? `[${requestId}] ` : "";
    this.log.debug(`${logPrefix}${method} ${url}`, { 
      hasBody: !!body,
      hasCachedETag: isGetRequest && !!headers["If-None-Match"],
    });

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 304 Not Modified - return cached data
      if (response.status === 304 && this.cache) {
        const cachedData = this.cache.get(url);
        if (cachedData !== undefined) {
          this.log.debug(`${logPrefix}Cache hit (304 Not Modified): ${url}`);
          return cachedData as T;
        }
        // Cache miss despite 304 - shouldn't happen, but fetch fresh data
        this.log.warn(`${logPrefix}304 received but no cached data for: ${url}`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        
        // Special handling for 429 to parse Retry-After header
        if (response.status === 429) {
          const retryAfterHeader = response.headers.get("Retry-After");
          throw FizzyRateLimitError.fromRetryAfterHeader(retryAfterHeader);
        }
        
        throw createAPIError(response.status, response.statusText, errorText);
      }

      // Handle 204 No Content
      if (response.status === 204) {
        // Invalidate related caches on mutations
        if (!isGetRequest && this.cache) {
          this.invalidateCacheForMutation(url);
        }
        return undefined as T;
      }

      // Parse JSON response
      let data: T;
      try {
        data = (await response.json()) as T;
      } catch (parseError) {
        // Handle 201 Created with empty body (Fizzy returns Location header only)
        if (response.status === 201) {
          const location = response.headers?.get?.("Location");
          if (location) {
            // Extract ID from Location URL (e.g., /123/boards/abc.json -> abc)
            let id = location.split("/").pop() || "";
            // Remove .json suffix if present
            if (id.endsWith(".json")) {
              id = id.slice(0, -5);
            }
            if (this.cache) {
              this.invalidateCacheForMutation(url);
            }
            return { id, url: location } as T;
          }
          return undefined as T;
        }
        throw new FizzyParseError(
          "Failed to parse API response as JSON",
          parseError instanceof Error ? parseError : undefined
        );
      }

      // Cache the response if ETag is present (for GET requests)
      if (isGetRequest && this.cache && response.headers) {
        const etag = response.headers.get("ETag");
        if (etag) {
          this.cache.set(url, etag, data);
          this.log.debug(`${logPrefix}Cached response with ETag: ${etag}`);
        }
      }

      // Invalidate related caches on mutations
      if (!isGetRequest && this.cache) {
        this.invalidateCacheForMutation(url);
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle abort (timeout)
      if (error instanceof Error && error.name === "AbortError") {
        throw new FizzyTimeoutError(
          `Request timed out after ${this.timeout}ms`,
          this.timeout
        );
      }

      // Handle network errors
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new FizzyNetworkError(
          `Network error: ${error.message}`,
          error
        );
      }

      // Re-throw our custom errors
      throw error;
    }
  }

  private buildQueryString(params: Record<string, unknown>): string {
    const searchParams = new URLSearchParams();
    const entries = Object.entries(params) as [string, unknown][];

    for (const [key, value] of entries) {
      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        for (const item of value) {
          searchParams.append(`${key}[]`, String(item));
        }
      } else {
        searchParams.append(key, String(value));
      }
    }

    const queryString = searchParams.toString();
    return queryString ? `?${queryString}` : "";
  }

  // ============ Identity ============

  /**
   * Get current user identity
   * @endpoint GET /my/identity
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-myidentity
   */
  async getIdentity(): Promise<FizzyIdentity> {
    return this.request<FizzyIdentity>("GET", "/my/identity");
  }

  // ============ Accounts ============

  /**
   * Get all accounts for the current user
   * @endpoint GET /my/identity (accounts extracted from response)
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-myidentity
   */
  async getAccounts(): Promise<FizzyAccount[]> {
    // Accounts are embedded in the identity response
    const identity = await this.getIdentity();
    return identity.accounts || [];
  }

  // ============ Boards ============

  /**
   * Get all boards in an account
   * @endpoint GET /:account_slug/boards
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugboards
   */
  async getBoards(accountSlug: string): Promise<FizzyBoard[]> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyBoard[]>("GET", `/${slug}/boards`);
  }

  /**
   * Get a specific board
   * @endpoint GET /:account_slug/boards/:board_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugboardsboard_id
   */
  async getBoard(accountSlug: string, boardId: string): Promise<FizzyBoard> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyBoard>("GET", `/${slug}/boards/${boardId}`);
  }

  /**
   * Create a new board
   * @endpoint POST /:account_slug/boards
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#post-account_slugboards
   */
  async createBoard(
    accountSlug: string,
    data: CreateBoardRequest
  ): Promise<FizzyBoard> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyBoard>("POST", `/${slug}/boards`, {
      board: data,
    });
  }

  /**
   * Update a board
   * @endpoint PUT /:account_slug/boards/:board_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#put-account_slugboardsboard_id
   */
  async updateBoard(
    accountSlug: string,
    boardId: string,
    data: UpdateBoardRequest
  ): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>("PUT", `/${slug}/boards/${boardId}`, {
      board: data,
    });
  }

  /**
   * Delete a board
   * @endpoint DELETE /:account_slug/boards/:board_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#delete-account_slugboardsboard_id
   */
  async deleteBoard(accountSlug: string, boardId: string): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>("DELETE", `/${slug}/boards/${boardId}`);
  }

  // ============ Cards ============

  /**
   * Get all cards in an account with optional filters
   * @endpoint GET /:account_slug/cards
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugcards
   */
  async getCards(
    accountSlug: string,
    filters?: CardFilterOptions
  ): Promise<FizzyCard[]> {
    const slug = this.normalizeSlug(accountSlug);
    const queryString = filters ? this.buildQueryString(filters) : "";
    return this.request<FizzyCard[]>(
      "GET",
      `/${slug}/cards${queryString}`
    );
  }

  /**
   * Get a specific card
   * @endpoint GET /:account_slug/cards/:card_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugcardscard_id
   */
  async getCard(accountSlug: string, cardId: string): Promise<FizzyCard> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyCard>("GET", `/${slug}/cards/${cardId}`);
  }

  /**
   * Create a new card on a board
   * @endpoint POST /:account_slug/boards/:board_id/cards
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#post-account_slugboardsboard_idcards
   */
  async createCard(
    accountSlug: string,
    boardId: string,
    data: CreateCardRequest
  ): Promise<FizzyCard> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyCard>(
      "POST",
      `/${slug}/boards/${boardId}/cards`,
      { card: data }
    );
  }

  /**
   * Update a card
   * @endpoint PUT /:account_slug/cards/:card_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#put-account_slugcardscard_id
   */
  async updateCard(
    accountSlug: string,
    cardId: string,
    data: UpdateCardRequest
  ): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>("PUT", `/${slug}/cards/${cardId}`, {
      card: data,
    });
  }

  /**
   * Delete a card
   * @endpoint DELETE /:account_slug/cards/:card_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#delete-account_slugcardscard_id
   */
  async deleteCard(accountSlug: string, cardId: string): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>("DELETE", `/${slug}/cards/${cardId}`);
  }

  // ============ Card Actions ============

  /**
   * Close a card (mark as complete)
   * @endpoint POST /:account_slug/cards/:card_number/closure
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#post-account_slugcardscard_numberclosure
   */
  async closeCard(accountSlug: string, cardNumber: string): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>("POST", `/${slug}/cards/${cardNumber}/closure`);
  }

  /**
   * Reopen a closed card
   * @endpoint DELETE /:account_slug/cards/:card_number/closure
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#delete-account_slugcardscard_numberclosure
   */
  async reopenCard(accountSlug: string, cardNumber: string): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>("DELETE", `/${slug}/cards/${cardNumber}/closure`);
  }

  /**
   * Move a card to "Not Now" (backlog)
   * @endpoint POST /:account_slug/cards/:card_number/not_now
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#post-account_slugcardscard_numbernot_now
   */
  async moveCardToNotNow(accountSlug: string, cardNumber: string): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>("POST", `/${slug}/cards/${cardNumber}/not_now`);
  }

  /**
   * Move a card to a specific column
   * @endpoint POST /:account_slug/cards/:card_number/triage
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#post-account_slugcardscard_numbertriage
   */
  async moveCardToColumn(
    accountSlug: string,
    cardNumber: string,
    columnId: string
  ): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>(
      "POST",
      `/${slug}/cards/${cardNumber}/triage`,
      { column_id: columnId }
    );
  }

  /**
   * Send a card back to triage (remove from column)
   * @endpoint DELETE /:account_slug/cards/:card_number/triage
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#delete-account_slugcardscard_numbertriage
   */
  async sendCardToTriage(accountSlug: string, cardNumber: string): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>("DELETE", `/${slug}/cards/${cardNumber}/triage`);
  }

  /**
   * Toggle a tag on a card (add if not present, remove if present)
   * If the tag doesn't exist, it will be created.
   * @endpoint POST /:account_slug/cards/:card_number/taggings
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#post-account_slugcardscard_numbertaggings
   */
  async toggleCardTag(
    accountSlug: string,
    cardNumber: string,
    tagTitle: string
  ): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>(
      "POST",
      `/${slug}/cards/${cardNumber}/taggings`,
      { tag_title: tagTitle }
    );
  }

  /**
   * Toggle assignment of a user to a card
   * @endpoint POST /:account_slug/cards/:card_number/assignments
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#post-account_slugcardscard_numberassignments
   */
  async toggleCardAssignment(
    accountSlug: string,
    cardNumber: string,
    assigneeId: string
  ): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>(
      "POST",
      `/${slug}/cards/${cardNumber}/assignments`,
      { assignee_id: assigneeId }
    );
  }

  /**
   * Watch a card for notifications
   * @endpoint POST /:account_slug/cards/:card_number/watch
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#post-account_slugcardscard_numberwatch
   */
  async watchCard(accountSlug: string, cardNumber: string): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>("POST", `/${slug}/cards/${cardNumber}/watch`);
  }

  /**
   * Unwatch a card (stop receiving notifications)
   * @endpoint DELETE /:account_slug/cards/:card_number/watch
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#delete-account_slugcardscard_numberwatch
   */
  async unwatchCard(accountSlug: string, cardNumber: string): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>("DELETE", `/${slug}/cards/${cardNumber}/watch`);
  }

  // ============ Comments ============

  /**
   * Get all comments on a card
   * @endpoint GET /:account_slug/cards/:card_id/comments
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugcardscard_idcomments
   */
  async getCardComments(
    accountSlug: string,
    cardId: string
  ): Promise<FizzyComment[]> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyComment[]>(
      "GET",
      `/${slug}/cards/${cardId}/comments`
    );
  }

  /**
   * Create a comment on a card
   * @endpoint POST /:account_slug/cards/:card_id/comments
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#post-account_slugcardscard_idcomments
   */
  async createCardComment(
    accountSlug: string,
    cardId: string,
    data: CreateCommentRequest
  ): Promise<FizzyComment> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyComment>(
      "POST",
      `/${slug}/cards/${cardId}/comments`,
      { comment: data }
    );
  }

  /**
   * Get a specific comment
   * @endpoint GET /:account_slug/cards/:card_number/comments/:comment_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugcardscard_numbercommentscomment_id
   */
  async getComment(
    accountSlug: string,
    cardNumber: string,
    commentId: string
  ): Promise<FizzyComment> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyComment>(
      "GET",
      `/${slug}/cards/${cardNumber}/comments/${commentId}`
    );
  }

  /**
   * Update a comment
   * @endpoint PUT /:account_slug/cards/:card_number/comments/:comment_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#put-account_slugcardscard_numbercommentscomment_id
   */
  async updateComment(
    accountSlug: string,
    cardNumber: string,
    commentId: string,
    data: UpdateCommentRequest
  ): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>(
      "PUT",
      `/${slug}/cards/${cardNumber}/comments/${commentId}`,
      { comment: data }
    );
  }

  /**
   * Delete a comment
   * @endpoint DELETE /:account_slug/cards/:card_number/comments/:comment_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#delete-account_slugcardscard_numbercommentscomment_id
   */
  async deleteComment(
    accountSlug: string,
    cardNumber: string,
    commentId: string
  ): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>(
      "DELETE",
      `/${slug}/cards/${cardNumber}/comments/${commentId}`
    );
  }

  // ============ Reactions ============

  /**
   * Get all reactions on a comment
   * @endpoint GET /:account_slug/cards/:card_number/comments/:comment_id/reactions
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugcardscard_numbercommentscomment_idreactions
   */
  async getReactions(
    accountSlug: string,
    cardNumber: string,
    commentId: string
  ): Promise<FizzyReaction[]> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyReaction[]>(
      "GET",
      `/${slug}/cards/${cardNumber}/comments/${commentId}/reactions`
    );
  }

  /**
   * Add a reaction to a comment
   * @endpoint POST /:account_slug/cards/:card_number/comments/:comment_id/reactions
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#post-account_slugcardscard_numbercommentscomment_idreactions
   */
  async addReaction(
    accountSlug: string,
    cardNumber: string,
    commentId: string,
    content: string
  ): Promise<FizzyReaction> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyReaction>(
      "POST",
      `/${slug}/cards/${cardNumber}/comments/${commentId}/reactions`,
      { reaction: { content } }
    );
  }

  /**
   * Remove a reaction from a comment
   * @endpoint DELETE /:account_slug/cards/:card_number/comments/:comment_id/reactions/:reaction_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#delete-account_slugcardscard_numbercommentscomment_idreactionsreaction_id
   */
  async removeReaction(
    accountSlug: string,
    cardNumber: string,
    commentId: string,
    reactionId: string
  ): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>(
      "DELETE",
      `/${slug}/cards/${cardNumber}/comments/${commentId}/reactions/${reactionId}`
    );
  }

  // ============ Steps (To-dos) ============

  /**
   * Get a specific step on a card
   * @endpoint GET /:account_slug/cards/:card_number/steps/:step_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugcardscard_numberstepsstep_id
   */
  async getStep(
    accountSlug: string,
    cardNumber: string,
    stepId: string
  ): Promise<FizzyStep> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyStep>(
      "GET",
      `/${slug}/cards/${cardNumber}/steps/${stepId}`
    );
  }

  /**
   * Create a step (to-do) on a card
   * @endpoint POST /:account_slug/cards/:card_number/steps
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#post-account_slugcardscard_numbersteps
   */
  async createStep(
    accountSlug: string,
    cardNumber: string,
    data: CreateStepRequest
  ): Promise<FizzyStep> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyStep>(
      "POST",
      `/${slug}/cards/${cardNumber}/steps`,
      { step: data }
    );
  }

  /**
   * Update a step
   * @endpoint PUT /:account_slug/cards/:card_number/steps/:step_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#put-account_slugcardscard_numberstepsstep_id
   */
  async updateStep(
    accountSlug: string,
    cardNumber: string,
    stepId: string,
    data: UpdateStepRequest
  ): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>(
      "PUT",
      `/${slug}/cards/${cardNumber}/steps/${stepId}`,
      { step: data }
    );
  }

  /**
   * Delete a step
   * @endpoint DELETE /:account_slug/cards/:card_number/steps/:step_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#delete-account_slugcardscard_numberstepsstep_id
   */
  async deleteStep(
    accountSlug: string,
    cardNumber: string,
    stepId: string
  ): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>(
      "DELETE",
      `/${slug}/cards/${cardNumber}/steps/${stepId}`
    );
  }

  // ============ Columns ============

  /**
   * Get all columns on a board
   * @endpoint GET /:account_slug/boards/:board_id/columns
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugboardsboard_idcolumns
   */
  async getColumns(
    accountSlug: string,
    boardId: string
  ): Promise<FizzyColumn[]> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyColumn[]>(
      "GET",
      `/${slug}/boards/${boardId}/columns`
    );
  }

  /**
   * Get a specific column
   * @endpoint GET /:account_slug/boards/:board_id/columns/:column_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugboardsboard_idcolumnscolumn_id
   */
  async getColumn(
    accountSlug: string,
    boardId: string,
    columnId: string
  ): Promise<FizzyColumn> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyColumn>(
      "GET",
      `/${slug}/boards/${boardId}/columns/${columnId}`
    );
  }

  /**
   * Create a column on a board
   * @endpoint POST /:account_slug/boards/:board_id/columns
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#post-account_slugboardsboard_idcolumns
   */
  async createColumn(
    accountSlug: string,
    boardId: string,
    data: CreateColumnRequest
  ): Promise<FizzyColumn> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyColumn>(
      "POST",
      `/${slug}/boards/${boardId}/columns`,
      { column: data }
    );
  }

  /**
   * Update a column
   * @endpoint PUT /:account_slug/boards/:board_id/columns/:column_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#put-account_slugboardsboard_idcolumnscolumn_id
   */
  async updateColumn(
    accountSlug: string,
    boardId: string,
    columnId: string,
    data: UpdateColumnRequest
  ): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>(
      "PUT",
      `/${slug}/boards/${boardId}/columns/${columnId}`,
      { column: data }
    );
  }

  /**
   * Delete a column
   * @endpoint DELETE /:account_slug/boards/:board_id/columns/:column_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#delete-account_slugboardsboard_idcolumnscolumn_id
   */
  async deleteColumn(
    accountSlug: string,
    boardId: string,
    columnId: string
  ): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>(
      "DELETE",
      `/${slug}/boards/${boardId}/columns/${columnId}`
    );
  }

  // ============ Tags ============

  /**
   * Get all tags in an account
   * @endpoint GET /:account_slug/tags
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugtags
   */
  async getTags(accountSlug: string): Promise<FizzyTag[]> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyTag[]>("GET", `/${slug}/tags`);
  }

  // Note: POST/DELETE /:account_slug/tags endpoints return 404
  // Tag creation/deletion is not available via API

  // ============ Users ============

  /**
   * Get all active users in an account
   * @endpoint GET /:account_slug/users
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugusers
   */
  async getUsers(accountSlug: string): Promise<FizzyUser[]> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyUser[]>("GET", `/${slug}/users`);
  }

  /**
   * Get a specific user
   * @endpoint GET /:account_slug/users/:user_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugusersuser_id
   */
  async getUser(accountSlug: string, userId: string): Promise<FizzyUser> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyUser>("GET", `/${slug}/users/${userId}`);
  }

  /**
   * Update a user
   * @endpoint PUT /:account_slug/users/:user_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#put-account_slugusersuser_id
   */
  async updateUser(
    accountSlug: string,
    userId: string,
    data: UpdateUserRequest
  ): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>("PUT", `/${slug}/users/${userId}`, {
      user: data,
    });
  }

  /**
   * Deactivate a user
   * @endpoint DELETE /:account_slug/users/:user_id
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#delete-account_slugusersuser_id
   */
  async deactivateUser(accountSlug: string, userId: string): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>("DELETE", `/${slug}/users/${userId}`);
  }

  // ============ Notifications ============

  /**
   * Get all notifications for the current user
   * @endpoint GET /:account_slug/notifications
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugnotifications
   */
  async getNotifications(accountSlug: string): Promise<FizzyNotification[]> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyNotification[]>(
      "GET",
      `/${slug}/notifications`
    );
  }

  /**
   * Mark a notification as read
   * @endpoint POST /:account_slug/notifications/:notification_id/reading
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#post-account_slugnotificationsnotification_idreading
   */
  async markNotificationAsRead(
    accountSlug: string,
    notificationId: string
  ): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>(
      "POST",
      `/${slug}/notifications/${notificationId}/reading`
    );
  }

  /**
   * Mark a notification as unread
   * @endpoint DELETE /:account_slug/notifications/:notification_id/reading
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#delete-account_slugnotificationsnotification_idreading
   */
  async markNotificationAsUnread(
    accountSlug: string,
    notificationId: string
  ): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>(
      "DELETE",
      `/${slug}/notifications/${notificationId}/reading`
    );
  }

  /**
   * Mark all notifications as read
   * @endpoint POST /:account_slug/notifications/bulk_reading
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#post-account_slugnotificationsbulk_reading
   */
  async markAllNotificationsAsRead(accountSlug: string): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>(
      "POST",
      `/${slug}/notifications/bulk_reading`
    );
  }
}
