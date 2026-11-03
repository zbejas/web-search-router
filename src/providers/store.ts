import type { Database } from "bun:sqlite";
import type {
  Capability,
  CreditState,
  FailureKind,
  Provider,
  ProviderEvent,
  ProviderInput,
  ProviderRecord,
  Settings,
} from "../types";
import type { SecretBox } from "../crypto";
import { keyHint } from "../crypto";
import { getAdapter, isProviderType } from "../providers/registry";
import { normalizeBaseUrl, nowIso, slugify } from "../utils";

interface ProviderRow {
  id: string;
  name: string;
  type: string;
  base_url: string;
  api_key: string | null;
  api_key_hint: string | null;
  priority: number;
  enabled: number;
  health: string;
  consecutive_failures: number;
  last_checked_at: string | null;
  last_healthy_at: string | null;
  last_error: string | null;
  last_status_code: number | null;
  last_latency_ms: number | null;
  credits_remaining: number | null;
  credits_plan: number | null;
  credits_period_end: string | null;
  credits_checked_at: string | null;
  capabilities: string;
  config: string;
  probe_interval_seconds: number | null;
  created_at: string;
  updated_at: string;
}

interface ProviderStatRow {
  provider_id: string;
  count: number;
  success: number;
  avg_latency: number | null;
}

export class ProviderValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "ProviderValidationError";
  }
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function rowToRecord(row: ProviderRow, apiKey: string | null): ProviderRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ProviderRecord["type"],
    baseUrl: row.base_url,
    apiKey,
    apiKeyEncrypted: row.api_key,
    apiKeyHint: row.api_key_hint,
    priority: row.priority,
    enabled: row.enabled === 1,
    health: row.health as ProviderRecord["health"],
    consecutiveFailures: row.consecutive_failures,
    lastCheckedAt: row.last_checked_at,
    lastHealthyAt: row.last_healthy_at,
    lastError: row.last_error,
    lastStatusCode: row.last_status_code,
    lastLatencyMs: row.last_latency_ms,
    creditsRemaining: row.credits_remaining,
    creditsPlan: row.credits_plan,
    creditsPeriodEnd: row.credits_period_end,
    creditsCheckedAt: row.credits_checked_at,
    capabilities: parseJson<Capability[]>(row.capabilities, []),
    config: parseJson<Record<string, unknown>>(row.config, {}),
    probeIntervalSeconds: row.probe_interval_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function recordToPublic(
  record: ProviderRecord,
  stat?: ProviderStatRow,
): Provider {
  const { apiKey: _apiKey, apiKeyEncrypted: _encrypted, ...rest } = record;
  return {
    ...rest,
    apiKeySet: Boolean(record.apiKeyEncrypted),
    requestCount: stat?.count ?? 0,
    successRate: stat && stat.count > 0 ? stat.success / stat.count : 0,
    avgLatencyMs: stat?.avg_latency ? Math.round(stat.avg_latency) : 0,
  };
}

function defaultCapabilities(input: ProviderInput): Capability[] {
  return getAdapter(input.type).metadata.capabilities;
}

export class ProviderStore {
  constructor(
    private readonly db: Database,
    private readonly secretBox: SecretBox,
  ) {}

  private rows(): ProviderRow[] {
    return this.db
      .prepare("SELECT * FROM providers ORDER BY priority DESC, name ASC")
      .all() as ProviderRow[];
  }

  private stats(): Map<string, ProviderStatRow> {
    const rows = this.db
      .prepare(
        `SELECT provider_id, COUNT(*) as count,
                SUM(CASE WHEN response_status >= 200 AND response_status < 300 THEN 1 ELSE 0 END) as success,
                AVG(duration_ms) as avg_latency
         FROM proxy_logs
         WHERE provider_id IS NOT NULL
         GROUP BY provider_id`,
      )
      .all() as ProviderStatRow[];
    return new Map(rows.map((row) => [row.provider_id, row]));
  }

  async listPublic(): Promise<Provider[]> {
    const stats = this.stats();
    return this.rows().map((row) =>
      recordToPublic(rowToRecord(row, null), stats.get(row.id)),
    );
  }

  async listInternal(): Promise<ProviderRecord[]> {
    const out: ProviderRecord[] = [];
    for (const row of this.rows()) {
      out.push(await this.decryptRow(row));
    }
    return out;
  }

  async getPublic(id: string): Promise<Provider | null> {
    const row = this.db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow | null;
    if (!row) return null;
    return recordToPublic(rowToRecord(row, null), this.stats().get(id));
  }

  async getInternal(id: string): Promise<ProviderRecord | null> {
    const row = this.db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow | null;
    if (!row) return null;
    return this.decryptRow(row);
  }

  private async decryptRow(row: ProviderRow): Promise<ProviderRecord> {
    let apiKey: string | null = null;
    if (row.api_key) {
      try {
        apiKey = await this.secretBox.decrypt(row.api_key);
      } catch (error) {
        console.error(`Could not decrypt API key for provider ${row.id}:`, error);
      }
    }
    return rowToRecord(row, apiKey);
  }

  private validate(input: ProviderInput): string[] {
    const issues: string[] = [];
    if (!isProviderType(input.type)) {
      issues.push("Provider type is invalid");
      return issues;
    }
    if (!input.baseUrl?.trim()) issues.push("Base URL is required");
    if (input.priority !== undefined && (!Number.isFinite(input.priority) || input.priority < 0)) {
      issues.push("Priority must be a non-negative number");
    }
    if (
      input.probeIntervalSeconds !== undefined &&
      input.probeIntervalSeconds !== null &&
      (!Number.isFinite(input.probeIntervalSeconds) || input.probeIntervalSeconds < 10)
    ) {
      issues.push("Probe interval must be at least 10 seconds");
    }
    issues.push(...getAdapter(input.type).validate(input));
    return issues;
  }

  async create(input: ProviderInput): Promise<Provider> {
    const issues = this.validate(input);
    if (issues.length > 0) throw new ProviderValidationError(issues);

    const baseId = slugify(input.id ?? input.name ?? `${input.type}-provider`);
    let id = baseId || crypto.randomUUID();
    if (input.id && this.db.prepare("SELECT id FROM providers WHERE id = ?").get(id)) {
      throw new ProviderValidationError([`Provider ID "${id}" already exists`]);
    }
    let suffix = 2;
    while (this.db.prepare("SELECT id FROM providers WHERE id = ?").get(id)) {
      id = `${baseId}-${suffix++}`;
    }

    const name = input.name?.trim() || id;
    const now = nowIso();
    const encrypted = input.apiKey ? await this.secretBox.encrypt(input.apiKey) : null;
    const hint = input.apiKey ? keyHint(input.apiKey) : null;
    const capabilities = defaultCapabilities(input);
    const config = input.config ?? {};

    this.db
      .prepare(
        `INSERT INTO providers (
          id, name, type, base_url, api_key, api_key_hint, priority, enabled,
          health, consecutive_failures, capabilities, config, probe_interval_seconds,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 0, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        name,
        input.type,
        normalizeBaseUrl(input.baseUrl),
        encrypted,
        hint,
        input.priority ?? 10,
        input.enabled === false ? 0 : 1,
        JSON.stringify(capabilities),
        JSON.stringify(config),
        input.probeIntervalSeconds ?? null,
        now,
        now,
      );

    this.addEvent(id, "created", `Provider created (${input.type})`);
    return (await this.getPublic(id))!;
  }

  async update(id: string, input: Partial<ProviderInput>): Promise<Provider | null> {
    const existing = await this.getInternal(id);
    if (!existing) return null;

    const merged: ProviderInput = {
      id,
      name: input.name ?? existing.name,
      type: input.type ?? existing.type,
      baseUrl: input.baseUrl ?? existing.baseUrl,
      apiKey: input.apiKey === undefined ? (existing.apiKey ?? undefined) : (input.apiKey ?? undefined),
      priority: input.priority ?? existing.priority,
      enabled: input.enabled ?? existing.enabled,
      config: input.config ?? existing.config,
      probeIntervalSeconds:
        input.probeIntervalSeconds === undefined
          ? existing.probeIntervalSeconds
          : input.probeIntervalSeconds,
    };

    const issues = this.validate(merged);
    if (issues.length > 0) throw new ProviderValidationError(issues);

    let encrypted = existing.apiKeyEncrypted;
    let hint = existing.apiKeyHint;
    if (input.apiKey !== undefined) {
      if (input.apiKey === null || input.apiKey === "") {
        encrypted = null;
        hint = null;
      } else {
        encrypted = await this.secretBox.encrypt(input.apiKey);
        hint = keyHint(input.apiKey);
      }
    }

    const typeChanged = merged.type !== existing.type;
    const capabilities = typeChanged
      ? defaultCapabilities(merged)
      : existing.capabilities;
    const enabledChanged = merged.enabled !== existing.enabled;
    const health = enabledChanged && merged.enabled ? "unknown" : existing.health;
    const clearCredits =
      merged.type !== "firecrawl" || input.apiKey === null || input.apiKey === "";

    this.db
      .prepare(
        `UPDATE providers SET
          name = ?, type = ?, base_url = ?, api_key = ?, api_key_hint = ?,
          priority = ?, enabled = ?, health = ?, capabilities = ?, config = ?,
          probe_interval_seconds = ?, credits_remaining = ?, credits_plan = ?,
          credits_period_end = ?, credits_checked_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        merged.name!.trim(),
        merged.type,
        normalizeBaseUrl(merged.baseUrl),
        encrypted,
        hint,
        merged.priority ?? 10,
        merged.enabled ? 1 : 0,
        health,
        JSON.stringify(capabilities),
        JSON.stringify(merged.config ?? {}),
        merged.probeIntervalSeconds ?? null,
        clearCredits ? null : existing.creditsRemaining,
        clearCredits ? null : existing.creditsPlan,
        clearCredits ? null : existing.creditsPeriodEnd,
        clearCredits ? null : existing.creditsCheckedAt,
        nowIso(),
        id,
      );

    if (enabledChanged) {
      this.addEvent(
        id,
        merged.enabled ? "manual_enabled" : "manual_disabled",
        merged.enabled ? "Provider enabled by operator" : "Provider disabled by operator",
      );
    } else {
      this.addEvent(id, "updated", "Provider configuration updated");
    }

    return this.getPublic(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM providers WHERE id = ?").run(id);
    if (result.changes > 0) {
      this.db.prepare("DELETE FROM provider_events WHERE provider_id = ?").run(id);
      return true;
    }
    return false;
  }

  async setEnabled(id: string, enabled: boolean): Promise<Provider | null> {
    return this.update(id, { enabled });
  }

  async reorder(ids: string[]): Promise<Provider[]> {
    const update = this.db.prepare(
      "UPDATE providers SET priority = ?, updated_at = ? WHERE id = ?",
    );
    const now = nowIso();
    const total = ids.length;
    this.db.transaction(() => {
      ids.forEach((id, index) => {
        update.run((total - index) * 10, now, id);
      });
    })();
    return this.listPublic();
  }

  async recordSuccess(
    id: string,
    statusCode: number | null,
    latencyMs: number,
  ): Promise<ProviderRecord | null> {
    const existing = await this.getInternal(id);
    if (!existing) return null;

    const wasUnhealthy = existing.health === "unhealthy";
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE providers SET
          health = 'healthy', consecutive_failures = 0, last_checked_at = ?,
          last_healthy_at = ?, last_error = NULL, last_status_code = ?,
          last_latency_ms = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(now, now, statusCode, latencyMs, now, id);

    if (wasUnhealthy) {
      this.addEvent(id, "auto_enabled", "Provider recovered after a successful request", statusCode, latencyMs);
    }
    return this.getInternal(id);
  }

  async recordFailure(
    id: string,
    kind: FailureKind,
    statusCode: number | null,
    error: string,
    latencyMs: number,
    settings: Settings,
  ): Promise<ProviderRecord | null> {
    const existing = await this.getInternal(id);
    if (!existing) return null;

    const failures = existing.consecutiveFailures + 1;
    const shouldDisable =
      failures >= settings.routing.failureThreshold && existing.health !== "unhealthy";
    const health = shouldDisable ? "unhealthy" : existing.health;
    const now = nowIso();

    this.db
      .prepare(
        `UPDATE providers SET
          consecutive_failures = ?, health = ?, last_checked_at = ?,
          last_error = ?, last_status_code = ?, last_latency_ms = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(failures, health, now, error, statusCode, latencyMs, now, id);

    if (shouldDisable) {
      this.addEvent(
        id,
        "auto_disabled",
        `${failures} consecutive failures (${kind}). Last error: ${error}`,
        statusCode,
        latencyMs,
      );
    }
    return this.getInternal(id);
  }

  async recordProbe(
    id: string,
    result: {
      ok: boolean;
      statusCode: number | null;
      error: string | null;
      latencyMs: number;
      failureKind: FailureKind | null;
      credits?: CreditState | null;
    },
    settings: Settings,
    options: { forceRecover?: boolean } = {},
  ): Promise<{ provider: ProviderRecord | null; transition: "recovered" | "failed" | "none" }> {
    const existing = await this.getInternal(id);
    if (!existing) return { provider: null, transition: "none" };
    const now = nowIso();
    const canRecover = options.forceRecover || settings.routing.autoRecoverEnabled;
    const credits = result.credits ?? null;
    const creditsRemaining = credits ? credits.remainingCredits : existing.creditsRemaining;
    const creditsPlan = credits ? credits.planCredits : existing.creditsPlan;
    const creditsPeriodEnd = credits ? credits.periodEnd : existing.creditsPeriodEnd;
    const creditsCheckedAt = credits ? now : existing.creditsCheckedAt;

    if (result.ok) {
      const shouldRecover = existing.health !== "healthy" && canRecover;
      const health = shouldRecover ? "healthy" : existing.health;
      this.db
        .prepare(
          `UPDATE providers SET
            health = ?, consecutive_failures = ?, last_checked_at = ?,
            last_healthy_at = ?, last_error = NULL, last_status_code = ?,
            last_latency_ms = ?, credits_remaining = ?, credits_plan = ?,
            credits_period_end = ?, credits_checked_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          health,
          0,
          now,
          now,
          result.statusCode,
          result.latencyMs,
          creditsRemaining,
          creditsPlan,
          creditsPeriodEnd,
          creditsCheckedAt,
          now,
          id,
        );
      if (shouldRecover) {
        this.addEvent(id, "auto_enabled", "Provider passed a health probe", result.statusCode, result.latencyMs);
        return { provider: await this.getInternal(id), transition: "recovered" };
      }
      return { provider: await this.getInternal(id), transition: "none" };
    }

    const failures = existing.consecutiveFailures + 1;
    const shouldDisable =
      failures >= settings.routing.failureThreshold && existing.health !== "unhealthy";
    const health = shouldDisable ? "unhealthy" : existing.health;
    this.db
      .prepare(
        `UPDATE providers SET
          consecutive_failures = ?, health = ?, last_checked_at = ?,
          last_error = ?, last_status_code = ?, last_latency_ms = ?,
          credits_remaining = ?, credits_plan = ?, credits_period_end = ?,
          credits_checked_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        failures,
        health,
        now,
        result.error ?? "Probe failed",
        result.statusCode,
        result.latencyMs,
        creditsRemaining,
        creditsPlan,
        creditsPeriodEnd,
        creditsCheckedAt,
        now,
        id,
      );

    if (shouldDisable) {
      this.addEvent(
        id,
        "auto_disabled",
        `Health probe failed (${result.failureKind ?? "unknown"}): ${result.error ?? "unknown error"}`,
        result.statusCode,
        result.latencyMs,
      );
      return { provider: await this.getInternal(id), transition: "failed" };
    }
    return { provider: await this.getInternal(id), transition: "none" };
  }

  addEvent(
    providerId: string,
    event: string,
    message: string | null = null,
    statusCode: number | null = null,
    latencyMs: number | null = null,
  ): void {
    this.db
      .prepare(
        "INSERT INTO provider_events (provider_id, event, message, status_code, latency_ms, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(providerId, event, message, statusCode, latencyMs, nowIso());
  }

  async events(providerId: string, limit = 50): Promise<ProviderEvent[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM provider_events WHERE provider_id = ? ORDER BY id DESC LIMIT ?",
      )
      .all(providerId, limit) as {
      id: number;
      provider_id: string;
      timestamp: string;
      event: string;
      message: string | null;
      status_code: number | null;
      latency_ms: number | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      providerId: row.provider_id,
      timestamp: row.timestamp,
      event: row.event,
      message: row.message,
      statusCode: row.status_code,
      latencyMs: row.latency_ms,
    }));
  }

  async recentEvents(limit = 20): Promise<(ProviderEvent & { providerName: string })[]> {
    const rows = this.db
      .prepare(
        `SELECT e.*, p.name as provider_name
         FROM provider_events e
         LEFT JOIN providers p ON p.id = e.provider_id
         ORDER BY e.id DESC LIMIT ?`,
      )
      .all(limit) as {
      id: number;
      provider_id: string;
      provider_name: string | null;
      timestamp: string;
      event: string;
      message: string | null;
      status_code: number | null;
      latency_ms: number | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      providerId: row.provider_id,
      providerName: row.provider_name ?? row.provider_id,
      timestamp: row.timestamp,
      event: row.event,
      message: row.message,
      statusCode: row.status_code,
      latencyMs: row.latency_ms,
    }));
  }
}
