import type { Database } from "bun:sqlite";
import type { AuthUser } from "./types";
import type { SettingsService } from "./settings";
import { cleanupExpiredSessions } from "./db";

const COOKIE_NAMES = ["wsr_session", "fc_session"];

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("hex");
}

export interface AuthState {
  enabled: boolean;
  hasUsers: boolean;
  user: AuthUser | null;
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  hasUsers(): boolean {
    return (
      (this.db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c > 0
    );
  }

  listUsers(): (AuthUser & { created_at: string; updated_at: string })[] {
    return this.db
      .prepare(
        "SELECT id, username, role, created_at, updated_at FROM users ORDER BY created_at ASC",
      )
      .all() as (AuthUser & { created_at: string; updated_at: string })[];
  }

  async getState(request: Request): Promise<AuthState> {
    const enabled = this.settings.get().auth.enabled;
    if (!enabled) {
      return {
        enabled: false,
        hasUsers: this.hasUsers(),
        user: { id: "system", username: "system", role: "admin" },
      };
    }
    const token = this.extractToken(request);
    const user = token ? this.getSessionUser(token) : null;
    return { enabled: true, hasUsers: this.hasUsers(), user };
  }

  extractToken(request: Request): string | null {
    const cookie = request.headers.get("cookie");
    if (cookie) {
      for (const name of COOKIE_NAMES) {
        const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
        if (match) return decodeURIComponent(match[1]);
      }
    }
    const authorization = request.headers.get("authorization");
    if (authorization?.startsWith("Bearer ")) {
      const token = authorization.slice(7);
      if (!token.startsWith("wsr_") && !token.startsWith("fr_") && !token.startsWith("fc-")) {
        return token;
      }
    }
    return null;
  }

  getSessionUser(token: string): AuthUser | null {
    const row = this.db
      .prepare(
        `SELECT u.id, u.username, u.role
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.token = ? AND s.expires_at > datetime('now')`,
      )
      .get(token) as AuthUser | null;
    return row ?? null;
  }

  async login(username: string, password: string): Promise<{ user: AuthUser; token: string } | null> {
    const row = this.db
      .prepare(
        "SELECT id, username, password_hash, role FROM users WHERE username = ? AND role != 'disabled'",
      )
      .get(username) as
      | { id: string; username: string; password_hash: string; role: string }
      | null;
    if (!row) return null;

    const valid = await Bun.password.verify(password, row.password_hash).catch(() => false);
    if (!valid) return null;

    const token = randomToken();
    const days = this.settings.get().auth.sessionDays;
    const expiresAt = new Date(Date.now() + days * 86_400_000)
      .toISOString()
      .replace("T", " ")
      .replace("Z", "");
    this.db
      .prepare("INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)")
      .run(crypto.randomUUID(), row.id, token, expiresAt);
    this.db.prepare("UPDATE users SET updated_at = datetime('now') WHERE id = ?").run(row.id);
    cleanupExpiredSessions(this.db);
    return {
      user: { id: row.id, username: row.username, role: row.role },
      token,
    };
  }

  logout(token: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }

  sessionCookie(token: string, request?: Request): string {
    const days = this.settings.get().auth.sessionDays;
    const secure =
      request?.headers.get("x-forwarded-proto") === "https" ||
      request?.url.startsWith("https://");
    return [
      `wsr_session=${encodeURIComponent(token)}`,
      "HttpOnly",
      "SameSite=Lax",
      "Path=/",
      `Max-Age=${days * 86_400}`,
      ...(secure ? ["Secure"] : []),
    ].join("; ");
  }

  clearSessionCookie(): string {
    return "wsr_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
  }

  async setupAdmin(username: string, password: string): Promise<AuthUser> {
    if (this.hasUsers()) throw new Error("Setup has already been completed");
    return this.createUser(username, password, "admin");
  }

  async createUser(username: string, password: string, role = "user"): Promise<AuthUser> {
    const cleanUsername = username.trim();
    if (!/^[a-zA-Z0-9_.-]{2,64}$/.test(cleanUsername)) {
      throw new Error("Username must be 2-64 characters: letters, numbers, dot, dash, underscore");
    }
    if (password.length < 8) throw new Error("Password must be at least 8 characters");
    if (role !== "admin" && role !== "user") throw new Error("Role must be admin or user");
    if (this.db.prepare("SELECT id FROM users WHERE username = ?").get(cleanUsername)) {
      throw new Error("Username already taken");
    }
    const id = crypto.randomUUID();
    const hash = await Bun.password.hash(password, "bcrypt");
    this.db
      .prepare("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)")
      .run(id, cleanUsername, hash, role);
    return { id, username: cleanUsername, role };
  }

  async setPassword(userId: string, password: string): Promise<boolean> {
    if (password.length < 8) throw new Error("Password must be at least 8 characters");
    const hash = await Bun.password.hash(password, "bcrypt");
    const result = this.db
      .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(hash, userId);
    return result.changes > 0;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    const row = this.db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(userId) as { password_hash: string } | null;
    if (!row) return false;
    const valid = await Bun.password.verify(currentPassword, row.password_hash).catch(() => false);
    if (!valid) return false;
    return this.setPassword(userId, newPassword);
  }

  deleteUser(userId: string): boolean {
    const admins = (
      this.db
        .prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'")
        .get() as { c: number }
    ).c;
    const target = this.db
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(userId) as { role: string } | null;
    if (!target) return false;
    if (target.role === "admin" && admins <= 1) {
      throw new Error("Cannot delete the last admin");
    }
    return this.db.prepare("DELETE FROM users WHERE id = ?").run(userId).changes > 0;
  }
}
