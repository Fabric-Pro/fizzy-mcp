/**
 * ETag Cache for HTTP Conditional Requests
 *
 * Implements caching based on ETags as described in the Fizzy API:
 * https://github.com/basecamp/fizzy/blob/main/docs/API.md#caching
 *
 * When a response includes an ETag header, we store it along with the response.
 * On subsequent requests, we send the ETag in the If-None-Match header.
 * If the resource hasn't changed, we receive a 304 Not Modified and return cached data.
 */

import { logger } from "./logger.js";

export interface CacheEntry<T> {
  etag: string;
  data: T;
  cachedAt: number;
  url: string;
  /**
   * Opaque, endpoint-specific metadata captured alongside the body (e.g. the
   * pagination headers of a list response) so a later 304 can still report it.
   */
  meta?: unknown;
  /**
   * Best-effort measured size of the response body, as counted toward
   * `maxBytes`. This is the JSON source's length in UTF-16 code units
   * (`raw.length`, passed in as `set`'s `sizeBytes` parameter) — not UTF-8
   * wire bytes, and not the retained heap size of the parsed `data` this
   * entry actually holds. See `ETagCacheOptions.maxBytes` for why that gap
   * is treated as an acceptable, deliberately simple sizing proxy rather
   * than a precise byte count. 0 when the caller couldn't measure the body
   * — such entries still occupy a slot toward `maxEntries` but are not
   * counted toward the byte budget.
   */
  sizeBytes: number;
}

export interface ETagCacheOptions {
  /** Maximum number of cached entries (default: 1000) */
  maxEntries?: number;
  /** Maximum age of cache entries in milliseconds (default: 1 hour) */
  maxAge?: number;
  /**
   * Maximum size for a single cached entry (default: 262144 / 256KB),
   * measured as the JSON response source's length in UTF-16 code units (see
   * `maxBytes` below for why that's a proxy, not a precise byte count). A
   * response measured larger than this is not cached at all — if a
   * (now-stale) entry already exists for that URL, it is deleted rather than
   * left behind an uncacheable response.
   */
  maxEntryBytes?: number;
  /**
   * Maximum total size across all cached entries (default: 8388608 / 8MB),
   * summing the same code-unit measurement as `maxEntryBytes`. Once
   * exceeded, the oldest (least-recently-used) entries are evicted until the
   * total is back at or below this bound.
   *
   * This is a deliberately simple sizing proxy, not a hard memory bound —
   * the measurement itself is only a lower bound, so it's the chosen limit,
   * not the measurement, that has to do the conservative work. `.length`
   * counts UTF-16 code units, which is a lower bound on UTF-8 wire bytes for
   * non-ASCII content (e.g. ~200K CJK characters measure under 256K here but
   * are closer to 600K bytes on the wire); and the cache retains the
   * *parsed* object graph, whose heap footprint typically runs several times
   * its JSON source length. The 8MB default is set with that multiplier in
   * mind, giving nominal headroom against a Durable Object's roughly 128MB
   * isolate budget — not a guarantee about retained heap size, since
   * sufficiently object-dense JSON can still expand well past what a "several
   * times" multiplier assumes.
   */
  maxBytes?: number;
}

export class ETagCache<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>();
  private log = logger.child("etag-cache");

  /** Running total of `sizeBytes` across all entries; kept in sync on every mutation rather than recomputed. */
  private totalBytes = 0;

  readonly maxEntries: number;
  readonly maxAge: number;
  readonly maxEntryBytes: number;
  readonly maxBytes: number;

  constructor(options: ETagCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.maxAge = options.maxAge ?? 60 * 60 * 1000; // 1 hour default
    this.maxEntryBytes = options.maxEntryBytes ?? 262144; // 256KB default
    this.maxBytes = options.maxBytes ?? 8388608; // 8MB default
  }

  /**
   * Get the ETag for a URL if cached
   */
  getETag(url: string): string | undefined {
    const entry = this.cache.get(url);
    if (entry && !this.isExpired(entry)) {
      return entry.etag;
    }
    return undefined;
  }

  /**
   * Get cached data for a URL if available and not expired
   */
  get(url: string): T | undefined {
    const entry = this.cache.get(url);
    if (entry && !this.isExpired(entry)) {
      this.log.debug(`Cache hit: ${url}`);
      this.touch(url, entry);
      return entry.data;
    }
    if (entry) {
      // Expired, remove it
      this.removeEntry(url);
    }
    return undefined;
  }

  /**
   * Get cached data together with its stored metadata, if available and not expired
   */
  getEntry(url: string): { data: T; meta: unknown } | undefined {
    const entry = this.cache.get(url);
    if (entry && !this.isExpired(entry)) {
      this.log.debug(`Cache hit: ${url}`);
      this.touch(url, entry);
      return { data: entry.data, meta: entry.meta };
    }
    if (entry) {
      // Expired, remove it
      this.removeEntry(url);
    }
    return undefined;
  }

  /**
   * Store response data with its ETag, plus optional endpoint-specific
   * metadata and the response body's measured size.
   *
   * `sizeBytes` is best-effort and expected to be the JSON source's length
   * in UTF-16 code units (i.e. `raw.length` from `JSON.parse(raw)`) — see
   * `ETagCacheOptions.maxBytes` for why that's treated as a deliberately
   * simple sizing proxy rather than a precise byte count. Pass `undefined`
   * when the caller couldn't measure the body at all (it's then treated as
   * 0 toward the byte budget, but still occupies a slot toward
   * `maxEntries`). When it exceeds `maxEntryBytes`, the response is not
   * cached at all, and any existing (now-stale) entry for the URL is
   * removed instead of being left behind an uncacheable response.
   */
  set(url: string, etag: string, data: T, meta?: unknown, sizeBytes?: number): void {
    if (sizeBytes !== undefined && sizeBytes > this.maxEntryBytes) {
      if (this.removeEntry(url)) {
        this.log.debug(`Cache invalidated (stale entry behind uncacheable response): ${url}`);
      }
      this.log.debug(`Cache skipped (response too large to cache): ${url}`, {
        sizeBytes,
        maxEntryBytes: this.maxEntryBytes,
      });
      return;
    }

    // Enforce max entries (LRU: evict least-recently-used if at limit)
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.removeEntry(oldestKey);
        this.log.debug(`Cache evicted: ${oldestKey}`);
      }
    }

    // Back out the old byte contribution when overwriting an existing key,
    // so the running total doesn't double-count it. `cache.set` below
    // preserves the key's existing position in Map iteration order on
    // overwrite (only a brand-new key is appended at the end) — matching
    // pre-existing behavior here, unlike the deliberate LRU touch in
    // get()/getEntry().
    const existing = this.cache.get(url);
    if (existing) {
      this.totalBytes -= existing.sizeBytes;
    }

    const effectiveSize = sizeBytes ?? 0;
    this.cache.set(url, {
      etag,
      data,
      cachedAt: Date.now(),
      url,
      meta,
      sizeBytes: effectiveSize,
    });
    this.totalBytes += effectiveSize;

    this.log.debug(`Cache stored: ${url}`, { etag });

    this.evictToByteBudget();
  }

  /**
   * Invalidate cache for a URL (e.g., after a mutation)
   */
  invalidate(url: string): boolean {
    const deleted = this.removeEntry(url);
    if (deleted) {
      this.log.debug(`Cache invalidated: ${url}`);
    }
    return deleted;
  }

  /**
   * Invalidate all cache entries matching a prefix
   * Useful for invalidating related resources after mutations
   */
  invalidatePrefix(urlPrefix: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(urlPrefix)) {
        this.removeEntry(key);
        count++;
      }
    }
    if (count > 0) {
      this.log.debug(`Cache invalidated ${count} entries with prefix: ${urlPrefix}`);
    }
    return count;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.totalBytes = 0;
    this.log.debug(`Cache cleared: ${size} entries`);
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxEntries: number;
    oldestEntry: number | null;
    bytes: number;
    maxBytes: number;
  } {
    let oldest = Infinity;
    for (const entry of this.cache.values()) {
      oldest = Math.min(oldest, entry.cachedAt);
    }

    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      oldestEntry: this.cache.size > 0 ? Date.now() - oldest : null,
      bytes: this.totalBytes,
      maxBytes: this.maxBytes,
    };
  }

  /**
   * Check if a cache entry is expired
   */
  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.cachedAt > this.maxAge;
  }

  /**
   * Move an entry to the back of the Map (most-recently-used position) on a
   * cache hit, so `set`'s eviction — which always removes from the front —
   * behaves as true LRU rather than plain FIFO. Deliberately not used by
   * `getETag()`, which stays pure; every 304 path calls `getEntry()` right
   * after, so recency is still tracked there.
   */
  private touch(url: string, entry: CacheEntry<T>): void {
    this.cache.delete(url);
    this.cache.set(url, entry);
  }

  /**
   * Delete an entry (if present) and keep `totalBytes` in sync. The single
   * choke point for removal so byte accounting can't drift out of sync with
   * the Map across the various call sites that delete entries.
   */
  private removeEntry(url: string): boolean {
    const entry = this.cache.get(url);
    if (!entry) {
      return false;
    }
    this.cache.delete(url);
    this.totalBytes -= entry.sizeBytes;
    return true;
  }

  /**
   * Evict entries from the front of the Map (oldest / least-recently-used)
   * until the running byte total is at or below `maxBytes`.
   */
  private evictToByteBudget(): void {
    while (this.totalBytes > this.maxBytes && this.cache.size > 0) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.removeEntry(oldestKey);
      this.log.debug(`Cache evicted (byte budget): ${oldestKey}`);
    }
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    let cleaned = 0;
    for (const [url, entry] of this.cache) {
      if (this.isExpired(entry)) {
        this.removeEntry(url);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.log.debug(`Cache cleanup: ${cleaned} expired entries removed`);
    }
    return cleaned;
  }
}
