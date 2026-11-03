import type { Database } from "bun:sqlite";
import type { Settings } from "./types";

export type SettingsFieldType = "number" | "boolean";

export interface SettingsField {
  path: string;
  group: keyof Settings;
  label: string;
  description: string;
  type: SettingsFieldType;
  default: number | boolean;
  min?: number;
  max?: number;
  step?: number;
}

export const SETTINGS_SCHEMA: SettingsField[] = [
  {
    path: "routing.failureThreshold",
    group: "routing",
    label: "Failures before auto-disable",
    description: "Consecutive request or probe failures before a provider is taken out of rotation.",
    type: "number",
    default: 3,
    min: 1,
    max: 100,
  },
  {
    path: "routing.healthCheckIntervalSeconds",
    group: "routing",
    label: "Health check interval",
    description: "How often unhealthy and unknown providers are probed. Successful probes re-enable them.",
    type: "number",
    default: 300,
    min: 10,
    max: 86_400,
  },
  {
    path: "routing.probeTimeoutMs",
    group: "routing",
    label: "Probe timeout (ms)",
    description: "Maximum time a health probe may take.",
    type: "number",
    default: 5_000,
    min: 500,
    max: 60_000,
    step: 500,
  },
  {
    path: "routing.requestTimeoutMs",
    group: "routing",
    label: "Request timeout (ms)",
    description: "Maximum time an upstream search or proxy request may take.",
    type: "number",
    default: 30_000,
    min: 1_000,
    max: 300_000,
    step: 1_000,
  },
  {
    path: "routing.totalTimeoutMs",
    group: "routing",
    label: "Total request budget (ms)",
    description: "Overall time budget for all provider attempts, including failover.",
    type: "number",
    default: 60_000,
    min: 1_000,
    max: 600_000,
    step: 1_000,
  },
  {
    path: "routing.maxAttempts",
    group: "routing",
    label: "Maximum provider attempts",
    description: "0 means try every eligible provider in priority order.",
    type: "number",
    default: 0,
    min: 0,
    max: 50,
  },
  {
    path: "routing.lastResortEnabled",
    group: "routing",
    label: "Last-resort failover",
    description: "If no healthy provider works, retry auto-disabled providers before returning an error.",
    type: "boolean",
    default: true,
  },
  {
    path: "routing.probeHealthy",
    group: "routing",
    label: "Probe healthy providers too",
    description: "Also run periodic probes against providers currently marked healthy.",
    type: "boolean",
    default: false,
  },
  {
    path: "routing.autoRecoverEnabled",
    group: "routing",
    label: "Automatic recovery",
    description: "Automatically re-enable a provider when its health probe succeeds.",
    type: "boolean",
    default: true,
  },
  {
    path: "logging.retentionDays",
    group: "logging",
    label: "Log retention (days)",
    description: "Delete request logs older than this.",
    type: "number",
    default: 90,
    min: 1,
    max: 3_650,
  },
  {
    path: "logging.logBodies",
    group: "logging",
    label: "Log request and response bodies",
    description: "Store truncated, redacted bodies for debugging.",
    type: "boolean",
    default: true,
  },
  {
    path: "logging.maxBodyChars",
    group: "logging",
    label: "Maximum logged body size",
    description: "Characters kept per request or response body.",
    type: "number",
    default: 100_000,
    min: 1_000,
    max: 1_000_000,
    step: 1_000,
  },
  {
    path: "auth.enabled",
    group: "auth",
    label: "Require login",
    description: "Require a session for the dashboard and a router API key for proxied requests.",
    type: "boolean",
    default: false,
  },
  {
    path: "auth.sessionDays",
    group: "auth",
    label: "Session lifetime (days)",
    description: "How long a dashboard login remains valid.",
    type: "number",
    default: 7,
    min: 1,
    max: 365,
  },
  {
    path: "rateLimit.enabled",
    group: "rateLimit",
    label: "Enable rate limiting",
    description: "Apply a per-key sliding window to proxied requests.",
    type: "boolean",
    default: false,
  },
  {
    path: "rateLimit.rpm",
    group: "rateLimit",
    label: "Requests per minute",
    description: "Maximum proxied requests per API key per minute.",
    type: "number",
    default: 60,
    min: 1,
    max: 100_000,
  },
];

export const DEFAULT_SETTINGS: Settings = {
  routing: {
    failureThreshold: 3,
    healthCheckIntervalSeconds: 300,
    probeTimeoutMs: 5_000,
    requestTimeoutMs: 30_000,
    totalTimeoutMs: 60_000,
    maxAttempts: 0,
    lastResortEnabled: true,
    probeHealthy: false,
    autoRecoverEnabled: true,
  },
  logging: {
    retentionDays: 90,
    logBodies: true,
    maxBodyChars: 100_000,
  },
  auth: {
    enabled: false,
    sessionDays: 7,
  },
  rateLimit: {
    enabled: false,
    rpm: 60,
  },
};

const FIELD_BY_PATH = new Map(SETTINGS_SCHEMA.map((field) => [field.path, field]));

export class SettingsValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "SettingsValidationError";
  }
}

function cloneDefaults(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
}

function setPath(target: Settings, path: string, value: number | boolean): void {
  const [group, key] = path.split(".") as [keyof Settings, string];
  (target[group] as unknown as Record<string, number | boolean>)[key] = value;
}

function getPathValue(settings: Settings, path: string): number | boolean {
  const [group, key] = path.split(".") as [keyof Settings, string];
  return (settings[group] as unknown as Record<string, number | boolean>)[key];
}

function validateValue(field: SettingsField, value: unknown): string | null {
  if (field.type === "boolean") {
    if (typeof value !== "boolean") return `${field.path} must be a boolean`;
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `${field.path} must be a number`;
  }
  if (!Number.isInteger(value)) {
    return `${field.path} must be an integer`;
  }
  if (field.min !== undefined && value < field.min) {
    return `${field.path} must be at least ${field.min}`;
  }
  if (field.max !== undefined && value > field.max) {
    return `${field.path} must be at most ${field.max}`;
  }
  return null;
}

function flattenPatch(patch: Record<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(patch)) {
    if (key.includes(".")) {
      out.set(key, value);
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        out.set(`${key}.${childKey}`, childValue);
      }
      continue;
    }
    out.set(key, value);
  }
  return out;
}

export class SettingsService {
  private cache: Settings;

  constructor(
    private readonly db: Database,
    private readonly onChange?: (settings: Settings) => void,
  ) {
    this.cache = this.loadFromDb();
  }

  private loadFromDb(): Settings {
    const settings = cloneDefaults();
    const rows = this.db
      .prepare("SELECT key, value FROM settings")
      .all() as { key: string; value: string }[];

    for (const row of rows) {
      const field = FIELD_BY_PATH.get(row.key);
      if (!field) continue;
      try {
        const value = JSON.parse(row.value);
        if (validateValue(field, value) === null) {
          setPath(settings, row.key, value);
        }
      } catch {
        // Ignore corrupt individual settings and fall back to the default.
      }
    }

    this.persistDefaults(settings);
    return settings;
  }

  private persistDefaults(settings: Settings): void {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
    );
    for (const field of SETTINGS_SCHEMA) {
      insert.run(field.path, JSON.stringify(getPathValue(settings, field.path)));
    }
  }

  get(): Settings {
    return structuredClone(this.cache);
  }

  update(patch: Record<string, unknown>): Settings {
    const flat = flattenPatch(patch);
    const issues: string[] = [];
    const next = structuredClone(this.cache);

    for (const [path, value] of flat) {
      const field = FIELD_BY_PATH.get(path);
      if (!field) {
        issues.push(`Unknown setting: ${path}`);
        continue;
      }
      const issue = validateValue(field, value);
      if (issue) {
        issues.push(issue);
        continue;
      }
      setPath(next, path, value as number | boolean);
    }

    if (issues.length > 0) {
      throw new SettingsValidationError(issues);
    }

    const write = this.db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    this.db.transaction(() => {
      for (const path of flat.keys()) {
        write.run(path, JSON.stringify(getPathValue(next, path)));
      }
    })();

    this.cache = next;
    this.onChange?.(this.get());
    return this.get();
  }

  reset(): Settings {
    const settings = cloneDefaults();
    const write = this.db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    this.db.transaction(() => {
      for (const field of SETTINGS_SCHEMA) {
        write.run(field.path, JSON.stringify(getPathValue(settings, field.path)));
      }
    })();
    this.cache = settings;
    this.onChange?.(this.get());
    return this.get();
  }

  schema(): SettingsField[] {
    return structuredClone(SETTINGS_SCHEMA);
  }
}

export function settingsToApi(settings: Settings): Settings {
  return structuredClone(settings);
}
