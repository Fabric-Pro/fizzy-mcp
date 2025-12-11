/**
 * Cloudflare KV Cache
 * 
 * Provides caching for Fizzy API responses using Cloudflare KV:
 * - Reduce API calls to Fizzy
 * - Improve response times
 * - Handle cache invalidation on mutations
 * 
 * @see https://developers.cloudflare.com/kv/
 */

import type { KVNamespace } from "@cloudflare/workers-types";

/**
 * Cache configuration
 */
export interface KVCacheConfig {
  /** KV namespace binding */
  kv?: KVNamespace;
  /** Default TTL in seconds (default: 300 = 5 minutes) */
  defaultTtl?: number;
  /** Key prefix for namespacing */
  prefix?: string;
}

/**
 * Cache entry metadata
 */
export interface CacheMetadata {
  /** Original ETag from Fizzy API */
  etag?: string;
  /** Timestamp when cached */
  cachedAt: number;
  /** Account slug for invalidation */
  accountSlug?: string;
  /** Resource type for invalidation */
  resourceType?: string;
}

/**
 * TTL configurations for different resource types
 */
export const CACHE_TTL = {
  /** Identity/accounts rarely change - 30 minutes */
  identity: 1800,
  /** Boards change occasionally - 5 minutes */
  boards: 300,
  /** Cards change frequently - 1 minute */
  cards: 60,
  /** Columns change occasionally - 5 minutes */
  columns: 300,
  /** Tags change rarely - 10 minutes */
  tags: 600,
  /** Users change rarely - 10 minutes */
  users: 600,
  /** Notifications are time-sensitive - 30 seconds */
  notifications: 30,
  /** Comments change frequently - 1 minute */
  comments: 60,
} as const;

/**
 * Cloudflare KV Cache for Fizzy API responses
 */
export class KVCache {
  private kv?: KVNamespace;
  private defaultTtl: number;
  private prefix: string;

  constructor(config: KVCacheConfig = {}) {
    this.kv = config.kv;
    this.defaultTtl = config.defaultTtl ?? 300;
    this.prefix = config.prefix ?? "fizzy";
  }

  /**
   * Check if cache is enabled
   */
  isEnabled(): boolean {
    return !!this.kv;
  }

  /**
   * Generate a cache key
   */
  private key(path: string, accountSlug?: string): string {
    const parts = [this.prefix];
    if (accountSlug) parts.push(accountSlug);
    parts.push(path.replace(/\//g, ":"));
    return parts.join(":");
  }

  /**
   * Get a cached value
   */
  async get<T>(
    path: string,
    accountSlug?: string
  ): Promise<{ value: T; metadata: CacheMetadata } | null> {
    if (!this.kv) return null;

    const cacheKey = this.key(path, accountSlug);

    try {
      const result = await this.kv.getWithMetadata<T, CacheMetadata>(cacheKey, "json");
      
      if (result.value && result.metadata) {
        return {
          value: result.value,
          metadata: result.metadata,
        };
      }
      
      return null;
    } catch (error) {
      console.error("KV cache get error:", error);
      return null;
    }
  }

  /**
   * Set a cached value
   */
  async set<T>(
    path: string,
    value: T,
    options?: {
      accountSlug?: string;
      etag?: string;
      ttl?: number;
      resourceType?: string;
    }
  ): Promise<void> {
    if (!this.kv) return;

    const cacheKey = this.key(path, options?.accountSlug);
    const metadata: CacheMetadata = {
      etag: options?.etag,
      cachedAt: Date.now(),
      accountSlug: options?.accountSlug,
      resourceType: options?.resourceType,
    };

    try {
      await this.kv.put(cacheKey, JSON.stringify(value), {
        expirationTtl: options?.ttl ?? this.defaultTtl,
        metadata,
      });
    } catch (error) {
      console.error("KV cache set error:", error);
    }
  }

  /**
   * Delete a cached value
   */
  async delete(path: string, accountSlug?: string): Promise<void> {
    if (!this.kv) return;

    const cacheKey = this.key(path, accountSlug);

    try {
      await this.kv.delete(cacheKey);
    } catch (error) {
      console.error("KV cache delete error:", error);
    }
  }

  /**
   * Invalidate cache for a resource type in an account
   * 
   * Note: KV doesn't support prefix deletion, so this uses list + delete.
   * For high-volume scenarios, consider using a different invalidation strategy.
   */
  async invalidateByPrefix(prefix: string, limit: number = 100): Promise<number> {
    if (!this.kv) return 0;

    const fullPrefix = `${this.prefix}:${prefix}`;
    let deleted = 0;

    try {
      const list = await this.kv.list({ prefix: fullPrefix, limit });
      
      for (const key of list.keys) {
        await this.kv.delete(key.name);
        deleted++;
      }

      // If there might be more, log a warning
      if (!list.list_complete) {
        console.warn(`Cache invalidation incomplete for prefix ${prefix}. Deleted ${deleted} of potentially more entries.`);
      }
    } catch (error) {
      console.error("KV cache invalidation error:", error);
    }

    return deleted;
  }

  /**
   * Invalidate cache based on a mutation
   * 
   * This intelligently invalidates related cache entries when
   * data is modified through the MCP server.
   */
  async invalidateForMutation(
    _mutationType: "create" | "update" | "delete",
    resourceType: string,
    accountSlug: string,
    resourceId?: string
  ): Promise<void> {
    if (!this.kv) return;

    // Always invalidate the list endpoint
    await this.delete(`${resourceType}`, accountSlug);

    // For specific resource changes, also invalidate the individual resource
    if (resourceId) {
      await this.delete(`${resourceType}:${resourceId}`, accountSlug);
    }

    // Cross-resource invalidation
    switch (resourceType) {
      case "cards":
        // Card changes might affect board counts
        await this.invalidateByPrefix(`${accountSlug}:boards`, 10);
        break;
      case "columns":
        // Column changes affect board structure
        await this.invalidateByPrefix(`${accountSlug}:boards`, 10);
        break;
      case "comments":
        // Comment changes affect card details
        if (resourceId) {
          // resourceId here is cardId
          await this.delete(`cards:${resourceId}`, accountSlug);
        }
        break;
    }
  }

  /**
   * Get cache statistics
   * 
   * Note: KV doesn't provide detailed stats, this is an estimate
   */
  async getStats(): Promise<{ keyCount: number; prefix: string }> {
    if (!this.kv) {
      return { keyCount: 0, prefix: this.prefix };
    }

    try {
      const list = await this.kv.list({ prefix: this.prefix, limit: 1000 });
      return {
        keyCount: list.keys.length,
        prefix: this.prefix,
      };
    } catch {
      return { keyCount: -1, prefix: this.prefix };
    }
  }
}

/**
 * Create a caching wrapper for API calls
 */
export function createCacheWrapper(cache: KVCache) {
  return {
    /**
     * Wrap a GET request with caching
     */
    async wrapGet<T>(
      path: string,
      fetcher: () => Promise<T>,
      options?: {
        accountSlug?: string;
        ttl?: number;
        resourceType?: string;
      }
    ): Promise<T> {
      // Try cache first
      const cached = await cache.get<T>(path, options?.accountSlug);
      if (cached) {
        return cached.value;
      }

      // Fetch fresh data
      const value = await fetcher();

      // Cache the result
      await cache.set(path, value, {
        accountSlug: options?.accountSlug,
        ttl: options?.ttl,
        resourceType: options?.resourceType,
      });

      return value;
    },

    /**
     * Invalidate cache after a mutation
     */
    async invalidate(
      mutationType: "create" | "update" | "delete",
      resourceType: string,
      accountSlug: string,
      resourceId?: string
    ): Promise<void> {
      await cache.invalidateForMutation(mutationType, resourceType, accountSlug, resourceId);
    },
  };
}

