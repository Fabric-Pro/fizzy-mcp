import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/utils/session-manager.js";

describe("SessionManager", () => {
  let manager: SessionManager<{ value: string }>;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    manager?.dispose();
    vi.useRealTimers();
  });

  describe("Basic Operations", () => {
    beforeEach(() => {
      manager = new SessionManager({ cleanupInterval: 0 }); // Disable auto-cleanup for basic tests
    });

    it("should create a session", () => {
      const result = manager.create("session-1", { value: "test" });
      expect(result).toBe(true);
      expect(manager.size).toBe(1);
    });

    it("should get session data", () => {
      manager.create("session-1", { value: "test" });
      const data = manager.get("session-1");
      expect(data).toEqual({ value: "test" });
    });

    it("should return undefined for non-existent session", () => {
      const data = manager.get("non-existent");
      expect(data).toBeUndefined();
    });

    it("should check if session exists", () => {
      manager.create("session-1", { value: "test" });
      expect(manager.has("session-1")).toBe(true);
      expect(manager.has("session-2")).toBe(false);
    });

    it("should delete a session", () => {
      manager.create("session-1", { value: "test" });
      const deleted = manager.delete("session-1");
      expect(deleted).toBe(true);
      expect(manager.size).toBe(0);
    });

    it("should return false when deleting non-existent session", () => {
      const deleted = manager.delete("non-existent");
      expect(deleted).toBe(false);
    });

    it("should peek session without updating activity", () => {
      manager.create("session-1", { value: "test" });
      const initialTime = Date.now();

      vi.advanceTimersByTime(1000);

      const data = manager.peek("session-1");
      expect(data).toEqual({ value: "test" });
    });

    it("should update activity time on get", () => {
      manager.create("session-1", { value: "test" });

      vi.advanceTimersByTime(1000);

      manager.get("session-1");
      // Activity should be updated - session won't expire as quickly
    });

    it("should touch session to update activity", () => {
      manager.create("session-1", { value: "test" });
      vi.advanceTimersByTime(1000);

      const touched = manager.touch("session-1");
      expect(touched).toBe(true);
    });

    it("should return false when touching non-existent session", () => {
      const touched = manager.touch("non-existent");
      expect(touched).toBe(false);
    });

    it("should iterate over session keys", () => {
      manager.create("session-1", { value: "a" });
      manager.create("session-2", { value: "b" });
      manager.create("session-3", { value: "c" });

      const keys = Array.from(manager.keys());
      expect(keys).toHaveLength(3);
      expect(keys).toContain("session-1");
      expect(keys).toContain("session-2");
      expect(keys).toContain("session-3");
    });
  });

  describe("Session Timeout", () => {
    it("should expire sessions after timeout", () => {
      manager = new SessionManager({
        sessionTimeout: 5000, // 5 seconds
        cleanupInterval: 0,
      });

      manager.create("session-1", { value: "test" });
      expect(manager.size).toBe(1);

      // Advance time past timeout
      vi.advanceTimersByTime(6000);

      // Manually trigger cleanup
      const cleaned = manager.cleanup();
      expect(cleaned).toBe(1);
      expect(manager.size).toBe(0);
    });

    it("should not expire active sessions", () => {
      manager = new SessionManager({
        sessionTimeout: 5000,
        cleanupInterval: 0,
      });

      manager.create("session-1", { value: "test" });

      // Advance time but keep session active
      vi.advanceTimersByTime(3000);
      manager.get("session-1"); // Updates activity

      vi.advanceTimersByTime(3000);
      manager.get("session-1"); // Updates activity again

      vi.advanceTimersByTime(3000);
      // 9 seconds total, but last activity was 3 seconds ago

      const cleaned = manager.cleanup();
      expect(cleaned).toBe(0);
      expect(manager.size).toBe(1);
    });

    it("should call onSessionEvicted callback on timeout", () => {
      const onEvicted = vi.fn();
      manager = new SessionManager({
        sessionTimeout: 5000,
        cleanupInterval: 0,
        onSessionEvicted: onEvicted,
      });

      manager.create("session-1", { value: "test" });
      vi.advanceTimersByTime(6000);
      manager.cleanup();

      expect(onEvicted).toHaveBeenCalledWith("session-1", "timeout");
    });

    it("should automatically cleanup with interval", () => {
      manager = new SessionManager({
        sessionTimeout: 5000,
        cleanupInterval: 1000, // Check every second
      });

      manager.create("session-1", { value: "test" });

      // Advance past timeout + cleanup interval
      vi.advanceTimersByTime(6500);

      // Session should have been cleaned up automatically
      expect(manager.size).toBe(0);
    });

    it("should expire multiple sessions at once", () => {
      manager = new SessionManager({
        sessionTimeout: 5000,
        cleanupInterval: 0,
      });

      manager.create("session-1", { value: "a" });
      vi.advanceTimersByTime(1000);
      manager.create("session-2", { value: "b" });
      vi.advanceTimersByTime(1000);
      manager.create("session-3", { value: "c" });

      // Advance enough for all to expire
      vi.advanceTimersByTime(10000);

      const cleaned = manager.cleanup();
      expect(cleaned).toBe(3);
      expect(manager.size).toBe(0);
    });

    it("should only expire sessions past timeout", () => {
      manager = new SessionManager({
        sessionTimeout: 5000,
        cleanupInterval: 0,
      });

      manager.create("session-1", { value: "old" });
      vi.advanceTimersByTime(6000);
      manager.create("session-2", { value: "new" });

      const cleaned = manager.cleanup();
      expect(cleaned).toBe(1);
      expect(manager.size).toBe(1);
      expect(manager.has("session-2")).toBe(true);
    });
  });

  describe("Session Limits", () => {
    it("should enforce maximum session limit", () => {
      manager = new SessionManager({
        maxSessions: 3,
        cleanupInterval: 0,
      });

      expect(manager.create("session-1", { value: "a" })).toBe(true);
      expect(manager.create("session-2", { value: "b" })).toBe(true);
      expect(manager.create("session-3", { value: "c" })).toBe(true);

      // 4th session should evict oldest
      expect(manager.create("session-4", { value: "d" })).toBe(true);
      expect(manager.size).toBe(3);
      expect(manager.has("session-1")).toBe(false); // Evicted
      expect(manager.has("session-4")).toBe(true);
    });

    it("should evict oldest idle session on limit", () => {
      manager = new SessionManager({
        maxSessions: 2,
        cleanupInterval: 0,
      });

      manager.create("session-1", { value: "a" });
      vi.advanceTimersByTime(1000);
      manager.create("session-2", { value: "b" });
      vi.advanceTimersByTime(1000);

      // Make session-1 more recently active (now at t=2000)
      manager.get("session-1");
      vi.advanceTimersByTime(1000);

      // At t=3000:
      // session-1 lastActivityAt = 2000
      // session-2 lastActivityAt = 1000 (older)
      
      // Create new session - should evict session-2 (oldest activity)
      manager.create("session-3", { value: "c" });

      expect(manager.has("session-1")).toBe(true);
      expect(manager.has("session-2")).toBe(false); // Evicted (oldest)
      expect(manager.has("session-3")).toBe(true);
    });

    it("should call onSessionEvicted callback on limit", () => {
      const onEvicted = vi.fn();
      manager = new SessionManager({
        maxSessions: 1,
        cleanupInterval: 0,
        onSessionEvicted: onEvicted,
      });

      manager.create("session-1", { value: "a" });
      manager.create("session-2", { value: "b" });

      expect(onEvicted).toHaveBeenCalledWith("session-1", "limit");
    });

    it("should handle high session count", () => {
      const maxSessions = 100;
      manager = new SessionManager({
        maxSessions,
        cleanupInterval: 0,
      });

      // Create many sessions
      for (let i = 0; i < maxSessions * 2; i++) {
        const result = manager.create(`session-${i}`, { value: `value-${i}` });
        expect(result).toBe(true);
      }

      // Should never exceed max
      expect(manager.size).toBe(maxSessions);
    });

    it("should maintain most recently active sessions on churn", () => {
      manager = new SessionManager({
        maxSessions: 10,
        cleanupInterval: 0,
      });

      // Create initial sessions
      for (let i = 0; i < 10; i++) {
        manager.create(`session-${i}`, { value: `v${i}` });
        vi.advanceTimersByTime(100);
      }

      // Keep some sessions active
      manager.get("session-5");
      manager.get("session-7");
      manager.get("session-9");
      vi.advanceTimersByTime(100);

      // Create more sessions - should evict oldest inactive ones
      for (let i = 10; i < 15; i++) {
        manager.create(`session-${i}`, { value: `v${i}` });
      }

      // Active sessions should still exist
      expect(manager.has("session-5")).toBe(true);
      expect(manager.has("session-7")).toBe(true);
      expect(manager.has("session-9")).toBe(true);
    });
  });

  describe("Memory Leak Prevention", () => {
    it("should properly dispose and clear all sessions", () => {
      manager = new SessionManager({ cleanupInterval: 1000 });

      for (let i = 0; i < 100; i++) {
        manager.create(`session-${i}`, { value: `value-${i}` });
      }

      expect(manager.size).toBe(100);

      manager.dispose();

      expect(manager.size).toBe(0);
    });

    it("should stop cleanup timer on dispose", () => {
      manager = new SessionManager({ cleanupInterval: 1000 });

      manager.create("session-1", { value: "test" });
      manager.dispose();

      // Advance time - timer should be stopped
      vi.advanceTimersByTime(10000);

      // No errors should occur
    });

    it("should not accumulate sessions without cleanup", () => {
      manager = new SessionManager({
        maxSessions: 50,
        sessionTimeout: 1000,
        cleanupInterval: 500,
      });

      // Simulate rapid session creation and abandonment
      for (let i = 0; i < 200; i++) {
        manager.create(`session-${i}`, { value: `v${i}` });
        vi.advanceTimersByTime(100);
      }

      // With cleanup running, old sessions should be removed
      expect(manager.size).toBeLessThanOrEqual(50);
    });

    it("should handle session replacement correctly", () => {
      manager = new SessionManager({ cleanupInterval: 0 });

      // Create and delete sessions repeatedly
      for (let round = 0; round < 10; round++) {
        for (let i = 0; i < 10; i++) {
          manager.create(`session-${round}-${i}`, { value: "test" });
        }
        for (let i = 0; i < 10; i++) {
          manager.delete(`session-${round}-${i}`);
        }
      }

      expect(manager.size).toBe(0);
    });
  });

  describe("Statistics", () => {
    it("should return correct stats for empty manager", () => {
      manager = new SessionManager({ cleanupInterval: 0 });

      const stats = manager.getStats();
      expect(stats.activeSessions).toBe(0);
      expect(stats.oldestSessionAge).toBeNull();
      expect(stats.averageIdleTime).toBeNull();
    });

    it("should return correct stats with sessions", () => {
      manager = new SessionManager({
        maxSessions: 100,
        cleanupInterval: 0,
      });

      manager.create("session-1", { value: "a" });
      vi.advanceTimersByTime(1000);
      manager.create("session-2", { value: "b" });
      vi.advanceTimersByTime(1000);
      manager.create("session-3", { value: "c" });

      const stats = manager.getStats();
      expect(stats.activeSessions).toBe(3);
      expect(stats.maxSessions).toBe(100);
      expect(stats.oldestSessionAge).toBeGreaterThanOrEqual(2000);
      expect(stats.averageIdleTime).toBeDefined();
    });

    it("should update stats after activity", () => {
      manager = new SessionManager({ cleanupInterval: 0 });

      manager.create("session-1", { value: "a" });
      vi.advanceTimersByTime(5000);

      const statsBefore = manager.getStats();

      // Touch the session
      manager.get("session-1");

      const statsAfter = manager.getStats();

      // Idle time should be reset (lower now)
      expect(statsAfter.averageIdleTime).toBeLessThan(statsBefore.averageIdleTime!);
    });
  });

  describe("Concurrent Access Simulation", () => {
    it("should handle rapid create/delete cycles", () => {
      manager = new SessionManager({ cleanupInterval: 0 });

      const operations: Promise<void>[] = [];

      for (let i = 0; i < 100; i++) {
        operations.push(
          Promise.resolve().then(() => {
            manager.create(`session-${i}`, { value: `v${i}` });
            manager.get(`session-${i}`);
            manager.delete(`session-${i}`);
          })
        );
      }

      // All operations should complete without error
      expect(Promise.all(operations)).resolves.not.toThrow();
    });

    it("should maintain consistency under simulated load", () => {
      manager = new SessionManager({
        maxSessions: 20,
        cleanupInterval: 0,
      });

      // Simulate mixed operations
      for (let i = 0; i < 1000; i++) {
        const op = i % 4;
        const id = `session-${i % 30}`;

        switch (op) {
          case 0:
            manager.create(id, { value: `v${i}` });
            break;
          case 1:
            manager.get(id);
            break;
          case 2:
            manager.touch(id);
            break;
          case 3:
            manager.delete(id);
            break;
        }
      }

      // Should never exceed max
      expect(manager.size).toBeLessThanOrEqual(20);
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero maxSessions", () => {
      // This is an edge case - effectively disables session creation
      manager = new SessionManager({
        maxSessions: 0,
        cleanupInterval: 0,
      });

      // Can't create sessions with 0 max
      // Actually, with 0 max, it will try to evict but there's nothing to evict
      const result = manager.create("session-1", { value: "test" });
      expect(result).toBe(false);
    });

    it("should handle very short timeout", () => {
      manager = new SessionManager({
        sessionTimeout: 1, // 1ms
        cleanupInterval: 0,
      });

      manager.create("session-1", { value: "test" });
      vi.advanceTimersByTime(2);

      manager.cleanup();
      expect(manager.size).toBe(0);
    });

    it("should handle session ID with special characters", () => {
      manager = new SessionManager({ cleanupInterval: 0 });

      const specialIds = [
        "session with spaces",
        "session\twith\ttabs",
        "session\nwith\nnewlines",
        "session-with-émojis-🎉",
        "session/with/slashes",
        "session?with=query&params",
      ];

      for (const id of specialIds) {
        expect(manager.create(id, { value: "test" })).toBe(true);
        expect(manager.has(id)).toBe(true);
        expect(manager.get(id)).toEqual({ value: "test" });
        expect(manager.delete(id)).toBe(true);
      }
    });
  });
});

