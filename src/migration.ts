import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import type { SecretBox } from "./crypto";
import { keyHint } from "./crypto";
import type { SettingsService } from "./settings";
import type { Capability } from "./types";
import { normalizeBaseUrl, nowIso, slugify } from "./utils";

interface LegacyEndpoint {
  id: string;
  url: string;
  status?: string;
  lastCheck?: string | null;
  consecutiveFailures?: number;
  priority?: number;
  apiKey?: string;
  lastFailTime?: string;
  retryAfterSeconds?: number;
}

const FIRECRAWL_CAPABILITIES: Capability[] = [
  "search",
  "scrape",
  "crawl",
  "map",
  "extract",
  "batch_scrape",
  "proxy",
];

export async function migrateLegacyProviders(
  dataDir: string,
  db: Database,
  secretBox: SecretBox,
): Promise<number> {
  const count = (db.prepare("SELECT COUNT(*) as c FROM providers").get() as { c: number }).c;
  if (count > 0) return 0;

  const file = resolve(dataDir, "endpoints.json");
  if (!existsSync(file)) return 0;

  let endpoints: LegacyEndpoint[] = [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (Array.isArray(parsed)) endpoints = parsed as LegacyEndpoint[];
  } catch {
    return 0;
  }
  if (endpoints.length === 0) return 0;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO providers (
      id, name, type, base_url, api_key, api_key_hint, priority, enabled,
      health, consecutive_failures, last_checked_at, last_healthy_at, last_error,
      last_status_code, last_latency_ms, capabilities, config, created_at, updated_at
    ) VALUES (?, ?, 'firecrawl', ?, ?, ?, ?, 1, ?, ?, ?, NULL, NULL, NULL, NULL, ?, '{}', ?, ?)`,
  );
  const event = db.prepare(
    "INSERT INTO provider_events (provider_id, event, message, timestamp) VALUES (?, 'migrated', ?, ?)",
  );

  let migrated = 0;
  for (const endpoint of endpoints) {
    if (!endpoint?.id || !endpoint?.url) continue;
    const id = slugify(endpoint.id) || crypto.randomUUID();
    const encrypted = endpoint.apiKey ? await secretBox.encrypt(endpoint.apiKey) : null;
    const hint = endpoint.apiKey ? keyHint(endpoint.apiKey) : null;
    const status = endpoint.status ?? "unknown";
    const health =
      status === "online" ? "healthy" : status === "unknown" ? "unknown" : "unhealthy";
    const now = nowIso();
    const result = insert.run(
      id,
      endpoint.id,
      normalizeBaseUrl(endpoint.url),
      encrypted,
      hint,
      endpoint.priority ?? 10,
      health,
      endpoint.consecutiveFailures ?? 0,
      endpoint.lastCheck ?? null,
      JSON.stringify(FIRECRAWL_CAPABILITIES),
      endpoint.lastFailTime ?? now,
      now,
    );
    if (result.changes > 0) {
      migrated++;
      event.run(
        id,
        `Imported from legacy endpoints.json (status: ${status})`,
        now,
      );
    }
  }

  if (migrated > 0) {
    try {
      renameSync(file, `${file}.migrated`);
    } catch {
      // Keep the old file if it cannot be renamed.
    }
  }
  return migrated;
}

export function migrateLegacySettings(
  dataDir: string,
  settings: SettingsService,
): boolean {
  const file = resolve(dataDir, "settings.json");
  if (!existsSync(file)) return false;

  let legacy: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      legacy = parsed as Record<string, unknown>;
    }
  } catch {
    return false;
  }

  const mapped: Record<string, unknown> = {};

  if (typeof legacy.MAX_CONSECUTIVE_FAILURES === "number") {
    mapped["routing.failureThreshold"] = legacy.MAX_CONSECUTIVE_FAILURES;
  }
  if (typeof legacy.PROXY_TIMEOUT_MS === "number") {
    mapped["routing.requestTimeoutMs"] = legacy.PROXY_TIMEOUT_MS;
  }
  if (typeof legacy.PROBE_INTERVAL === "number") {
    mapped["routing.healthCheckIntervalSeconds"] = legacy.PROBE_INTERVAL;
  }
  if (typeof legacy.LOG_RETENTION_DAYS === "number") {
    mapped["logging.retentionDays"] = legacy.LOG_RETENTION_DAYS;
  }
  if (typeof legacy.AUTH_ENABLED === "boolean") {
    mapped["auth.enabled"] = legacy.AUTH_ENABLED;
  }
  if (typeof legacy.RATE_LIMIT_ENABLED === "boolean") {
    mapped["rateLimit.enabled"] = legacy.RATE_LIMIT_ENABLED;
  }
  if (typeof legacy.RATE_LIMIT_RPM === "number") {
    mapped["rateLimit.rpm"] = legacy.RATE_LIMIT_RPM;
  }

  // Remove keys that are not part of the new schema.
  const allowed = new Set([
    "routing.failureThreshold",
    "routing.requestTimeoutMs",
    "routing.healthCheckIntervalSeconds",
    "logging.retentionDays",
    "auth.enabled",
    "rateLimit.enabled",
    "rateLimit.rpm",
  ]);
  const filtered = Object.fromEntries(
    Object.entries(mapped).filter(([key]) => allowed.has(key)),
  );
  if (Object.keys(filtered).length === 0) return false;

  try {
    settings.update(filtered);
    renameSync(file, `${file}.migrated`);
    return true;
  } catch {
    return false;
  }
}
