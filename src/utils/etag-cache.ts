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
}

export interface ETagCacheOptions {
  /** Maximum number of cached entries (default: 1000) */
  maxEntries?: number;
  /** Maximum age of cache entries in milliseconds (default: 1 hour) */
  maxAge?: number;
}

export class ETagCache<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>();
  private log = logger.child("etag-cache");
  
  readonly maxEntries: number;
  readonly maxAge: number;

  constructor(options: ETagCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.maxAge = options.maxAge ?? 60 * 60 * 1000; // 1 hour default
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
      return entry.data;
    }
    if (entry) {
      // Expired, remove it
      this.cache.delete(url);
    }
    return undefined;
  }

  /**
   * Store response data with its ETag
   */
  set(url: string, etag: string, data: T): void {
    // Enforce max entries (LRU-style: remove oldest if at limit)
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.log.debug(`Cache evicted: ${oldestKey}`);
      }
    }

    this.cache.set(url, {
      etag,
      data,
      cachedAt: Date.now(),
      url,
    });

    this.log.debug(`Cache stored: ${url}`, { etag });
  }

  /**
   * Invalidate cache for a URL (e.g., after a mutation)
   */
  invalidate(url: string): boolean {
    const deleted = this.cache.delete(url);
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
        this.cache.delete(key);
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
    this.log.debug(`Cache cleared: ${size} entries`);
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxEntries: number;
    oldestEntry: number | null;
  } {
    let oldest = Infinity;
    for (const entry of this.cache.values()) {
      oldest = Math.min(oldest, entry.cachedAt);
    }

    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      oldestEntry: this.cache.size > 0 ? Date.now() - oldest : null,
    };
  }

  /**
   * Check if a cache entry is expired
   */
  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.cachedAt > this.maxAge;
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    let cleaned = 0;
    for (const [url, entry] of this.cache) {
      if (this.isExpired(entry)) {
        this.cache.delete(url);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.log.debug(`Cache cleanup: ${cleaned} expired entries removed`);
    }
    return cleaned;
  }
}

