import type { Database } from "bun:sqlite";
import type { ApiKeyRow, ApiKeyValidation, ApiScope, Operation } from "./types";

const NEW_PREFIX = "wsr_";
const LEGACY_PREFIX = "fr_";
const ALL_SCOPES: ApiScope[] = [
  "*",
  "search",
  "scrape",
  "crawl",
  "map",
  "extract",
  "batch_scrape",
];

interface ApiKeyDbRow {
  id: string;
  user_id: string;
  username?: string;
  name: string;
  key_prefix: string;
  scopes: string;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

function parseScopes(text: string): ApiScope[] {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.filter((scope): scope is ApiScope => ALL_SCOPES.includes(scope));
    }
  } catch {
    // fall through
  }
  return ["*"];
}

function rowToApiKey(row: ApiKeyDbRow): ApiKeyRow {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: parseScopes(row.scopes),
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

function hashKey(key: string): string {
  return Bun.SHA512.hash(key, "hex") as string;
}

function generateKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `${NEW_PREFIX}${Buffer.from(bytes).toString("hex")}`;
}

export class KeyService {
  constructor(private readonly db: Database) {}

  create(
    userId: string,
    name: string,
    scopes: ApiScope[] = ["*"],
  ): { key: string; row: ApiKeyRow } {
    if (this.db.prepare("SELECT id FROM users WHERE id = ?").get(userId) === null) {
      throw new Error("User not found");
    }
    const cleanName = name.trim() || "default";
    const requestedScopes: ApiScope[] = scopes.length > 0 ? scopes : ["*"];
    const invalid = requestedScopes.filter((scope) => !ALL_SCOPES.includes(scope));
    if (invalid.length > 0) {
      throw new Error(`Invalid API key scope: ${invalid.join(", ")}`);
    }
    const cleanScopes: ApiScope[] = requestedScopes.includes("*")
      ? ["*"]
      : Array.from(new Set(requestedScopes));
    const key = generateKey();
    const id = crypto.randomUUID();
    const prefix = key.slice(0, 10);
    this.db
      .prepare(
        `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, cleanName, hashKey(key), prefix, JSON.stringify(cleanScopes));
    const row = this.db
      .prepare(
        `SELECT k.*, u.username FROM api_keys k
         JOIN users u ON u.id = k.user_id WHERE k.id = ?`,
      )
      .get(id) as ApiKeyDbRow;
    return { key, row: rowToApiKey(row) };
  }

  listAll(): ApiKeyRow[] {
    const rows = this.db
      .prepare(
        `SELECT k.*, u.username FROM api_keys k
         JOIN users u ON u.id = k.user_id ORDER BY k.created_at DESC`,
      )
      .all() as ApiKeyDbRow[];
    return rows.map(rowToApiKey);
  }

  listForUser(userId: string): ApiKeyRow[] {
    const rows = this.db
      .prepare(
        `SELECT k.*, u.username FROM api_keys k
         JOIN users u ON u.id = k.user_id
         WHERE k.user_id = ? ORDER BY k.created_at DESC`,
      )
      .all(userId) as ApiKeyDbRow[];
    return rows.map(rowToApiKey);
  }

  revoke(id: string, userId?: string): boolean {
    const result = userId
      ? this.db
          .prepare(
            "UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
          )
          .run(id, userId)
      : this.db
          .prepare(
            "UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL",
          )
          .run(id);
    return result.changes > 0;
  }

  validate(key: string): ApiKeyValidation | null {
    if (!key.startsWith(NEW_PREFIX) && !key.startsWith(LEGACY_PREFIX)) return null;
    const row = this.db
      .prepare(
        "SELECT id, user_id, scopes FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL",
      )
      .get(hashKey(key)) as { id: string; user_id: string; scopes: string } | null;
    if (!row) return null;
    this.db
      .prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?")
      .run(row.id);
    return {
      keyId: row.id,
      userId: row.user_id,
      scopes: parseScopes(row.scopes),
    };
  }

  static allowsScope(scopes: ApiScope[], operation: Operation): boolean {
    if (scopes.includes("*")) return true;
    if (operation === "proxy") return scopes.includes("scrape") || scopes.includes("crawl");
    return scopes.includes(operation);
  }
}
