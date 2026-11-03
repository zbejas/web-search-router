import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime } from "../../src/app";
import { createRuntimeConfig } from "../../src/config";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wsr-migrate-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("legacy migration", () => {
  test("imports endpoints.json, encrypts keys, and migrates settings.json", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "endpoints.json"),
      JSON.stringify([
        {
          id: "legacy-firecrawl",
          url: "https://api.firecrawl.dev/",
          status: "quarantined",
          lastCheck: "2026-01-01T00:00:00.000Z",
          consecutiveFailures: 4,
          priority: 77,
          apiKey: "fc-legacy-secret",
        },
      ]),
    );
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({
        MAX_CONSECUTIVE_FAILURES: 7,
        PROBE_INTERVAL: 90,
        LOG_RETENTION_DAYS: 14,
        AUTH_ENABLED: false,
        RATE_LIMIT_ENABLED: true,
        RATE_LIMIT_RPM: 123,
        UNKNOWN_OLD_KEY: "ignored",
      }),
    );

    const runtime = await createRuntime(createRuntimeConfig({ dataDir: dir, port: 0 }));
    try {
      const providers = await runtime.providers.listPublic();
      expect(providers.length).toBe(1);
      expect(providers[0]).toMatchObject({
        id: "legacy-firecrawl",
        type: "firecrawl",
        baseUrl: "https://api.firecrawl.dev",
        priority: 77,
        enabled: true,
        health: "unhealthy",
        consecutiveFailures: 4,
        apiKeySet: true,
      });
      expect(existsSync(join(dir, "endpoints.json.migrated"))).toBe(true);
      expect(existsSync(join(dir, "endpoints.json"))).toBe(false);

      const settings = runtime.settings.get();
      expect(settings.routing.failureThreshold).toBe(7);
      expect(settings.routing.healthCheckIntervalSeconds).toBe(90);
      expect(settings.logging.retentionDays).toBe(14);
      expect(settings.rateLimit.enabled).toBe(true);
      expect(settings.rateLimit.rpm).toBe(123);
      expect(existsSync(join(dir, "settings.json.migrated"))).toBe(true);

      const internal = await runtime.providers.getInternal("legacy-firecrawl");
      expect(internal?.apiKey).toBe("fc-legacy-secret");
      const row = runtime.db
        .prepare("SELECT api_key FROM providers WHERE id = ?")
        .get("legacy-firecrawl") as { api_key: string };
      expect(row.api_key.startsWith("v1.")).toBe(true);
    } finally {
      runtime.db.close();
    }
  });

  test("copies an old proxy.db and keeps legacy fr_ keys working", async () => {
    const dir = tempDir();
    const legacy = new Database(join(dir, "proxy.db"), { create: true });
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        key_hash TEXT UNIQUE NOT NULL,
        key_prefix TEXT NOT NULL,
        last_used_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        revoked_at TEXT
      );
      CREATE TABLE proxy_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        request_method TEXT NOT NULL,
        request_path TEXT NOT NULL,
        request_headers TEXT,
        request_body TEXT,
        endpoint_id TEXT,
        endpoint_url TEXT,
        response_status INTEGER,
        response_headers TEXT,
        response_body TEXT,
        duration_ms INTEGER,
        error TEXT,
        key_id TEXT
      );
    `);
    const passwordHash = await Bun.password.hash("password123", "bcrypt");
    legacy
      .prepare("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)")
      .run("legacy-user", "legacy", passwordHash, "admin");
    const key = "fr_legacy-key";
    legacy
      .prepare(
        "INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?, ?)",
      )
      .run("legacy-key", "legacy-user", "legacy", Bun.SHA512.hash(key, "hex"), key.slice(0, 8));
    legacy.close();

    const runtime = await createRuntime(createRuntimeConfig({ dataDir: dir, port: 0 }));
    try {
      expect(existsSync(join(dir, "router.db"))).toBe(true);
      const validation = runtime.keys.validate(key);
      expect(validation?.userId).toBe("legacy-user");
      expect(validation?.scopes).toEqual(["*"]);
      expect(runtime.auth.hasUsers()).toBe(true);
    } finally {
      runtime.db.close();
    }
  });
});
