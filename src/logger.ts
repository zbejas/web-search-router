import type { Database } from "bun:sqlite";
import type {
  LogEntry,
  LogStats,
  RequestLogInput,
  RouteAttempt,
} from "./types";
import type { SettingsService } from "./settings";
import {
  redactHeaders,
  redactJson,
  safeJsonParse,
  truncate,
} from "./utils";

interface LogRow {
  id: number;
  timestamp: string;
  request_id: string | null;
  request_method: string;
  request_path: string;
  request_query: string | null;
  request_headers: string | null;
  request_body: string | null;
  operation: string | null;
  endpoint_id: string | null;
  endpoint_url: string | null;
  provider_id: string | null;
  provider_type: string | null;
  attempts: string | null;
  response_status: number | null;
  response_headers: string | null;
  response_body: string | null;
  duration_ms: number | null;
  error: string | null;
  error_kind: string | null;
  key_id: string | null;
  client_ip: string | null;
}

export interface LogQuery {
  from?: string;
  to?: string;
  provider_id?: string;
  key_id?: string;
  status?: number | null;
  operation?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

function rowToEntry(row: LogRow): LogEntry {
  const attempts = safeJsonParse<RouteAttempt[]>(row.attempts) ?? [];
  return {
    id: row.id,
    timestamp: row.timestamp,
    requestId: row.request_id ?? "",
    method: row.request_method,
    path: row.request_path,
    query: row.request_query ?? "",
    requestHeaders: safeJsonParse<Record<string, string>>(row.request_headers) ?? {},
    requestBody: row.request_body,
    operation: (row.operation ?? "proxy") as LogEntry["operation"],
    providerId: row.provider_id ?? row.endpoint_id,
    providerType: (row.provider_type ?? null) as LogEntry["providerType"],
    attempts,
    responseStatus: row.response_status,
    responseHeaders: safeJsonParse<Record<string, string>>(row.response_headers) ?? {},
    responseBody: row.response_body,
    durationMs: row.duration_ms ?? 0,
    error: row.error,
    errorKind: (row.error_kind ?? null) as LogEntry["errorKind"],
    keyId: row.key_id,
    clientIp: row.client_ip,
  };
}

function sqliteTimestamp(date = new Date()): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

function parseDbTimestamp(text: string): number {
  const normalized = text.includes("T") ? text : `${text.replace(" ", "T")}Z`;
  return new Date(normalized).getTime();
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * fraction)));
  return sorted[index] ?? 0;
}

export class Logger {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  log(input: RequestLogInput): number {
    const settings = this.settings.get().logging;
    const requestHeaders = JSON.stringify(redactHeaders(input.requestHeaders));
    const responseHeaders = JSON.stringify(redactHeaders(input.responseHeaders));
    const requestBody = settings.logBodies
      ? this.safeBody(input.requestBody, settings.maxBodyChars)
      : null;
    const responseBody = settings.logBodies
      ? this.safeBody(input.responseBody, settings.maxBodyChars)
      : null;

    const result = this.db
      .prepare(
        `INSERT INTO proxy_logs (
          timestamp, request_id, request_method, request_path, request_query,
          request_headers, request_body, operation, endpoint_id, endpoint_url,
          provider_id, provider_type, attempts, response_status, response_headers,
          response_body, duration_ms, error, error_kind, key_id, client_ip
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sqliteTimestamp(),
        input.requestId,
        input.method,
        input.path,
        input.query,
        requestHeaders,
        requestBody,
        input.operation,
        input.providerId,
        null,
        input.providerId,
        input.providerType,
        JSON.stringify(input.attempts),
        input.responseStatus,
        responseHeaders,
        responseBody,
        input.durationMs,
        input.error,
        input.errorKind,
        input.keyId,
        input.clientIp,
      );
    return Number(result.lastInsertRowid);
  }

  private safeBody(text: string | null, maxChars: number): string | null {
    if (!text) return null;
    const parsed = safeJsonParse(text);
    if (parsed !== null) {
      return truncate(JSON.stringify(redactJson(parsed)), maxChars);
    }
    return truncate(text, maxChars);
  }

  query(filters: LogQuery): { rows: LogEntry[]; total: number } {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filters.from) {
      conditions.push("timestamp >= ?");
      params.push(filters.from);
    }
    if (filters.to) {
      conditions.push("timestamp <= ?");
      params.push(filters.to);
    }
    if (filters.provider_id) {
      conditions.push("(provider_id = ? OR endpoint_id = ?)");
      params.push(filters.provider_id, filters.provider_id);
    }
    if (filters.key_id) {
      conditions.push("key_id = ?");
      params.push(filters.key_id);
    }
    if (filters.operation) {
      conditions.push("operation = ?");
      params.push(filters.operation);
    }
    if (filters.search) {
      conditions.push("(request_path LIKE ? OR request_body LIKE ? OR response_body LIKE ? OR error LIKE ?)");
      const term = `%${filters.search}%`;
      params.push(term, term, term, term);
    }
    if (filters.status !== undefined) {
      if (filters.status === null) {
        conditions.push("(response_status IS NULL OR response_status >= 400 OR error IS NOT NULL)");
      } else {
        conditions.push("response_status = ?");
        params.push(filters.status);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = (
      this.db.prepare(`SELECT COUNT(*) as c FROM proxy_logs ${where}`).get(...params) as {
        c: number;
      }
    ).c;
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
    const offset = Math.max(filters.offset ?? 0, 0);
    const rows = this.db
      .prepare(`SELECT * FROM proxy_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as LogRow[];

    return { rows: rows.map(rowToEntry), total };
  }

  stats(): LogStats {
    const window = `-${this.settings.get().logging.retentionDays} days`;
    const summary = this.db
      .prepare(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN response_status >= 200 AND response_status < 300 THEN 1 ELSE 0 END) as success,
                SUM(CASE WHEN response_status >= 400 OR error IS NOT NULL THEN 1 ELSE 0 END) as errors,
                AVG(duration_ms) as avg_duration
         FROM proxy_logs WHERE timestamp >= datetime('now', ?)`,
      )
      .get(window) as {
      total: number;
      success: number | null;
      errors: number | null;
      avg_duration: number | null;
    };

    const durations = (
      this.db
        .prepare(
          `SELECT duration_ms FROM proxy_logs
           WHERE timestamp >= datetime('now', ?) AND duration_ms IS NOT NULL
           ORDER BY duration_ms`,
        )
        .all(window) as { duration_ms: number }[]
    ).map((row) => row.duration_ms);
    const sorted = durations.sort((a, b) => a - b);

    const perProvider = this.db
      .prepare(
        `SELECT COALESCE(provider_id, endpoint_id) as provider_id,
                COUNT(*) as count,
                SUM(CASE WHEN response_status >= 200 AND response_status < 300 THEN 1 ELSE 0 END) as success,
                AVG(duration_ms) as avg_latency
         FROM proxy_logs
         WHERE timestamp >= datetime('now', ?) AND COALESCE(provider_id, endpoint_id) IS NOT NULL
         GROUP BY COALESCE(provider_id, endpoint_id)`,
      )
      .all(window) as {
      provider_id: string;
      count: number;
      success: number;
      avg_latency: number | null;
    }[];

    return {
      total: summary.total,
      successCount: summary.success ?? 0,
      errorCount: summary.errors ?? 0,
      avgDurationMs: Math.round(summary.avg_duration ?? 0),
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      perProvider: perProvider.map((row) => ({
        providerId: row.provider_id,
        count: row.count,
        successRate: row.count > 0 ? row.success / row.count : 0,
        avgLatencyMs: Math.round(row.avg_latency ?? 0),
      })),
    };
  }

  timeseries(minutes = 60, bucketMinutes = 5): { buckets: { time: string; requests: number; errors: number; p50: number; p95: number }[] } {
    const window = `-${Math.min(Math.max(minutes, 1), 1_440)} minutes`;
    const bucket = Math.min(Math.max(bucketMinutes, 1), 60);
    const rows = this.db
      .prepare(
        `SELECT timestamp, duration_ms,
                CASE WHEN response_status >= 400 OR error IS NOT NULL THEN 1 ELSE 0 END as is_error
         FROM proxy_logs WHERE timestamp >= datetime('now', ?) ORDER BY timestamp`,
      )
      .all(window) as { timestamp: string; duration_ms: number | null; is_error: number }[];

    const bucketMs = bucket * 60_000;
    const groups = new Map<number, { durations: number[]; errors: number }>();
    for (const row of rows) {
      const timestamp = parseDbTimestamp(row.timestamp);
      if (!Number.isFinite(timestamp)) continue;
      const key = Math.floor(timestamp / bucketMs) * bucketMs;
      const group = groups.get(key) ?? { durations: [], errors: 0 };
      if (row.duration_ms !== null) group.durations.push(row.duration_ms);
      if (row.is_error) group.errors++;
      groups.set(key, group);
    }

    const now = Date.now();
    const end = Math.floor(now / bucketMs) * bucketMs;
    const buckets: { time: string; requests: number; errors: number; p50: number; p95: number }[] = [];
    for (let key = end - bucketMs * (Math.ceil(minutes / bucket) - 1); key <= end; key += bucketMs) {
      const group = groups.get(key) ?? { durations: [], errors: 0 };
      const sorted = group.durations.sort((a, b) => a - b);
      buckets.push({
        time: new Date(key).toISOString(),
        requests: sorted.length,
        errors: group.errors,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
      });
    }
    return { buckets };
  }

  dailyTimeseries(days = 30): { buckets: { date: string; requests: number; errors: number; p50: number; p95: number }[] } {
    const window = `-${Math.min(Math.max(days, 1), 365)} days`;
    const rows = this.db
      .prepare(
        `SELECT strftime('%Y-%m-%d', timestamp) as date, duration_ms,
                CASE WHEN response_status >= 400 OR error IS NOT NULL THEN 1 ELSE 0 END as is_error
         FROM proxy_logs WHERE timestamp >= datetime('now', ?) ORDER BY date`,
      )
      .all(window) as { date: string; duration_ms: number | null; is_error: number }[];

    const groups = new Map<string, { durations: number[]; errors: number }>();
    for (const row of rows) {
      const group = groups.get(row.date) ?? { durations: [], errors: 0 };
      if (row.duration_ms !== null) group.durations.push(row.duration_ms);
      if (row.is_error) group.errors++;
      groups.set(row.date, group);
    }

    return {
      buckets: [...groups.entries()].map(([date, group]) => {
        const sorted = group.durations.sort((a, b) => a - b);
        return {
          date,
          requests: sorted.length,
          errors: group.errors,
          p50: percentile(sorted, 0.5),
          p95: percentile(sorted, 0.95),
        };
      }),
    };
  }

  weeklyTimeseries(weeks = 12): { buckets: { week: string; requests: number; errors: number; p50: number; p95: number }[] } {
    const window = `-${Math.min(Math.max(weeks, 1), 52) * 7} days`;
    const rows = this.db
      .prepare(
        `SELECT strftime('%Y-%W', timestamp) as week, duration_ms,
                CASE WHEN response_status >= 400 OR error IS NOT NULL THEN 1 ELSE 0 END as is_error
         FROM proxy_logs WHERE timestamp >= datetime('now', ?) ORDER BY week`,
      )
      .all(window) as { week: string; duration_ms: number | null; is_error: number }[];

    const groups = new Map<string, { durations: number[]; errors: number }>();
    for (const row of rows) {
      const group = groups.get(row.week) ?? { durations: [], errors: 0 };
      if (row.duration_ms !== null) group.durations.push(row.duration_ms);
      if (row.is_error) group.errors++;
      groups.set(row.week, group);
    }

    return {
      buckets: [...groups.entries()].map(([week, group]) => {
        const sorted = group.durations.sort((a, b) => a - b);
        return {
          week,
          requests: sorted.length,
          errors: group.errors,
          p50: percentile(sorted, 0.5),
          p95: percentile(sorted, 0.95),
        };
      }),
    };
  }

  sourceTotals(): { sources: { providerId: string; total: number }[] } {
    const rows = this.db
      .prepare(
        `SELECT COALESCE(provider_id, endpoint_id) as provider_id, COUNT(*) as total
         FROM proxy_logs WHERE COALESCE(provider_id, endpoint_id) IS NOT NULL
         GROUP BY COALESCE(provider_id, endpoint_id) ORDER BY total DESC`,
      )
      .all() as { provider_id: string; total: number }[];
    return { sources: rows.map((row) => ({ providerId: row.provider_id, total: row.total })) };
  }

  cleanupOldLogs(): number {
    const days = this.settings.get().logging.retentionDays;
    const result = this.db
      .prepare("DELETE FROM proxy_logs WHERE timestamp < datetime('now', ?)")
      .run(`-${days} days`);
    return result.changes;
  }

  deleteAll(): void {
    this.db.exec("DELETE FROM proxy_logs");
  }
}
