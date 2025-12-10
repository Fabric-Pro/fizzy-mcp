import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ETagCache } from "../../src/utils/etag-cache.js";

describe("ETagCache", () => {
  let cache: ETagCache<{ data: string }>;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new ETagCache({ maxAge: 60000 }); // 1 minute
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Basic Operations", () => {
    it("should store and retrieve data with ETag", () => {
      cache.set("/api/resource", '"etag123"', { data: "test" });

      expect(cache.get("/api/resource")).toEqual({ data: "test" });
      expect(cache.getETag("/api/resource")).toBe('"etag123"');
    });

    it("should return undefined for non-existent entries", () => {
      expect(cache.get("/api/unknown")).toBeUndefined();
      expect(cache.getETag("/api/unknown")).toBeUndefined();
    });

    it("should invalidate specific entries", () => {
      cache.set("/api/resource", '"etag1"', { data: "test" });

      expect(cache.invalidate("/api/resource")).toBe(true);
      expect(cache.get("/api/resource")).toBeUndefined();
    });

    it("should return false when invalidating non-existent entry", () => {
      expect(cache.invalidate("/api/unknown")).toBe(false);
    });

    it("should clear all entries", () => {
      cache.set("/api/resource1", '"etag1"', { data: "test1" });
      cache.set("/api/resource2", '"etag2"', { data: "test2" });

      cache.clear();

      expect(cache.get("/api/resource1")).toBeUndefined();
      expect(cache.get("/api/resource2")).toBeUndefined();
    });
  });

  describe("Prefix Invalidation", () => {
    it("should invalidate entries matching prefix", () => {
      cache.set("/api/boards/1", '"etag1"', { data: "board1" });
      cache.set("/api/boards/2", '"etag2"', { data: "board2" });
      cache.set("/api/cards/1", '"etag3"', { data: "card1" });

      const count = cache.invalidatePrefix("/api/boards");

      expect(count).toBe(2);
      expect(cache.get("/api/boards/1")).toBeUndefined();
      expect(cache.get("/api/boards/2")).toBeUndefined();
      expect(cache.get("/api/cards/1")).toEqual({ data: "card1" });
    });

    it("should return 0 when no entries match prefix", () => {
      cache.set("/api/cards/1", '"etag1"', { data: "card1" });

      const count = cache.invalidatePrefix("/api/boards");

      expect(count).toBe(0);
    });
  });

  describe("Expiration", () => {
    it("should expire entries after maxAge", () => {
      cache.set("/api/resource", '"etag1"', { data: "test" });

      expect(cache.get("/api/resource")).toEqual({ data: "test" });

      // Advance time past maxAge
      vi.advanceTimersByTime(61000);

      expect(cache.get("/api/resource")).toBeUndefined();
      expect(cache.getETag("/api/resource")).toBeUndefined();
    });

    it("should not expire entries within maxAge", () => {
      cache.set("/api/resource", '"etag1"', { data: "test" });

      vi.advanceTimersByTime(30000); // Half of maxAge

      expect(cache.get("/api/resource")).toEqual({ data: "test" });
    });

    it("should cleanup expired entries", () => {
      cache.set("/api/resource1", '"etag1"', { data: "old" });
      vi.advanceTimersByTime(61000);
      cache.set("/api/resource2", '"etag2"', { data: "new" });

      const cleaned = cache.cleanup();

      expect(cleaned).toBe(1);
      expect(cache.get("/api/resource1")).toBeUndefined();
      expect(cache.get("/api/resource2")).toEqual({ data: "new" });
    });
  });

  describe("Max Entries Limit", () => {
    it("should enforce max entries limit", () => {
      const smallCache = new ETagCache<{ data: string }>({
        maxEntries: 3,
        maxAge: 60000,
      });

      smallCache.set("/api/1", '"etag1"', { data: "first" });
      smallCache.set("/api/2", '"etag2"', { data: "second" });
      smallCache.set("/api/3", '"etag3"', { data: "third" });

      // Adding 4th should evict the first (oldest)
      smallCache.set("/api/4", '"etag4"', { data: "fourth" });

      expect(smallCache.get("/api/1")).toBeUndefined();
      expect(smallCache.get("/api/2")).toEqual({ data: "second" });
      expect(smallCache.get("/api/3")).toEqual({ data: "third" });
      expect(smallCache.get("/api/4")).toEqual({ data: "fourth" });
    });
  });

  describe("Statistics", () => {
    it("should return correct stats for empty cache", () => {
      const stats = cache.getStats();

      expect(stats.size).toBe(0);
      expect(stats.oldestEntry).toBeNull();
    });

    it("should return correct stats with entries", () => {
      cache.set("/api/1", '"etag1"', { data: "test1" });
      vi.advanceTimersByTime(1000);
      cache.set("/api/2", '"etag2"', { data: "test2" });

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.oldestEntry).toBeGreaterThanOrEqual(1000);
    });
  });

  describe("ETag Format", () => {
    it("should handle weak ETags", () => {
      cache.set("/api/resource", 'W/"weak-etag"', { data: "test" });

      expect(cache.getETag("/api/resource")).toBe('W/"weak-etag"');
    });

    it("should handle ETags with special characters", () => {
      const specialETag = '"abc/def+ghi=jkl"';
      cache.set("/api/resource", specialETag, { data: "test" });

      expect(cache.getETag("/api/resource")).toBe(specialETag);
    });
  });
});

describe("ETagCache with FizzyClient Integration", () => {
  it("should be used by FizzyClient for GET requests", async () => {
    // This is tested in fizzy-client.test.ts
    // Just verify the cache can be instantiated with client config
    const cache = new ETagCache({
      maxAge: 60 * 60 * 1000,
      maxEntries: 1000,
    });

    expect(cache).toBeDefined();
    expect(cache.getStats().maxEntries).toBe(1000);
  });
});

