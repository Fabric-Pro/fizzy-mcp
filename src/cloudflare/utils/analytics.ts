/**
 * Cloudflare Analytics Engine Integration
 * 
 * Track metrics for the MCP server including:
 * - Tool invocation counts and latency
 * - Session metrics
 * - Error rates
 * - API usage patterns
 * 
 * @see https://developers.cloudflare.com/analytics/analytics-engine/
 */

import type { AnalyticsEngineDataset } from "@cloudflare/workers-types";

/**
 * Metric types for the analytics engine
 */
export type MetricType = 
  | "tool_invocation"
  | "session_created"
  | "session_initialized"
  | "session_expired"
  | "error"
  | "request";

/**
 * Analytics data point
 */
export interface AnalyticsDataPoint {
  /** Metric type identifier */
  index: MetricType;
  /** Blobs for categorical data (max 20, max 1024 bytes each) */
  blobs?: string[];
  /** Doubles for numeric data (max 20) */
  doubles?: number[];
}

/**
 * Configuration for CloudflareAnalytics
 */
export interface CloudflareAnalyticsConfig {
  /** Analytics Engine dataset binding */
  dataset?: AnalyticsEngineDataset;
  /** Default blobs to include with every data point */
  defaultBlobs?: string[];
}

/**
 * Cloudflare Analytics Engine wrapper
 * 
 * Provides a simple interface for writing metrics to Analytics Engine.
 * Analytics Engine is:
 * - Unlimited cardinality (no dimension limits)
 * - SQL queryable
 * - Realtime (seconds to query)
 * - Cost-effective (included in Workers paid plan)
 */
export class CloudflareAnalytics {
  private dataset?: AnalyticsEngineDataset;
  private defaultBlobs: string[];

  constructor(config: CloudflareAnalyticsConfig = {}) {
    this.dataset = config.dataset;
    this.defaultBlobs = config.defaultBlobs ?? [];
  }

  /**
   * Check if analytics is enabled
   */
  isEnabled(): boolean {
    return !!this.dataset;
  }

  /**
   * Write a data point to Analytics Engine
   */
  private write(dataPoint: AnalyticsDataPoint): void {
    if (!this.dataset) return;

    try {
      this.dataset.writeDataPoint({
        indexes: [dataPoint.index],
        blobs: [...this.defaultBlobs, ...(dataPoint.blobs ?? [])],
        doubles: dataPoint.doubles ?? [],
      });
    } catch (error) {
      // Don't throw on analytics failures
      console.error("Analytics write failed:", error);
    }
  }

  /**
   * Track a tool invocation
   * 
   * Metrics recorded:
   * - blob1: tool name
   * - blob2: account slug
   * - blob3: success/failure
   * - blob4: session ID
   * - double1: duration in ms
   * - double2: 1 (count)
   */
  trackToolInvocation(
    toolName: string,
    accountSlug: string,
    success: boolean,
    durationMs: number,
    sessionId?: string
  ): void {
    this.write({
      index: "tool_invocation",
      blobs: [
        toolName,
        accountSlug,
        success ? "success" : "failure",
        sessionId ?? "unknown",
      ],
      doubles: [durationMs, 1],
    });
  }

  /**
   * Track a session creation
   * 
   * Metrics recorded:
   * - blob1: session ID
   * - blob2: client name
   * - blob3: client version
   * - double1: 1 (count)
   */
  trackSessionCreated(
    sessionId: string,
    clientName?: string,
    clientVersion?: string
  ): void {
    this.write({
      index: "session_created",
      blobs: [
        sessionId,
        clientName ?? "unknown",
        clientVersion ?? "unknown",
      ],
      doubles: [1],
    });
  }

  /**
   * Track session initialization
   */
  trackSessionInitialized(
    sessionId: string,
    clientName?: string,
    clientVersion?: string
  ): void {
    this.write({
      index: "session_initialized",
      blobs: [
        sessionId,
        clientName ?? "unknown",
        clientVersion ?? "unknown",
      ],
      doubles: [1],
    });
  }

  /**
   * Track session expiration
   * 
   * Metrics recorded:
   * - blob1: session ID
   * - double1: session duration in seconds
   * - double2: 1 (count)
   */
  trackSessionExpired(sessionId: string, durationSeconds: number): void {
    this.write({
      index: "session_expired",
      blobs: [sessionId],
      doubles: [durationSeconds, 1],
    });
  }

  /**
   * Track an error
   * 
   * Metrics recorded:
   * - blob1: error type/category
   * - blob2: error message (truncated)
   * - blob3: session ID
   * - blob4: context (tool name, endpoint, etc.)
   * - double1: error code
   * - double2: 1 (count)
   */
  trackError(
    errorType: string,
    errorMessage: string,
    errorCode: number = -1,
    context?: string,
    sessionId?: string
  ): void {
    this.write({
      index: "error",
      blobs: [
        errorType,
        errorMessage.slice(0, 1024), // Truncate to max blob size
        sessionId ?? "unknown",
        context ?? "unknown",
      ],
      doubles: [errorCode, 1],
    });
  }

  /**
   * Track an incoming request
   * 
   * Metrics recorded:
   * - blob1: HTTP method
   * - blob2: endpoint path
   * - blob3: session ID
   * - blob4: status category (2xx, 4xx, 5xx)
   * - double1: response status code
   * - double2: response time in ms
   * - double3: 1 (count)
   */
  trackRequest(
    method: string,
    path: string,
    statusCode: number,
    durationMs: number,
    sessionId?: string
  ): void {
    const statusCategory = 
      statusCode >= 500 ? "5xx" :
      statusCode >= 400 ? "4xx" :
      statusCode >= 300 ? "3xx" :
      statusCode >= 200 ? "2xx" : "other";

    this.write({
      index: "request",
      blobs: [method, path, sessionId ?? "unknown", statusCategory],
      doubles: [statusCode, durationMs, 1],
    });
  }

  /**
   * Track multiple tool invocations in a batch
   * Useful for reporting at the end of a request
   */
  trackToolBatch(
    invocations: Array<{
      toolName: string;
      accountSlug: string;
      success: boolean;
      durationMs: number;
      sessionId?: string;
    }>
  ): void {
    for (const inv of invocations) {
      this.trackToolInvocation(
        inv.toolName,
        inv.accountSlug,
        inv.success,
        inv.durationMs,
        inv.sessionId
      );
    }
  }
}

/**
 * Create an analytics instance
 */
export function createAnalytics(
  dataset?: AnalyticsEngineDataset,
  defaultBlobs?: string[]
): CloudflareAnalytics {
  return new CloudflareAnalytics({ dataset, defaultBlobs });
}

/**
 * Example SQL queries for Analytics Engine
 * 
 * These can be run via the Cloudflare Dashboard or API
 * 
 * -- Tool invocation counts by tool name (last 24 hours)
 * SELECT
 *   blob1 AS tool_name,
 *   SUM(_sample_interval * double2) AS invocations,
 *   AVG(double1) AS avg_duration_ms,
 *   SUM(CASE WHEN blob3 = 'failure' THEN _sample_interval ELSE 0 END) AS failures
 * FROM fizzy_mcp_analytics
 * WHERE index1 = 'tool_invocation'
 *   AND timestamp > NOW() - INTERVAL '24' HOUR
 * GROUP BY blob1
 * ORDER BY invocations DESC
 * 
 * -- Error rates by type (last 24 hours)
 * SELECT
 *   blob1 AS error_type,
 *   SUM(_sample_interval * double2) AS error_count,
 *   AVG(double1) AS avg_error_code
 * FROM fizzy_mcp_analytics
 * WHERE index1 = 'error'
 *   AND timestamp > NOW() - INTERVAL '24' HOUR
 * GROUP BY blob1
 * ORDER BY error_count DESC
 * 
 * -- Session metrics (last 7 days)
 * SELECT
 *   toDate(timestamp) AS date,
 *   SUM(CASE WHEN index1 = 'session_created' THEN _sample_interval ELSE 0 END) AS sessions_created,
 *   SUM(CASE WHEN index1 = 'session_initialized' THEN _sample_interval ELSE 0 END) AS sessions_initialized,
 *   SUM(CASE WHEN index1 = 'session_expired' THEN _sample_interval ELSE 0 END) AS sessions_expired
 * FROM fizzy_mcp_analytics
 * WHERE index1 IN ('session_created', 'session_initialized', 'session_expired')
 *   AND timestamp > NOW() - INTERVAL '7' DAY
 * GROUP BY date
 * ORDER BY date DESC
 * 
 * -- Request latency percentiles (last hour)
 * SELECT
 *   blob2 AS endpoint,
 *   quantile(0.5)(double2) AS p50_ms,
 *   quantile(0.95)(double2) AS p95_ms,
 *   quantile(0.99)(double2) AS p99_ms,
 *   SUM(_sample_interval * double3) AS request_count
 * FROM fizzy_mcp_analytics
 * WHERE index1 = 'request'
 *   AND timestamp > NOW() - INTERVAL '1' HOUR
 * GROUP BY blob2
 * ORDER BY request_count DESC
 */



