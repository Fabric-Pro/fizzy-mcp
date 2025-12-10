/**
 * Session Manager
 * Handles session lifecycle, timeouts, and limits
 */

import { logger } from "./logger.js";

export interface SessionEntry<T> {
  data: T;
  createdAt: number;
  lastActivityAt: number;
}

export interface SessionManagerOptions {
  /** Maximum number of concurrent sessions (default: 1000) */
  maxSessions?: number;
  /** Session idle timeout in milliseconds (default: 30 minutes) */
  sessionTimeout?: number;
  /** Cleanup interval in milliseconds (default: 1 minute) */
  cleanupInterval?: number;
  /** Callback when session is evicted */
  onSessionEvicted?: (sessionId: string, reason: "timeout" | "limit") => void;
}

export class SessionManager<T> {
  private sessions = new Map<string, SessionEntry<T>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private log = logger.child("session-manager");

  readonly maxSessions: number;
  readonly sessionTimeout: number;
  private cleanupInterval: number;
  private onSessionEvicted?: (sessionId: string, reason: "timeout" | "limit") => void;

  constructor(options: SessionManagerOptions = {}) {
    this.maxSessions = options.maxSessions ?? 1000;
    this.sessionTimeout = options.sessionTimeout ?? 30 * 60 * 1000; // 30 minutes
    this.cleanupInterval = options.cleanupInterval ?? 60 * 1000; // 1 minute
    this.onSessionEvicted = options.onSessionEvicted;

    this.startCleanupTimer();
  }

  /**
   * Create a new session
   * Returns false if session limit reached and cannot evict
   */
  create(sessionId: string, data: T): boolean {
    // Check session limit
    if (this.sessions.size >= this.maxSessions) {
      // Try to evict oldest idle session
      const evicted = this.evictOldestIdleSession();
      if (!evicted) {
        this.log.warn(`Session limit reached (${this.maxSessions}), cannot create new session`);
        return false;
      }
    }

    const now = Date.now();
    this.sessions.set(sessionId, {
      data,
      createdAt: now,
      lastActivityAt: now,
    });

    this.log.debug(`Session created: ${sessionId}`, {
      activeSessions: this.sessions.size,
    });

    return true;
  }

  /**
   * Get session data and update last activity time
   */
  get(sessionId: string): T | undefined {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.lastActivityAt = Date.now();
      return entry.data;
    }
    return undefined;
  }

  /**
   * Get session data without updating activity time (for reads)
   */
  peek(sessionId: string): T | undefined {
    return this.sessions.get(sessionId)?.data;
  }

  /**
   * Check if session exists
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Delete a session
   */
  delete(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      this.log.debug(`Session deleted: ${sessionId}`, {
        activeSessions: this.sessions.size,
      });
    }
    return deleted;
  }

  /**
   * Update session activity timestamp
   */
  touch(sessionId: string): boolean {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.lastActivityAt = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Get number of active sessions
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Get all session IDs
   */
  keys(): IterableIterator<string> {
    return this.sessions.keys();
  }

  /**
   * Get session statistics
   */
  getStats(): {
    activeSessions: number;
    maxSessions: number;
    oldestSessionAge: number | null;
    averageIdleTime: number | null;
  } {
    const now = Date.now();
    let oldestAge = 0;
    let totalIdleTime = 0;

    for (const entry of this.sessions.values()) {
      const age = now - entry.createdAt;
      const idleTime = now - entry.lastActivityAt;
      oldestAge = Math.max(oldestAge, age);
      totalIdleTime += idleTime;
    }

    return {
      activeSessions: this.sessions.size,
      maxSessions: this.maxSessions,
      oldestSessionAge: this.sessions.size > 0 ? oldestAge : null,
      averageIdleTime: this.sessions.size > 0 ? totalIdleTime / this.sessions.size : null,
    };
  }

  /**
   * Evict oldest idle session to make room for new one
   */
  private evictOldestIdleSession(): boolean {
    let oldestSessionId: string | null = null;
    let oldestActivityTime = Infinity;

    for (const [sessionId, entry] of this.sessions) {
      if (entry.lastActivityAt < oldestActivityTime) {
        oldestActivityTime = entry.lastActivityAt;
        oldestSessionId = sessionId;
      }
    }

    if (oldestSessionId) {
      this.sessions.delete(oldestSessionId);
      this.log.info(`Session evicted (limit): ${oldestSessionId}`);
      this.onSessionEvicted?.(oldestSessionId, "limit");
      return true;
    }

    return false;
  }

  /**
   * Clean up expired sessions
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, entry] of this.sessions) {
      const idleTime = now - entry.lastActivityAt;
      if (idleTime > this.sessionTimeout) {
        this.sessions.delete(sessionId);
        this.log.info(`Session expired: ${sessionId}`, {
          idleTime: Math.round(idleTime / 1000),
        });
        this.onSessionEvicted?.(sessionId, "timeout");
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.log.debug(`Cleaned ${cleaned} expired sessions`, {
        activeSessions: this.sessions.size,
      });
    }

    return cleaned;
  }

  /**
   * Start the cleanup timer
   */
  private startCleanupTimer(): void {
    if (this.cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => {
        this.cleanup();
      }, this.cleanupInterval);

      // Don't prevent process exit
      this.cleanupTimer.unref?.();
    }
  }

  /**
   * Stop the cleanup timer and clear all sessions
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
    this.log.debug("Session manager disposed");
  }
}

