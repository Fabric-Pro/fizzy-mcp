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
  CardListOptions,
  CardsPage,
  NotificationListOptions,
  DirectUploadBlobRequest,
  FizzyDirectUpload,
  FileUpload,
  AttachmentRef,
  FetchAttachmentOptions,
  FetchedAttachment,
} from "./types.js";
import {
  createAPIError,
  FizzyAttachmentTooLargeError,
  FizzyAuthError,
  FizzyNetworkError,
  FizzyTimeoutError,
  FizzyParseError,
  FizzyRateLimitError,
  isRetryableError,
} from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { ETagCache } from "../utils/etag-cache.js";
import { md5Base64 } from "../utils/md5.js";

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
  /**
   * Maximum total size across all cached responses (default: 8388608 / 8MB),
   * measured as JSON source length in UTF-16 code units — not UTF-8 wire
   * bytes, and not the retained heap size of the parsed response. Forwarded
   * to `ETagCache`'s `maxBytes`; see `ETagCacheOptions.maxBytes` for why
   * that's a deliberately simple sizing proxy rather than a hard memory bound.
   */
  cacheMaxBytes?: number;
  /**
   * Maximum size for a single cached response; larger responses are not
   * cached (default: 262144 / 256KB). Same UTF-16-code-unit measurement as
   * `cacheMaxBytes` — see `ETagCacheOptions.maxEntryBytes`.
   */
  cacheMaxEntryBytes?: number;
}

export class FizzyClient {
  /**
   * Hard stop for {@link requestAllPages}.
   *
   * With upstream's geared page sizes (15, 30, 50, then 100) twenty pages is
   * 1,795 items — far more than any of the aggregated collections holds in
   * practice, and small enough to stay well inside the Cloudflare Workers
   * per-invocation subrequest limit, which a single tool call shares with
   * everything else it does. The cap exists because upstream keeps advertising
   * rel="next" past the end of a collection: without it a server that never
   * stops saying "next" turns one tool call into an unbounded request loop.
   */
  private static readonly MAX_AGGREGATED_PAGES = 20;

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
      ? new ETagCache({
          maxAge: config.cacheMaxAge ?? 60 * 60 * 1000,
          maxBytes: config.cacheMaxBytes,
          maxEntryBytes: config.cacheMaxEntryBytes,
        })
      : null;
  }

  /**
   * The API origin this client is configured against.
   *
   * Exposed because the rich-text fields the tools return carry
   * account-scoped *paths*, and turning those into usable URLs must resolve
   * against the configured host rather than a hardcoded one — a self-hosted or
   * staging Fizzy has to resolve against itself.
   */
  getBaseUrl(): string {
    return this.baseUrl;
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
   * The Fizzy API returns slugs like "/123456" but API paths need "123456"
   */
  private normalizeSlug(slug: string): string {
    if (!slug) {
      throw new Error("Account slug is required");
    }
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
    const { data } = await this.requestWithMeta<T>(method, path, body);
    return data;
  }

  /**
   * Same as `request`, but also returns metadata derived from the response by
   * `extractMeta` (e.g. pagination headers). Shares the retry/backoff loop.
   */
  private async requestWithMeta<T>(
    method: string,
    path: string,
    body?: unknown,
    extractMeta?: (response: Response) => unknown
  ): Promise<{ data: T; meta: unknown }> {
    const url = `${this.baseUrl}${path}`;
    const requestId = this.generateRequestId();
    let lastError: Error | undefined;

    this.log.debug(`[${requestId}] Starting request`, { method, path });

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.executeRequestWithMeta<T>(
          method,
          url,
          body,
          requestId,
          extractMeta
        );
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
   * Execute a single HTTP request with timeout and ETag caching.
   *
   * `extractMeta` runs on exactly two paths: a fresh response whose JSON body
   * parsed successfully, and a 304. It never runs on 204, on the 201-Location
   * fallback, or on any error path (those throw first) — which is what keeps it
   * away from the error bodies of attempts that are about to be retried.
   */
  private async executeRequestWithMeta<T>(
    method: string,
    url: string,
    body?: unknown,
    requestId?: string,
    extractMeta?: (response: Response) => unknown
  ): Promise<{ data: T; meta: unknown }> {
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
        const cachedEntry = this.cache.getEntry(url);
        if (cachedEntry) {
          this.log.debug(`${logPrefix}Cache hit (304 Not Modified): ${url}`);
          // Rails still runs the action on a conditional GET, so a 304 carries
          // fresh response headers (only the body is stripped). Prefer those;
          // fall back to the meta captured when the body was cached.
          return {
            data: cachedEntry.data as T,
            meta: extractMeta?.(response) ?? cachedEntry.meta,
          };
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
        if (!isGetRequest && this.cache) {
          // Invalidate related caches on mutations
          this.invalidateCacheForMutation(url);
        } else if (isGetRequest && this.cache) {
          // A GET that comes back 204 carries no ETag either, so any
          // previously cached representation for this exact URL is now
          // stale — same reasoning as the no-ETag branch below in the 200
          // path, just reached via a different response shape.
          this.cache.invalidate(url);
        }
        return { data: undefined as T, meta: undefined };
      }

      // Parse JSON response
      let data: T;
      // Prefer text() so the cache can bound itself by the JSON source's length
      // (in UTF-16 code units — a proxy for actual body size, not an exact byte
      // count; see ETagCacheOptions.maxBytes for why that's an acceptable
      // trade-off). response.json() materialises the same string internally, so
      // this costs nothing extra in production. Partial mocks in the test suite
      // only define json(), hence the capability check — same defensive posture
      // as the header access in parsePaginationMeta().
      let rawLength: number | undefined;
      try {
        if (typeof response.text === "function") {
          const raw = await response.text();
          rawLength = raw.length;
          data = JSON.parse(raw) as T;
        } else {
          data = (await response.json()) as T;
        }
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
            return { data: { id, url: location } as T, meta: undefined };
          }
          return { data: undefined as T, meta: undefined };
        }
        throw new FizzyParseError(
          "Failed to parse API response as JSON",
          parseError instanceof Error ? parseError : undefined
        );
      }

      // Single extraction path for response metadata: computed here, once, from a
      // fresh response with a parsed body, then stored alongside it in the cache.
      const meta = extractMeta?.(response);

      // Cache the response if ETag is present (for GET requests)
      if (isGetRequest && this.cache && response.headers) {
        const etag = response.headers.get("ETag");
        if (etag) {
          this.cache.set(url, etag, data, meta, rawLength);
          this.log.debug(`${logPrefix}Cached response with ETag: ${etag}`);
        } else {
          // A successful GET with no ETag can't be cached going forward, but
          // it can still be *fresher* than whatever's already cached for this
          // URL. Without this, a prior ETagged entry would survive untouched
          // and we'd keep sending its (now stale) If-None-Match on every
          // later request for a resource that no longer emits ETags.
          this.cache.invalidate(url);
        }
      }

      // Invalidate related caches on mutations
      if (!isGetRequest && this.cache) {
        this.invalidateCacheForMutation(url);
      }

      return { data, meta };
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

  /**
   * Fetch every page of a paginated list endpoint and concatenate them.
   *
   * Page 1 is requested with `basePath` untouched — no `page` param — so a
   * single-page collection produces exactly the request the client made before
   * pagination was followed at all, and an endpoint that turns out not to be
   * paginated (no headers) still costs one request.
   *
   * Walking stops at the first of: a page with no rel="next" link, an empty
   * page (upstream advertises a next link past the end of a collection, so the
   * link alone is not a reliable terminator), or
   * {@link FizzyClient.MAX_AGGREGATED_PAGES}. Hitting the cap is logged and
   * returns what was collected rather than throwing: a truncated list is worth
   * more to the caller than an error, and the warning is what makes the
   * truncation visible.
   */
  private async requestAllPages<T>(basePath: string): Promise<T[]> {
    const collected: T[] = [];

    for (let page = 1; ; page++) {
      const path =
        page === 1
          ? basePath
          : `${basePath}${basePath.includes("?") ? "&" : "?"}page=${page}`;

      const { data, meta } = await this.requestWithMeta<T[]>(
        "GET",
        path,
        undefined,
        (response) => this.parsePaginationMeta(response)
      );

      const items = Array.isArray(data) ? data : [];
      for (const item of items) collected.push(item);

      // No metadata at all means the response carried no pagination headers,
      // which is the same signal `getCards` treats as "there is no page 2".
      const pagination = meta as
        | { totalCount: number | null; hasMore: boolean }
        | undefined;
      if (!pagination?.hasMore || items.length === 0) return collected;

      if (page >= FizzyClient.MAX_AGGREGATED_PAGES) {
        this.log.warn(
          `Stopped at the ${FizzyClient.MAX_AGGREGATED_PAGES}-page cap for ${basePath}; ` +
            `returning ${collected.length} items, which may be incomplete`
        );
        return collected;
      }
    }
  }

  /**
   * Read geared_pagination metadata off a list response.
   *
   * Returns undefined when neither header is present, which is the signal the
   * 304 path uses to fall back to the metadata cached with the body.
   */
  private parsePaginationMeta(
    response: Response
  ): { totalCount: number | null; hasMore: boolean } | undefined {
    // Defensive header access: mocked/partial responses may omit `headers` entirely.
    const totalCountHeader = response.headers?.get?.("X-Total-Count") ?? null;
    const linkHeader = response.headers?.get?.("Link") ?? null;

    if (totalCountHeader === null && linkHeader === null) {
      return undefined;
    }

    const trimmedTotal = totalCountHeader === null ? null : totalCountHeader.trim();
    const totalCount =
      trimmedTotal !== null && /^[0-9]+$/.test(trimmedTotal) && Number.isSafeInteger(Number(trimmedTotal))
        ? Number(trimmedTotal)
        : null;

    // Upstream emits rel="next" on every page but the last.
    const hasMore = linkHeader !== null && this.linkHeaderHasNextRel(linkHeader);

    return { totalCount, hasMore };
  }

  /**
   * Split on a separator that only counts at top level — i.e. outside RFC 8288
   * quoted-strings (which may contain the separator, with \-escapes) and outside
   * <URL> brackets.
   */
  private static splitTopLevel(input: string, separator: string): string[] {
    const parts: string[] = [];
    let current = "";
    let inQuotes = false;
    let inAngle = false;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (inQuotes) {
        if (ch === "\\" && i + 1 < input.length) {
          current += ch + input[i + 1];
          i++;
          continue;
        }
        if (ch === '"') inQuotes = false;
        current += ch;
      } else if (ch === '"') {
        inQuotes = true;
        current += ch;
      } else if (ch === "<" && !inAngle) {
        inAngle = true;
        current += ch;
      } else if (ch === ">" && inAngle) {
        inAngle = false;
        current += ch;
      } else if (ch === separator && !inAngle) {
        parts.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    parts.push(current);
    return parts;
  }

  /**
   * True when an RFC 8288 Link header contains a link with relation type "next".
   * Quoted strings never split link-values or params, and per RFC 8288 only the
   * FIRST rel param of a link-value counts.
   */
  private linkHeaderHasNextRel(linkHeader: string): boolean {
    for (const linkValue of FizzyClient.splitTopLevel(linkHeader, ",")) {
      const urlEnd = linkValue.indexOf(">");
      if (!linkValue.trimStart().startsWith("<") || urlEnd === -1) continue;
      for (const param of FizzyClient.splitTopLevel(linkValue.slice(urlEnd + 1), ";")) {
        const eq = param.indexOf("=");
        if (eq === -1) continue;
        if (param.slice(0, eq).trim().toLowerCase() !== "rel") continue;
        // First rel wins (RFC 8288 §3.3); later rel params must be ignored.
        let value = param.slice(eq + 1).trim();
        if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
          value = value.slice(1, -1).replace(/\\(.)/g, "$1");
        }
        const isNext = value.toLowerCase().split(/\s+/).includes("next");
        if (isNext) return true;
        break;
      }
    }
    return false;
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
   * Get all boards in an account.
   *
   * The endpoint is paginated upstream, so every page is fetched and
   * concatenated — the result is the complete list, not the first page.
   * @endpoint GET /:account_slug/boards
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugboards
   */
  async getBoards(accountSlug: string): Promise<FizzyBoard[]> {
    const slug = this.normalizeSlug(accountSlug);
    return this.requestAllPages<FizzyBoard>(`/${slug}/boards`);
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
   * Get one page of cards in an account with optional filters.
   *
   * This endpoint is paginated with a server-controlled, variable page size, so
   * the result is a page envelope ({@link CardsPage}) rather than a bare array.
   * Pass `options.page` to walk further pages; nothing is aggregated here.
   * @endpoint GET /:account_slug/cards
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugcards
   */
  async getCards(
    accountSlug: string,
    options?: CardListOptions
  ): Promise<CardsPage> {
    const slug = this.normalizeSlug(accountSlug);
    const queryString = options ? this.buildQueryString(options) : "";
    const requestedPage = options?.page ?? 1;

    // The tool layer validates `page` separately; this defends direct client callers.
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
      throw new Error("page must be a positive integer (1-based)");
    }

    const { data, meta } = await this.requestWithMeta<FizzyCard[]>(
      "GET",
      `/${slug}/cards${queryString}`,
      undefined,
      (response) => this.parsePaginationMeta(response)
    );

    // With no pagination headers to go on we report has_more: false /
    // total_count: null rather than fabricating values.
    const pagination = meta as { totalCount: number | null; hasMore: boolean } | undefined;
    const hasMore = pagination?.hasMore ?? false;

    return {
      cards: data ?? [],
      page: requestedPage,
      total_count: pagination?.totalCount ?? null,
      has_more: hasMore,
      // Derived, not parsed out of the Link URL: offset portioning guarantees
      // sequential integer pages, so parsing would only add failure modes that
      // silently truncate iteration.
      next_page: hasMore ? requestedPage + 1 : null,
    };
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

  /**
   * Mark a card as golden (priority/important)
   * @endpoint POST /:account_slug/cards/:card_number/goldness
   */
  async gildCard(accountSlug: string, cardNumber: string): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>("POST", `/${slug}/cards/${cardNumber}/goldness`);
  }

  /**
   * Remove golden status from a card
   * @endpoint DELETE /:account_slug/cards/:card_number/goldness
   */
  async ungildCard(accountSlug: string, cardNumber: string): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>("DELETE", `/${slug}/cards/${cardNumber}/goldness`);
  }

  // ============ Pins ============

  /**
   * Pin a card for the current user
   * @endpoint POST /:account_slug/cards/:card_number/pin
   * @see https://github.com/basecamp/fizzy/blob/main/docs/api/sections/pins.md
   */
  async pinCard(accountSlug: string, cardNumber: string): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>("POST", `/${slug}/cards/${cardNumber}/pin`);
  }

  /**
   * Unpin a card for the current user
   * @endpoint DELETE /:account_slug/cards/:card_number/pin
   * @see https://github.com/basecamp/fizzy/blob/main/docs/api/sections/pins.md
   */
  async unpinCard(accountSlug: string, cardNumber: string): Promise<void> {
    const slug = this.normalizeSlug(accountSlug);
    await this.request<void>("DELETE", `/${slug}/cards/${cardNumber}/pin`);
  }

  /**
   * Get the current user's pinned cards for an account.
   *
   * Unlike {@link getCards} this endpoint is NOT paginated: the server returns
   * at most 100 pinned cards in a bare array, so there is no page envelope to
   * build and nothing to walk. Pins are per-user *and* per-account — the path
   * is account-scoped despite living under the `/my` namespace, because
   * My::PinsController (unlike My::IdentitiesController) does not declare
   * `disallow_account_scope`.
   * @endpoint GET /:account_slug/my/pins
   * @see https://github.com/basecamp/fizzy/blob/main/docs/api/sections/pins.md
   */
  async getPins(accountSlug: string): Promise<FizzyCard[]> {
    const slug = this.normalizeSlug(accountSlug);
    const cards = await this.request<FizzyCard[]>("GET", `/${slug}/my/pins`);
    return cards ?? [];
  }

  // ============ Comments ============

  /**
   * Get all comments on a card.
   *
   * The endpoint is paginated upstream, so every page is fetched and
   * concatenated — the result is the complete thread in chronological order,
   * not the first page of it.
   * @endpoint GET /:account_slug/cards/:card_number/comments
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugcardscard_numbercomments
   */
  async getCardComments(
    accountSlug: string,
    cardNumber: string
  ): Promise<FizzyComment[]> {
    const slug = this.normalizeSlug(accountSlug);
    return this.requestAllPages<FizzyComment>(
      `/${slug}/cards/${cardNumber}/comments`
    );
  }

  /**
   * Create a comment on a card
   * @endpoint POST /:account_slug/cards/:card_number/comments
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#post-account_slugcardscard_numbercomments
   */
  async createCardComment(
    accountSlug: string,
    cardNumber: string,
    data: CreateCommentRequest
  ): Promise<FizzyComment> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyComment>(
      "POST",
      `/${slug}/cards/${cardNumber}/comments`,
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
   * Get all tags in an account.
   *
   * The endpoint is paginated upstream, so every page is fetched and
   * concatenated — the result is the complete list, not the first page.
   * @endpoint GET /:account_slug/tags
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugtags
   */
  async getTags(accountSlug: string): Promise<FizzyTag[]> {
    const slug = this.normalizeSlug(accountSlug);
    return this.requestAllPages<FizzyTag>(`/${slug}/tags`);
  }

  // Note: POST/DELETE /:account_slug/tags endpoints return 404
  // Tag creation/deletion is not available via API

  // ============ Users ============

  /**
   * Get all active users in an account.
   *
   * The endpoint is paginated upstream, so every page is fetched and
   * concatenated — the result is the complete roster, not the first page.
   * @endpoint GET /:account_slug/users
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugusers
   */
  async getUsers(accountSlug: string): Promise<FizzyUser[]> {
    const slug = this.normalizeSlug(accountSlug);
    return this.requestAllPages<FizzyUser>(`/${slug}/users`);
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
   * Get one page of notifications for the current user.
   *
   * Deliberately NOT aggregated like the other lists, because this endpoint's
   * pages are not slices of one collection. `NotificationsController#index`
   * renders `(@unread || []) + @page.records`, and only populates `@unread`
   * (up to 100 unread notifications) when the request carries no `page` param.
   * So the page-less request returns unread items followed by the most recent
   * read ones, while any `?page=N` returns read notifications only. Read
   * notifications accumulate for the life of the account, which is why walking
   * every page here would be both unbounded and wrong.
   *
   * Omitting `page` — or passing 1 — issues the page-less request, exactly as
   * before. Pages 2 and up walk backwards through already-read history.
   * @endpoint GET /:account_slug/notifications
   * @see https://github.com/basecamp/fizzy/blob/main/docs/API.md#get-account_slugnotifications
   */
  async getNotifications(
    accountSlug: string,
    options?: NotificationListOptions
  ): Promise<FizzyNotification[]> {
    const slug = this.normalizeSlug(accountSlug);
    const requestedPage = options?.page ?? 1;

    // The tool layer validates `page` separately; this defends direct client
    // callers, the same way getCards does.
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
      throw new Error("page must be a positive integer (1-based)");
    }

    // Page 1 must stay page-less: `?page=1` is not the same request upstream,
    // it drops every unread notification from the response.
    const path =
      requestedPage === 1
        ? `/${slug}/notifications`
        : `/${slug}/notifications?page=${requestedPage}`;

    return this.request<FizzyNotification[]>("GET", path);
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

  // ============ Attachments (ActionText direct upload) ============

  /**
   * Step 1: register a blob and get back its signed ids plus where to put the bytes.
   * @endpoint POST /:account_slug/rails/active_storage/direct_uploads
   * @see https://github.com/basecamp/fizzy/blob/main/docs/api/sections/rich_text.md
   */
  async createDirectUpload(
    accountSlug: string,
    blob: DirectUploadBlobRequest
  ): Promise<FizzyDirectUpload> {
    const slug = this.normalizeSlug(accountSlug);
    return this.request<FizzyDirectUpload>(
      "POST",
      `/${slug}/rails/active_storage/direct_uploads`,
      { blob }
    );
  }

  /**
   * Step 2: PUT the bytes to the signed storage URL from step 1.
   *
   * Deliberately not routed through `request()`, for two reasons. That path
   * prefixes `baseUrl`, and this URL is absolute and on a storage host; and it
   * attaches the Fizzy bearer token, which must never be sent to a third party.
   * Only the headers step 1 handed back are sent — the URL signature covers
   * exactly those, and storage rejects any mismatch with an error that does not
   * mention headers.
   *
   * No retry: a failure here is worth surfacing rather than replaying against a
   * signed URL that may since have expired, which would turn one clear error
   * into a slower and less obvious one. Callers retry the whole upload, which
   * mints a fresh URL.
   */
  private async putBlobToStorage(
    url: string,
    headers: Record<string, string>,
    bytes: Uint8Array
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers,
        body: bytes,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw createAPIError(response.status, response.statusText, errorText);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new FizzyTimeoutError(
          `Upload timed out after ${this.timeout}ms`,
          this.timeout
        );
      }
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new FizzyNetworkError(`Network error during upload: ${error.message}`, error);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Run both steps of the ActionText direct-upload flow and return the blob
   * record.
   *
   * To reference the result in a rich-text field, use the record's
   * `attachable_sgid` — not its `signed_id`. See {@link FizzyDirectUpload}.
   */
  async uploadFile(
    accountSlug: string,
    file: FileUpload
  ): Promise<FizzyDirectUpload> {
    const upload = await this.createDirectUpload(accountSlug, {
      filename: file.filename,
      byte_size: file.bytes.length,
      checksum: md5Base64(file.bytes),
      content_type: file.contentType,
    });

    this.log.debug("Direct upload registered", {
      filename: upload.filename,
      byteSize: upload.byte_size,
    });

    await this.putBlobToStorage(
      upload.direct_upload.url,
      upload.direct_upload.headers,
      file.bytes
    );

    return upload;
  }

  // ============ Attachments (reading a blob back) ============

  /**
   * Hard stop on the redirect chain out of ActiveStorage.
   *
   * One hop is what the service actually does today (API → storage). The extra
   * headroom covers a storage backend that redirects once more of its own
   * accord, while still turning a redirect loop into an error rather than an
   * unbounded request loop — the same reasoning as MAX_AGGREGATED_PAGES.
   */
  private static readonly MAX_ATTACHMENT_REDIRECTS = 4;

  /**
   * How much of a failed attachment response is read to build its error message.
   *
   * Enough for a Rails error page's useful opening; small enough that an
   * unbounded body on the least trustworthy hop in the chain costs nothing.
   */
  private static readonly MAX_ATTACHMENT_ERROR_BYTES = 8 * 1024;

  /**
   * Build the ActiveStorage path for a blob, or for one of its representations.
   *
   * Every component is interpolated, never concatenated from caller-supplied
   * text: `parseAttachmentRequest` has already pinned each of them to a single
   * path segment, and the filename is percent-encoded on top of that because
   * ActiveStorage treats it as decoration and a legal name can still contain
   * characters that mean something in a URL.
   */
  private attachmentPath(slug: string, ref: AttachmentRef): string {
    const filename = encodeURIComponent(ref.filename);
    return ref.variation
      ? `/${slug}/rails/active_storage/representations/redirect/${ref.signedId}/${ref.variation}/${filename}`
      : `/${slug}/rails/active_storage/blobs/redirect/${ref.signedId}/${filename}`;
  }

  /**
   * Where a 3xx points, resolved and vetted, or null when this is not a redirect.
   *
   * The `Location` of a response is not trusted input just because the response
   * came from Fizzy: it decides the URL this client fetches next, so it is
   * pinned to http/https here. A `file:`, `data:` or `blob:` target would
   * otherwise be handed straight to `fetch`.
   */
  private resolveAttachmentRedirect(response: Response, from: string): string | null {
    const status = response.status;
    if (status !== 301 && status !== 302 && status !== 303 && status !== 307 && status !== 308) {
      return null;
    }

    const location = response.headers?.get?.("Location");
    if (!location) {
      throw new FizzyParseError(
        `Attachment request returned ${status} with no Location header`
      );
    }

    let next: URL;
    try {
      next = new URL(location, from);
    } catch {
      throw new FizzyParseError("Attachment redirect Location is not a valid URL");
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new FizzyParseError(
        `Refusing to follow an attachment redirect to ${next.protocol} — only http and https are followed`
      );
    }

    // Unauthenticated reads of a blob redirect land on the sign-in page rather
    // than a 401, so without this the caller gets an HTML login form typed as
    // their attachment. Reported as the auth failure it actually is.
    if (next.origin === this.originOfBaseUrl() && /^\/session(\/|$)/.test(next.pathname)) {
      throw new FizzyAuthError(
        "Authentication failed: the attachment request was redirected to sign-in. " +
          "Check the access token and that it can read this account."
      );
    }

    return next.toString();
  }

  /** The configured base URL's origin, or "" when it is not parseable. */
  private originOfBaseUrl(): string {
    try {
      return new URL(this.baseUrl).origin;
    } catch {
      return "";
    }
  }

  /**
   * Read a response body, refusing rather than truncating past `maxBytes`.
   *
   * `Content-Length` is checked first so an oversized attachment costs nothing
   * to reject, then the stream is read incrementally so a response that
   * declares no length — or lies about it — is still bounded. `arrayBuffer()`
   * is the fallback for partial mocks that define no `body`, matching the
   * capability checks the JSON path already makes.
   */
  /**
   * Read at most `limit` bytes of a body as text, discarding the remainder.
   *
   * Exists because the *error* path would otherwise be the one place the
   * attachment size cap does not apply. `readBoundedBody` guards a successful
   * response, but a storage host answering 500 with a chunked body — no
   * `Content-Length` needed — would have been buffered whole by `.text()` just
   * to build an error message, defeating the cap on precisely the response
   * least worth trusting.
   *
   * Never throws: a failure reading an error body must not replace the HTTP
   * error being reported with a less informative one.
   */
  private async readTruncatedText(response: Response, limit: number): Promise<string> {
    const body = response.body;
    if (!body || typeof body.getReader !== "function") {
      // No stream to bound — mocked and older-runtime responses only.
      const text = await response.text().catch(() => "");
      return text.length > limit ? `${text.slice(0, limit)}…` : text;
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (total < limit) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const remaining = limit - total;
        const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
        chunks.push(slice);
        total += slice.byteLength;
      }
    } catch {
      // Fall through with whatever was read.
    } finally {
      // Discards the untruncated tail and releases the connection.
      await reader.cancel().catch(() => {});
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }

  private async readBoundedBody(
    response: Response,
    maxBytes: number,
    describe: string
  ): Promise<Uint8Array> {
    const declared = Number(response.headers?.get?.("Content-Length") ?? Number.NaN);
    if (Number.isSafeInteger(declared) && declared > maxBytes) {
      throw new FizzyAttachmentTooLargeError(
        `${describe} is ${declared} bytes, over the ${maxBytes}-byte limit for an inlined attachment`,
        maxBytes,
        declared
      );
    }

    const body = response.body;
    if (!body || typeof body.getReader !== "function") {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > maxBytes) {
        throw new FizzyAttachmentTooLargeError(
          `${describe} is ${buffer.byteLength} bytes, over the ${maxBytes}-byte limit for an inlined attachment`,
          maxBytes,
          buffer.byteLength
        );
      }
      return new Uint8Array(buffer);
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          throw new FizzyAttachmentTooLargeError(
            `${describe} is over the ${maxBytes}-byte limit for an inlined attachment`,
            maxBytes
          );
        }
        chunks.push(value);
      }
    } finally {
      // Releases the connection on the throw path; a no-op once the stream ended.
      await reader.cancel().catch(() => {});
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  /**
   * Read an attachment back, following ActiveStorage's redirect to storage by
   * hand.
   *
   * **The Fizzy bearer token must never reach the storage host.** The redirect
   * is therefore followed manually — `redirect: "manual"` on every hop — and
   * the `Authorization` header is attached only while the URL is still on the
   * configured Fizzy origin. Auto-following is not an option: whether a runtime
   * strips credentials on a cross-origin redirect is runtime-dependent, and
   * this code ships on both Node (undici) and Cloudflare Workers. The same
   * invariant governs the upload direction — see `putBlobToStorage`, which
   * sends only the headers storage signed.
   *
   * Deciding per hop rather than assuming exactly two also keeps the
   * representation endpoint working: a variant that is not yet processed can
   * redirect within the Fizzy origin first, and that hop *does* need the token.
   *
   * No retry, for the same reason `putBlobToStorage` has none: replaying
   * against a signed storage URL that may since have expired turns one clear
   * error into a slower, less obvious one.
   *
   * The storage URL itself is deliberately not returned. It is a signed,
   * time-limited grant to download the blob without any credential at all —
   * handing it back to the model would put a bearer-equivalent secret into a
   * transcript and let anything downstream fetch outside these checks.
   */
  async fetchAttachment(
    accountSlug: string,
    ref: AttachmentRef,
    options: FetchAttachmentOptions
  ): Promise<FetchedAttachment> {
    const slug = this.normalizeSlug(accountSlug);
    const baseOrigin = this.originOfBaseUrl();
    let url = `${this.baseUrl}${this.attachmentPath(slug, ref)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      for (let hop = 0; hop <= FizzyClient.MAX_ATTACHMENT_REDIRECTS; hop++) {
        // The whole point of the manual walk: credentials are attached by
        // origin, so they stop at the boundary between Fizzy and storage.
        const onFizzyOrigin = baseOrigin !== "" && this.isSameOrigin(url, baseOrigin);
        const headers: Record<string, string> = { Accept: "*/*" };
        if (onFizzyOrigin) {
          headers.Authorization = `Bearer ${this.accessToken}`;
        }

        this.log.debug("Fetching attachment", {
          hop,
          authenticated: onFizzyOrigin,
        });

        const response = await fetch(url, {
          method: "GET",
          headers,
          redirect: "manual",
          signal: controller.signal,
        });

        let next: string | null;
        try {
          next = this.resolveAttachmentRedirect(response, url);
        } catch (error) {
          // A rejected redirect still arrived with a body nobody will read.
          await response.body?.cancel?.().catch(() => {});
          throw error;
        }
        if (next !== null) {
          // Nothing reads a redirect's body, so release the connection rather
          // than leaving it to the GC — and a 302 carrying a large body then
          // costs one header round trip instead of its full length.
          await response.body?.cancel?.().catch(() => {});
          url = next;
          continue;
        }

        if (!response.ok) {
          const errorText = await this.readTruncatedText(
            response,
            FizzyClient.MAX_ATTACHMENT_ERROR_BYTES
          );
          throw createAPIError(response.status, response.statusText, errorText);
        }

        const contentType = (response.headers?.get?.("Content-Type") ?? "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        const declared = Number(response.headers?.get?.("Content-Length") ?? Number.NaN);
        const byteSize = Number.isSafeInteger(declared) && declared >= 0 ? declared : undefined;

        if (options.shouldReadBody && !options.shouldReadBody(contentType)) {
          // Nothing here wants the bytes, so don't pay for them.
          await response.body?.cancel?.().catch(() => {});
          return { contentType, byteSize };
        }

        const bytes = await this.readBoundedBody(response, options.maxBytes, ref.filename);
        return { contentType, bytes, byteSize: bytes.length };
      }

      throw new FizzyNetworkError(
        `Attachment request redirected more than ${FizzyClient.MAX_ATTACHMENT_REDIRECTS} times`
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new FizzyTimeoutError(
          `Attachment fetch timed out after ${this.timeout}ms`,
          this.timeout
        );
      }
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new FizzyNetworkError(
          `Network error while fetching attachment: ${error.message}`,
          error
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Whether `url` is on `origin`; an unparseable URL is never same-origin. */
  private isSameOrigin(url: string, origin: string): boolean {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  }
}
