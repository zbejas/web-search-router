import { Database } from "bun:sqlite";
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { RuntimeConfig } from "./config";

function ensureColumn(db: Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.length > 0 && !columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT,
      api_key_hint TEXT,
      priority INTEGER NOT NULL DEFAULT 10,
      enabled INTEGER NOT NULL DEFAULT 1,
      health TEXT NOT NULL DEFAULT 'unknown',
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT,
      last_healthy_at TEXT,
      last_error TEXT,
      last_status_code INTEGER,
      last_latency_ms INTEGER,
      capabilities TEXT NOT NULL DEFAULT '[]',
      config TEXT NOT NULL DEFAULT '{}',
      probe_interval_seconds INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_providers_priority ON providers(priority DESC);
    CREATE INDEX IF NOT EXISTS idx_providers_health ON providers(health);

    CREATE TABLE IF NOT EXISTS provider_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      event TEXT NOT NULL,
      message TEXT,
      status_code INTEGER,
      latency_ms INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_provider_events_provider ON provider_events(provider_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_provider_events_timestamp ON provider_events(timestamp);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_hash TEXT UNIQUE NOT NULL,
      key_prefix TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT '["*"]',
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_keys_hash ON api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_keys_user ON api_keys(user_id);

    CREATE TABLE IF NOT EXISTS proxy_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      request_id TEXT,
      request_method TEXT NOT NULL,
      request_path TEXT NOT NULL,
      request_query TEXT,
      request_headers TEXT,
      request_body TEXT,
      operation TEXT,
      endpoint_id TEXT,
      endpoint_url TEXT,
      provider_id TEXT,
      provider_type TEXT,
      attempts TEXT,
      response_status INTEGER,
      response_headers TEXT,
      response_body TEXT,
      duration_ms INTEGER,
      error TEXT,
      error_kind TEXT,
      key_id TEXT,
      client_ip TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_timestamp ON proxy_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_endpoint ON proxy_logs(endpoint_id);
  `);

  // A hidden owner lets API keys exist before authentication is enabled. It is
  // excluded from hasUsers()/listUsers() and cannot log in.
  db.prepare(
    "INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES ('system', 'system', '', 'system')",
  ).run();

  // The OpenCode adapter was removed. Purge unsupported rows and their events so
  // an upgraded database cannot select a provider type with no adapter.
  db.exec(`
    DELETE FROM provider_events
    WHERE provider_id IN (SELECT id FROM providers WHERE lower(type) = 'opencode');
    DELETE FROM providers WHERE lower(type) = 'opencode';
  `);

  // Migrate older databases in place without losing rows.
  ensureColumn(db, "api_keys", "scopes", `TEXT NOT NULL DEFAULT '["*"]'`);
  ensureColumn(db, "proxy_logs", "request_id", "TEXT");
  ensureColumn(db, "proxy_logs", "request_query", "TEXT");
  ensureColumn(db, "proxy_logs", "operation", "TEXT");
  ensureColumn(db, "proxy_logs", "provider_id", "TEXT");
  ensureColumn(db, "proxy_logs", "provider_type", "TEXT");
  ensureColumn(db, "proxy_logs", "attempts", "TEXT");
  ensureColumn(db, "proxy_logs", "error_kind", "TEXT");
  ensureColumn(db, "proxy_logs", "client_ip", "TEXT");
  db.exec("UPDATE proxy_logs SET provider_id = endpoint_id WHERE provider_id IS NULL AND endpoint_id IS NOT NULL");
  db.exec("CREATE INDEX IF NOT EXISTS idx_provider_id ON proxy_logs(provider_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_proxy_key_id ON proxy_logs(key_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_request_id ON proxy_logs(request_id)");

  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    "2",
  );
}

export function openDatabase(config: RuntimeConfig): Database {
  // Preserve data from the old project name if this is an upgrade.
  if (!existsSync(config.dbPath)) {
    const legacyDb = resolve(config.dataDir, "proxy.db");
    if (existsSync(legacyDb)) {
      copyFileSync(legacyDb, config.dbPath);
    }
  }

  const db = new Database(config.dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA busy_timeout=5000");
  migrate(db);
  return db;
}

export function cleanupExpiredSessions(db: Database): void {
  try {
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  } catch (error) {
    console.error("Session cleanup error:", error);
  }
}
