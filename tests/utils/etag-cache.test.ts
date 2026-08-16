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

  describe("Byte-Bounded Cache", () => {
    it("should not cache entries over maxEntryBytes", () => {
      const smallByteCache = new ETagCache<{ data: string }>({
        maxEntryBytes: 100,
        maxAge: 60000,
      });

      smallByteCache.set("/api/big", '"etag1"', { data: "big" }, undefined, 200);

      expect(smallByteCache.get("/api/big")).toBeUndefined();
      expect(smallByteCache.getStats().size).toBe(0);
      expect(smallByteCache.getStats().bytes).toBe(0);
    });

    it("should delete an existing entry when replaced by an oversized response", () => {
      const smallByteCache = new ETagCache<{ data: string }>({
        maxEntryBytes: 100,
        maxAge: 60000,
      });

      smallByteCache.set("/api/resource", '"etag1"', { data: "small" }, undefined, 10);
      expect(smallByteCache.get("/api/resource")).toEqual({ data: "small" });

      // A later, oversized response for the same URL must not leave the old
      // (now stale) entry lingering behind it.
      smallByteCache.set("/api/resource", '"etag2"', { data: "big" }, undefined, 500);

      expect(smallByteCache.get("/api/resource")).toBeUndefined();
      expect(smallByteCache.getStats().size).toBe(0);
    });

    it("should evict oldest entries once total bytes exceeds maxBytes", () => {
      const boundedCache = new ETagCache<{ data: string }>({
        maxBytes: 250,
        maxEntries: 100,
        maxAge: 60000,
      });

      boundedCache.set("/api/1", '"etag1"', { data: "1" }, undefined, 100);
      boundedCache.set("/api/2", '"etag2"', { data: "2" }, undefined, 100);
      // Total would be 300 > 250 once this is inserted, so the oldest
      // entry (/api/1) must be evicted to bring it back under budget.
      boundedCache.set("/api/3", '"etag3"', { data: "3" }, undefined, 100);

      expect(boundedCache.get("/api/1")).toBeUndefined();
      expect(boundedCache.get("/api/2")).toEqual({ data: "2" });
      expect(boundedCache.get("/api/3")).toEqual({ data: "3" });
      expect(boundedCache.getStats().bytes).toBe(200);
    });

    it("should keep byte accounting correct across overwrite, invalidate, invalidatePrefix, and clear", () => {
      const boundedCache = new ETagCache<{ data: string }>({
        maxBytes: 10_000,
        maxAge: 60000,
      });

      boundedCache.set("/api/boards/1", '"etag1"', { data: "a" }, undefined, 100);
      boundedCache.set("/api/boards/2", '"etag2"', { data: "b" }, undefined, 200);
      boundedCache.set("/api/cards/1", '"etag3"', { data: "c" }, undefined, 300);

      expect(boundedCache.getStats().bytes).toBe(600);

      // Overwrite: the old contribution (100) must be backed out before the
      // new one (150) is added, not simply added on top.
      boundedCache.set("/api/boards/1", '"etag4"', { data: "a2" }, undefined, 150);
      expect(boundedCache.getStats().bytes).toBe(650); // 150 + 200 + 300

      boundedCache.invalidate("/api/boards/1");
      expect(boundedCache.getStats().bytes).toBe(500); // 200 + 300

      boundedCache.invalidatePrefix("/api/cards");
      expect(boundedCache.getStats().bytes).toBe(200); // just /api/boards/2

      boundedCache.clear();
      expect(boundedCache.getStats().bytes).toBe(0);
    });

    it("should keep byte accounting correct when an entry expires via get()/getEntry()", () => {
      const boundedCache = new ETagCache<{ data: string }>({
        maxBytes: 10_000,
        maxAge: 60000,
      });

      boundedCache.set("/api/1", '"etag1"', { data: "a" }, undefined, 100);
      boundedCache.set("/api/2", '"etag2"', { data: "b" }, undefined, 200);
      expect(boundedCache.getStats().bytes).toBe(300);

      vi.advanceTimersByTime(61000);

      // get() on an expired entry deletes it and backs its bytes out.
      expect(boundedCache.get("/api/1")).toBeUndefined();
      expect(boundedCache.getStats().bytes).toBe(200);

      // getEntry() on an expired entry does the same.
      expect(boundedCache.getEntry("/api/2")).toBeUndefined();
      expect(boundedCache.getStats().bytes).toBe(0);
    });

    it("should keep byte accounting correct across cleanup()", () => {
      const boundedCache = new ETagCache<{ data: string }>({
        maxBytes: 10_000,
        maxAge: 60000,
      });

      boundedCache.set("/api/1", '"etag1"', { data: "a" }, undefined, 100);
      vi.advanceTimersByTime(61000);
      boundedCache.set("/api/2", '"etag2"', { data: "b" }, undefined, 200);

      expect(boundedCache.getStats().bytes).toBe(300);

      const cleaned = boundedCache.cleanup();

      expect(cleaned).toBe(1);
      expect(boundedCache.getStats().bytes).toBe(200);
    });

    it("should treat unmeasured entries (sizeBytes undefined) as zero bytes", () => {
      const boundedCache = new ETagCache<{ data: string }>({ maxBytes: 100, maxAge: 60000 });

      boundedCache.set("/api/1", '"etag1"', { data: "a" }); // no sizeBytes passed

      expect(boundedCache.getStats().bytes).toBe(0);
      expect(boundedCache.get("/api/1")).toEqual({ data: "a" });
    });

    it("should report bytes and maxBytes in getStats()", () => {
      const boundedCache = new ETagCache<{ data: string }>({ maxBytes: 12345, maxAge: 60000 });

      boundedCache.set("/api/1", '"etag1"', { data: "a" }, undefined, 42);

      const stats = boundedCache.getStats();
      expect(stats.bytes).toBe(42);
      expect(stats.maxBytes).toBe(12345);
    });

    it("should account sizeBytes as UTF-16 code units, not UTF-8 wire bytes", () => {
      // Pins the documented semantics: callers pass `raw.length` (UTF-16 code
      // units of the JSON source), which the cache treats as-is — it does not
      // attempt to measure actual UTF-8 wire size. Each of these CJK
      // characters is 1 UTF-16 code unit but 3 UTF-8 bytes, so the two
      // measurements diverge sharply for non-ASCII content.
      const nonAsciiPayload = "漢".repeat(50);
      expect(nonAsciiPayload.length).toBe(50);
      expect(Buffer.byteLength(nonAsciiPayload, "utf8")).toBe(150);

      const boundedCache = new ETagCache<{ data: string }>({ maxBytes: 10_000, maxAge: 60000 });
      boundedCache.set("/api/cjk", '"etag1"', { data: nonAsciiPayload }, undefined, nonAsciiPayload.length);

      // Accounted by the code-unit count (50), not the UTF-8 byte length (150).
      expect(boundedCache.getStats().bytes).toBe(50);
    });
  });

  describe("LRU Recency", () => {
    it("should protect a recently get()-hit entry from eviction", () => {
      const smallCache = new ETagCache<{ data: string }>({ maxEntries: 3, maxAge: 60000 });

      smallCache.set("/api/1", '"etag1"', { data: "first" });
      smallCache.set("/api/2", '"etag2"', { data: "second" });
      smallCache.set("/api/3", '"etag3"', { data: "third" });

      // Touch /api/1 so it becomes the most-recently-used entry.
      smallCache.get("/api/1");

      // Adding a 4th entry should now evict /api/2 (the true
      // least-recently-used entry), not /api/1.
      smallCache.set("/api/4", '"etag4"', { data: "fourth" });

      expect(smallCache.get("/api/1")).toEqual({ data: "first" });
      expect(smallCache.get("/api/2")).toBeUndefined();
      expect(smallCache.get("/api/3")).toEqual({ data: "third" });
      expect(smallCache.get("/api/4")).toEqual({ data: "fourth" });
    });

    it("should protect a recently getEntry()-hit entry from eviction", () => {
      const smallCache = new ETagCache<{ data: string }>({ maxEntries: 3, maxAge: 60000 });

      smallCache.set("/api/1", '"etag1"', { data: "first" }, { note: "meta1" });
      smallCache.set("/api/2", '"etag2"', { data: "second" });
      smallCache.set("/api/3", '"etag3"', { data: "third" });

      smallCache.getEntry("/api/1");

      smallCache.set("/api/4", '"etag4"', { data: "fourth" });

      expect(smallCache.getEntry("/api/1")).toEqual({ data: { data: "first" }, meta: { note: "meta1" } });
      expect(smallCache.get("/api/2")).toBeUndefined();
      expect(smallCache.get("/api/3")).toEqual({ data: "third" });
    });

    it("should leave getETag() pure (no reordering) since every 304 path calls getEntry() right after", () => {
      const smallCache = new ETagCache<{ data: string }>({ maxEntries: 3, maxAge: 60000 });

      smallCache.set("/api/1", '"etag1"', { data: "first" });
      smallCache.set("/api/2", '"etag2"', { data: "second" });
      smallCache.set("/api/3", '"etag3"', { data: "third" });

      // getETag() alone must not protect /api/1 from eviction.
      smallCache.getETag("/api/1");

      smallCache.set("/api/4", '"etag4"', { data: "fourth" });

      expect(smallCache.get("/api/1")).toBeUndefined();
      expect(smallCache.get("/api/2")).toEqual({ data: "second" });
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

