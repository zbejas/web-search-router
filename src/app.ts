import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { RuntimeConfig } from "./config";
import { VERSION } from "./config";
import { openDatabase } from "./db";
import { SecretBox } from "./crypto";
import { SettingsService, SettingsValidationError } from "./settings";
import { ProviderStore, ProviderValidationError } from "./providers/store";
import { adapterMetadata } from "./providers/registry";
import { migrateLegacyProviders, migrateLegacySettings } from "./migration";
import { Logger } from "./logger";
import { AuthService, type AuthState } from "./auth";
import { KeyService } from "./apikeys";
import { RateLimitService } from "./ratelimit";
import { RouterService, detectOperation } from "./router";
import { HealthService } from "./health";
import type {
  ApiScope,
  AuthUser,
  FailureKind,
  Provider,
  ProviderInput,
  Settings,
} from "./types";
import { safeJsonParse } from "./utils";

export interface Runtime {
  config: RuntimeConfig;
  db: Database;
  secretBox: SecretBox;
  settings: SettingsService;
  providers: ProviderStore;
  logger: Logger;
  auth: AuthService;
  keys: KeyService;
  rateLimit: RateLimitService;
  router: RouterService;
  health: HealthService;
  startedAt: number;
  stopBackgroundJobs: () => void;
}

const MAX_REQUEST_BYTES = 25 * 1024 * 1024;

export async function createRuntime(config: RuntimeConfig): Promise<Runtime> {
  const db = openDatabase(config);
  const secretBox = await SecretBox.open(config.masterKeyPath);
  const settings = new SettingsService(db);
  migrateLegacySettings(config.dataDir, settings);
  const providers = new ProviderStore(db, secretBox);
  await migrateLegacyProviders(config.dataDir, db, secretBox);
  const logger = new Logger(db, settings);
  const auth = new AuthService(db, settings);
  const keys = new KeyService(db);
  const rateLimit = new RateLimitService(settings);
  const router = new RouterService(providers, settings, logger);
  const health = new HealthService(providers, settings);

  let cleanupTimer: ReturnType<typeof setInterval> | null = null;
  const stopBackgroundJobs = () => {
    health.stop();
    if (cleanupTimer) clearInterval(cleanupTimer);
    cleanupTimer = null;
  };

  return {
    config,
    db,
    secretBox,
    settings,
    providers,
    logger,
    auth,
    keys,
    rateLimit,
    router,
    health,
    startedAt: Date.now(),
    stopBackgroundJobs,
  };
}

function json(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function requireUser(user: AuthUser | null): Response | null {
  if (!user) return json({ error: "not authenticated" }, 401);
  return null;
}

function requireAdmin(user: AuthUser | null): Response | null {
  if (!user) return json({ error: "not authenticated" }, 401);
  if (user.role !== "admin") return json({ error: "admin access required" }, 403);
  return null;
}

function clientIp(request: Request, server?: { requestIP?: (request: Request) => { address?: string } | null } | null): string | null {
  try {
    const address = server?.requestIP?.(request)?.address;
    if (address) return address;
  } catch {
    // ignore
  }
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return null;
}

function extractRouterKey(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const value = authorization.slice(7).trim();
    if (value.startsWith("wsr_") || value.startsWith("fr_")) return value;
  }
  const apiKey = request.headers.get("x-api-key")?.trim();
  if (apiKey && (apiKey.startsWith("wsr_") || apiKey.startsWith("fr_"))) return apiKey;
  return null;
}

function withRateHeaders(
  response: Response,
  limit: { limit: number; remaining: number; resetAt: number },
): Response {
  const headers = new Headers(response.headers);
  headers.set("x-ratelimit-limit", String(limit.limit));
  headers.set("x-ratelimit-remaining", String(limit.remaining));
  headers.set("x-ratelimit-reset", String(Math.floor(limit.resetAt / 1000)));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

function loadIndexHtml(distDir: string): string {
  const file = resolve(distDir, "index.html");
  if (existsSync(file)) return readFileSync(file, "utf8");
  return `<!doctype html>
<html><head><title>Web Search Router</title></head>
<body style="background:#08090a;color:#f5f5f5;font-family:system-ui;padding:3rem">
  <h1>Web Search Router</h1>
  <p>The dashboard has not been built yet.</p>
  <p>Run <code>bun run build</code> and restart the server.</p>
</body></html>`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createApp(runtime: Runtime) {
  const {
    settings,
    providers,
    logger,
    auth,
    keys,
    rateLimit,
    router,
    health,
    config,
  } = runtime;

  const app = new Elysia()
    .onError(({ code, error, set }) => {
      if (code === "NOT_FOUND") {
        set.status = 404;
        return { error: "Not found" };
      }
      if (code === "VALIDATION" || code === "PARSE") {
        set.status = 400;
        return { error: "Invalid request", details: error instanceof Error ? error.message : String(error) };
      }
      console.error("Unhandled request error:", error);
      set.status = 500;
      return { error: "Internal server error" };
    })
    .onAfterHandle(({ request, set }) => {
      set.headers["x-content-type-options"] = "nosniff";
      set.headers["x-frame-options"] = "DENY";
      set.headers["referrer-policy"] = "no-referrer";
      if (new URL(request.url).pathname.startsWith("/api/")) {
        set.headers["cache-control"] = "no-store";
      }
    })
    .derive(async ({ request }) => {
      const authState = await auth.getState(request);
      return { authState, user: authState.user };
    })
    // ── Public health ──
    .get("/_router/health", async () => {
      const all = await providers.listPublic();
      const enabled = all.filter((provider) => provider.enabled);
      const unhealthy = enabled.filter((provider) => provider.health === "unhealthy");
      const status =
        enabled.length === 0 || unhealthy.length === enabled.length
          ? "down"
          : unhealthy.length > 0
            ? "degraded"
            : "ok";
      return json(
        {
          status,
          version: VERSION,
          uptimeSeconds: Math.round((Date.now() - runtime.startedAt) / 1_000),
          timestamp: new Date().toISOString(),
          providers: enabled.map((provider) => ({
            id: provider.id,
            name: provider.name,
            type: provider.type,
            health: provider.health,
            enabled: provider.enabled,
            lastCheckedAt: provider.lastCheckedAt,
            consecutiveFailures: provider.consecutiveFailures,
            lastError: provider.lastError,
          })),
        },
        status === "down" ? 503 : 200,
      );
    })
    // ── Auth ──
    .get("/api/auth/state", async ({ authState }) => {
      return {
        enabled: authState.enabled,
        hasUsers: authState.hasUsers,
        needsSetup: authState.enabled && !authState.hasUsers,
        user: authState.user,
      };
    })
    .post("/api/auth/login", async ({ body, request }) => {
      if (!settings.get().auth.enabled) return json({ error: "Authentication is disabled" }, 400);
      if (!auth.hasUsers()) return json({ error: "Setup has not been completed", needsSetup: true }, 409);
      const payload = (body ?? {}) as { username?: string; password?: string };
      if (!payload.username || !payload.password) {
        return json({ error: "username and password are required" }, 400);
      }
      const result = await auth.login(payload.username, payload.password);
      if (!result) return json({ error: "Invalid credentials" }, 401);
      return json(
        { user: result.user },
        200,
        { "set-cookie": auth.sessionCookie(result.token, request) },
      );
    })
    .post("/api/auth/logout", async ({ request }) => {
      const token = auth.extractToken(request);
      if (token) auth.logout(token);
      return json({ ok: true }, 200, { "set-cookie": auth.clearSessionCookie() });
    })
    .post("/api/auth/setup", async ({ body, request }) => {
      if (auth.hasUsers()) return json({ error: "Setup has already been completed" }, 409);
      const payload = (body ?? {}) as {
        username?: string;
        password?: string;
        enableAuth?: boolean;
      };
      if (!payload.username || !payload.password) {
        return json({ error: "username and password are required" }, 400);
      }
      try {
        const user = await auth.setupAdmin(payload.username, payload.password);
        if (payload.enableAuth) settings.update({ auth: { enabled: true } });
        const login = await auth.login(payload.username, payload.password);
        return json(
          { user, enabled: settings.get().auth.enabled },
          201,
          login ? { "set-cookie": auth.sessionCookie(login.token, request) } : {},
        );
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Setup failed" }, 400);
      }
    })
    .post("/api/auth/enable", async ({ body, user, request }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      const payload = (body ?? {}) as {
        enabled?: boolean;
        username?: string;
        password?: string;
      };
      if (typeof payload.enabled !== "boolean") {
        return json({ error: "enabled must be a boolean" }, 400);
      }

      let cookie: Record<string, string> = {};
      if (payload.enabled) {
        const existingToken = auth.extractToken(request);
        const existingUser = existingToken ? auth.getSessionUser(existingToken) : null;

        if (!existingUser) {
          if (!auth.hasUsers()) {
            if (!payload.username || !payload.password) {
              return json({ error: "Create an admin account before enabling auth", needsSetup: true }, 409);
            }
            try {
              await auth.setupAdmin(payload.username, payload.password);
            } catch (error) {
              return json({ error: error instanceof Error ? error.message : "Could not create admin" }, 400);
            }
          } else if (!payload.username || !payload.password) {
            return json({ error: "Confirm an existing admin account before enabling auth", needsSetup: true }, 409);
          }

          const login = await auth.login(payload.username!, payload.password!);
          if (!login) {
            return json({ error: "Invalid admin credentials; authentication was not enabled" }, 401);
          }
          if (login.user.role !== "admin") {
            auth.logout(login.token);
            return json({ error: "The confirmed account is not an admin; authentication was not enabled" }, 403);
          }
          cookie = { "set-cookie": auth.sessionCookie(login.token, request) };
        }
      }

      settings.update({ auth: { enabled: payload.enabled } });
      return json({ enabled: settings.get().auth.enabled, hasUsers: auth.hasUsers() }, 200, cookie);
    })
    .post("/api/auth/password", async ({ body, user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      const payload = (body ?? {}) as { currentPassword?: string; newPassword?: string };
      if (!payload.currentPassword || !payload.newPassword) {
        return json({ error: "currentPassword and newPassword are required" }, 400);
      }
      try {
        const ok = await auth.changePassword(user!.id, payload.currentPassword, payload.newPassword);
        if (!ok) return json({ error: "Current password is incorrect" }, 401);
        return { ok: true };
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Password change failed" }, 400);
      }
    })
    // ── Users ──
    .get("/api/users", ({ user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      return auth.listUsers();
    })
    .post("/api/users", async ({ body, user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      const payload = (body ?? {}) as { username?: string; password?: string; role?: string };
      if (!payload.username || !payload.password) {
        return json({ error: "username and password are required" }, 400);
      }
      try {
        const created = await auth.createUser(payload.username, payload.password, payload.role ?? "user");
        return json(created, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Could not create user" }, 400);
      }
    })
    .post("/api/users/:id/password", async ({ params, body, user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      const payload = (body ?? {}) as { password?: string };
      if (!payload.password) return json({ error: "password is required" }, 400);
      try {
        const ok = await auth.setPassword(params.id, payload.password);
        if (!ok) return json({ error: "User not found" }, 404);
        return { ok: true };
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Password reset failed" }, 400);
      }
    })
    .delete("/api/users/:id", ({ params, user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      if (params.id === user!.id) return json({ error: "Cannot delete yourself" }, 400);
      try {
        if (!auth.deleteUser(params.id)) return json({ error: "User not found" }, 404);
        return { deleted: params.id };
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Delete failed" }, 400);
      }
    })
    // ── Providers ──
    .get("/api/providers/types", () => adapterMetadata())
    .get("/api/providers", async ({ user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      return providers.listPublic();
    })
    .get("/api/providers/:id", async ({ params, user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      const provider = await providers.getPublic(params.id);
      if (!provider) return json({ error: "Provider not found" }, 404);
      return provider;
    })
    .get("/api/providers/:id/events", async ({ params, query, user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      const limit = parsePositiveInt(query.limit, 50, 200);
      return providers.events(params.id, limit);
    })
    .get("/api/events", async ({ query, user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      const limit = parsePositiveInt(query.limit, 20, 100);
      return providers.recentEvents(limit);
    })
    .post("/api/providers", async ({ body, user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      if (!isRecord(body)) return json({ error: "Invalid provider payload" }, 400);
      try {
        const provider = await providers.create(body as unknown as ProviderInput);
        return json(provider, 201);
      } catch (error) {
        if (error instanceof ProviderValidationError) {
          return json({ error: "Invalid provider", issues: error.issues }, 400);
        }
        return json({ error: error instanceof Error ? error.message : "Could not create provider" }, 400);
      }
    })
    .put("/api/providers/:id", async ({ params, body, user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      if (!isRecord(body)) return json({ error: "Invalid provider payload" }, 400);
      try {
        const provider = await providers.update(params.id, body as unknown as Partial<ProviderInput>);
        if (!provider) return json({ error: "Provider not found" }, 404);
        return provider;
      } catch (error) {
        if (error instanceof ProviderValidationError) {
          return json({ error: "Invalid provider", issues: error.issues }, 400);
        }
        return json({ error: error instanceof Error ? error.message : "Could not update provider" }, 400);
      }
    })
    .patch("/api/providers/:id", async (context) => {
      // PATCH and PUT share validation; delegate by calling the same store logic.
      const { params, body, user } = context;
      const denied = requireAdmin(user);
      if (denied) return denied;
      if (!isRecord(body)) return json({ error: "Invalid provider payload" }, 400);
      try {
        const provider = await providers.update(params.id, body as unknown as Partial<ProviderInput>);
        if (!provider) return json({ error: "Provider not found" }, 404);
        return provider;
      } catch (error) {
        if (error instanceof ProviderValidationError) {
          return json({ error: "Invalid provider", issues: error.issues }, 400);
        }
        return json({ error: error instanceof Error ? error.message : "Could not update provider" }, 400);
      }
    })
    .delete("/api/providers/:id", async ({ params, user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      if (!(await providers.delete(params.id))) return json({ error: "Provider not found" }, 404);
      return { deleted: params.id };
    })
    .post("/api/providers/:id/test", async ({ params, user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      const result = await health.testProvider(params.id);
      if (!result) return json({ error: "Provider not found" }, 404);
      return result;
    })
    .post("/api/providers/:id/enable", async ({ params, user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      const provider = await providers.setEnabled(params.id, true);
      if (!provider) return json({ error: "Provider not found" }, 404);
      return provider;
    })
    .post("/api/providers/:id/disable", async ({ params, user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      const provider = await providers.setEnabled(params.id, false);
      if (!provider) return json({ error: "Provider not found" }, 404);
      return provider;
    })
    .post("/api/providers/reorder", async ({ body, user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      const payload = (body ?? {}) as { ids?: unknown };
      if (!Array.isArray(payload.ids) || payload.ids.some((id) => typeof id !== "string")) {
        return json({ error: "ids must be an array of provider IDs" }, 400);
      }
      return providers.reorder(payload.ids as string[]);
    })
    // ── Settings ──
    .get("/api/settings", ({ user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      return settings.get();
    })
    .get("/api/settings/schema", ({ user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      return { schema: settings.schema(), defaults: settings.get() };
    })
    .patch("/api/settings", ({ body, user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      if (!isRecord(body)) return json({ error: "Invalid settings payload" }, 400);
      const wantsAuthEnabled =
        (body.auth as Record<string, unknown> | undefined)?.enabled === true ||
        body["auth.enabled"] === true;
      if (wantsAuthEnabled && !auth.hasUsers()) {
        return json(
          {
            error: "Create an admin account before enabling authentication",
            needsSetup: true,
          },
          409,
        );
      }
      try {
        return settings.update(body);
      } catch (error) {
        if (error instanceof SettingsValidationError) {
          return json({ error: "Invalid settings", issues: error.issues }, 400);
        }
        return json({ error: error instanceof Error ? error.message : "Could not save settings" }, 400);
      }
    })
    .post("/api/settings/reset", ({ user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      return settings.reset();
    })
    // ── Overview / meta ──
    .post("/api/health/check", async ({ user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      const results = await health.runDueChecks({ force: true });
      return { checked: results.length, results };
    })
    .get("/api/meta", () => ({
      name: "Web Search Router",
      version: VERSION,
      port: config.port,
      host: config.host,
      uptimeSeconds: Math.round((Date.now() - runtime.startedAt) / 1_000),
    }))
    .get("/api/overview", async ({ user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      const list = await providers.listPublic();
      const stats = logger.stats();
      const events = await providers.recentEvents(12);
      const authState = await auth.getState(new Request("http://localhost/api/auth/state"));
      return {
        providers: list,
        route: list
          .filter((provider) => provider.enabled)
          .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name)),
        stats,
        events,
        settings: settings.get(),
        auth: {
          enabled: authState.enabled,
          hasUsers: authState.hasUsers,
        },
        meta: {
          version: VERSION,
          port: config.port,
          uptimeSeconds: Math.round((Date.now() - runtime.startedAt) / 1_000),
        },
      };
    })
    // ── Logs ──
    .get("/api/logs", ({ query, user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      const status =
        query.status === "error"
          ? null
          : query.status
            ? Number.parseInt(query.status, 10)
            : undefined;
      return logger.query({
        from: query.from,
        to: query.to,
        provider_id: query.provider_id,
        key_id: query.key_id,
        operation: query.operation,
        search: query.search,
        status: Number.isFinite(status as number) ? status : undefined,
        limit: parsePositiveInt(query.limit, 50, 500),
        offset: Math.max(Number.parseInt(query.offset ?? "0", 10) || 0, 0),
      });
    })
    .get("/api/logs/stats", ({ user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      return logger.stats();
    })
    .get("/api/logs/timeseries", ({ query, user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      const minutes = parsePositiveInt(query.minutes, 60, 1_440);
      const bucket = parsePositiveInt(query.bucket, 5, 60);
      if (Math.ceil(minutes / bucket) > 300) {
        return json({ error: "Too many buckets requested; increase bucket size or reduce minutes" }, 400);
      }
      return logger.timeseries(minutes, bucket);
    })
    .get("/api/logs/timeseries/daily", ({ query, user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      return logger.dailyTimeseries(parsePositiveInt(query.days, 30, 365));
    })
    .get("/api/logs/timeseries/weekly", ({ query, user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      return logger.weeklyTimeseries(parsePositiveInt(query.weeks, 12, 52));
    })
    .get("/api/logs/source-totals", ({ user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      return logger.sourceTotals();
    })
    // ── API keys ──
    .get("/api/keys", ({ user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      return keys.listAll();
    })
    .post("/api/keys", ({ body, user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      const payload = (body ?? {}) as {
        name?: string;
        user_id?: string;
        scopes?: unknown;
      };
      const scopes = Array.isArray(payload.scopes)
        ? (payload.scopes.filter((scope) => typeof scope === "string") as ApiScope[])
        : undefined;
      try {
        const created = keys.create(
          payload.user_id ?? user!.id,
          payload.name ?? "default",
          scopes,
        );
        return json({ key: created.key, ...created.row }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Could not create key" }, 400);
      }
    })
    .delete("/api/keys/:id", ({ params, user }) => {
      const denied = requireAdmin(user);
      if (denied) return denied;
      if (!keys.revoke(params.id)) return json({ error: "Key not found or already revoked" }, 404);
      return { revoked: params.id };
    })
    .get("/api/keys/mine", ({ user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      return keys.listForUser(user!.id);
    })
    .post("/api/keys/mine", ({ body, user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      const payload = (body ?? {}) as { name?: string; scopes?: unknown };
      const scopes = Array.isArray(payload.scopes)
        ? (payload.scopes.filter((scope) => typeof scope === "string") as ApiScope[])
        : undefined;
      try {
        const created = keys.create(user!.id, payload.name ?? "default", scopes);
        return json({ key: created.key, ...created.row }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Could not create key" }, 400);
      }
    })
    .delete("/api/keys/mine/:id", ({ params, user }) => {
      const denied = requireUser(user);
      if (denied) return denied;
      if (!keys.revoke(params.id, user!.id)) {
        return json({ error: "Key not found or already revoked" }, 404);
      }
      return { revoked: params.id };
    })
    // ── Unified + Firecrawl-compatible proxy ──
    .all("/api/search", async ({ request, server }) => handleProxy(request, server))
    .all("/search", async ({ request, server }) => handleProxy(request, server))
    .all("/v1/*", async ({ request, server }) => handleProxy(request, server))
    .all("/v2/*", async ({ request, server }) => handleProxy(request, server))
    // ── Dashboard ──
    .get("/favicon.svg", () => {
      const distIcon = resolve(config.distDir, "favicon.svg");
      const publicIcon = resolve("public", "favicon.svg");
      const icon = existsSync(distIcon) ? distIcon : publicIcon;
      if (!existsSync(icon)) return new Response(null, { status: 404 });
      return new Response(Bun.file(icon), {
        headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
      });
    })
    .get("/assets/:file", ({ params, set }) => {
      const file = basename(params.file);
      const path = resolve(config.distDir, "assets", file);
      const root = resolve(config.distDir, "assets");
      if (!path.startsWith(root) || !existsSync(path)) {
        set.status = 404;
        return "Not found";
      }
      return new Response(Bun.file(path));
    })
    .get("/", () => new Response(loadIndexHtml(config.distDir), {
      headers: { "content-type": "text/html; charset=utf-8" },
    }))
    .get("/login", () => new Response(loadIndexHtml(config.distDir), {
      headers: { "content-type": "text/html; charset=utf-8" },
    }));

  async function handleProxy(
    request: Request,
    server?: { requestIP?: (request: Request) => { address?: string } | null } | null,
  ): Promise<Response> {
    const requestId = crypto.randomUUID();
    const ip = clientIp(request, server);
    const authSettings = settings.get();

    const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return json({ error: "Request body too large", maxBytes: MAX_REQUEST_BYTES }, 413);
    }

    let keyId: string | null = null;
    const providedKey = extractRouterKey(request);
    if (providedKey) {
      const validation = keys.validate(providedKey);
      if (!validation) return json({ error: "Invalid or revoked API key" }, 401);
      const operation = detectOperation(new URL(request.url).pathname);
      if (!KeyService.allowsScope(validation.scopes, operation)) {
        return json({ error: `API key is not allowed to use ${operation}` }, 403);
      }
      keyId = validation.keyId;
    } else if (authSettings.auth.enabled) {
      return json({ error: "A router API key is required" }, 401, {
        "www-authenticate": 'Bearer realm="web-search-router"',
      });
    }

    const limit = rateLimit.check(keyId ?? `ip:${ip ?? "unknown"}`);
    if (!limit.allowed) {
      return json(
        { error: "Rate limit exceeded", retryAfter: 60 },
        429,
        {
          "retry-after": "60",
          "x-ratelimit-limit": String(limit.limit),
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.floor(limit.resetAt / 1_000)),
        },
      );
    }

    let body: ArrayBuffer | null = null;
    if (request.method !== "GET" && request.method !== "HEAD") {
      try {
        body = await request.arrayBuffer();
      } catch {
        return json({ error: "Could not read request body" }, 400);
      }
      if (body.byteLength > MAX_REQUEST_BYTES) {
        return json({ error: "Request body too large", maxBytes: MAX_REQUEST_BYTES }, 413);
      }
    }

    const result = await router.route({ request, body, keyId, clientIp: ip, requestId });
    return withRateHeaders(result.response, limit);
  }

  return app;
}

export function startBackgroundJobs(runtime: Runtime): void {
  runtime.health.start();
  try {
    runtime.logger.cleanupOldLogs();
  } catch (error) {
    console.error("Initial log cleanup failed:", error);
  }
  const cleanup = setInterval(() => {
    try {
      runtime.logger.cleanupOldLogs();
    } catch (error) {
      console.error("Log cleanup failed:", error);
    }
  }, 3_600_000);
  const originalStop = runtime.stopBackgroundJobs;
  runtime.stopBackgroundJobs = () => {
    originalStop();
    clearInterval(cleanup);
  };
}
