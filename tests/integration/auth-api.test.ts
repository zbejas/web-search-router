import { describe, expect, test } from "bun:test";
import { cookieFrom, createTestContext, json, request, type TestContext } from "../helpers/runtime";
import { startMockUpstream } from "../helpers/upstream";

async function setupAdmin(ctx: TestContext): Promise<string> {
  const response = await request(ctx.app, "/api/auth/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: "password123",
      enableAuth: true,
    }),
  });
  expect(response.status).toBe(201);
  const cookie = cookieFrom(response);
  expect(cookie).not.toBeNull();
  return cookie!;
}

async function createKey(
  ctx: TestContext,
  cookie: string,
  scopes: string[],
): Promise<{ id: string; key: string }> {
  const response = await request(ctx.app, "/api/keys", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: "test", scopes }),
  });
  expect(response.status).toBe(201);
  return json<{ id: string; key: string }>(response);
}

async function search(ctx: TestContext, headers: Record<string, string> = {}): Promise<Response> {
  return request(ctx.app, "/v2/search", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ query: "hello" }),
  });
}

describe("auth and API key enforcement", () => {
  test("auth is disabled by default and the dashboard is open", async () => {
    const ctx = await createTestContext();
    try {
      const state = await request(ctx.app, "/api/auth/state");
      expect(state.status).toBe(200);
      const payload = (await state.json()) as {
        enabled: boolean;
        user: { role: string };
      };
      expect(payload.enabled).toBe(false);
      expect(payload.user.role).toBe("admin");
      expect((await request(ctx.app, "/api/providers")).status).toBe(200);
    } finally {
      ctx.close();
    }
  });

  test("enabling auth requires a valid router key for proxy traffic", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await request(ctx.app, "/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "firecrawl",
          type: "firecrawl",
          baseUrl: upstream.url,
          priority: 100,
        }),
      });
      const cookie = await setupAdmin(ctx);

      expect((await request(ctx.app, "/api/providers")).status).toBe(401);
      expect((await request(ctx.app, "/api/providers", { headers: { cookie } })).status).toBe(200);

      const unauthenticated = await search(ctx);
      expect(unauthenticated.status).toBe(401);
      expect(upstream.requests.length).toBe(0);

      const { key, id } = await createKey(ctx, cookie, ["search"]);
      const authenticated = await search(ctx, { authorization: `Bearer ${key}` });
      expect(authenticated.status).toBe(200);
      expect(upstream.requests.length).toBe(1);

      const wrongScope = await request(ctx.app, "/v1/scrape", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ url: "https://example.com" }),
      });
      expect(wrongScope.status).toBe(403);
      expect(upstream.requests.length).toBe(1);

      const revoked = await request(ctx.app, `/api/keys/${id}`, {
        method: "DELETE",
        headers: { cookie },
      });
      expect(revoked.status).toBe(200);
      const afterRevoke = await search(ctx, { authorization: `Bearer ${key}` });
      expect(afterRevoke.status).toBe(401);
      expect(upstream.requests.length).toBe(1);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("login, session state, logout, and setup idempotence", async () => {
    const ctx = await createTestContext();
    try {
      const cookie = await setupAdmin(ctx);
      const secondSetup = await request(ctx.app, "/api/auth/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "other", password: "password123" }),
      });
      expect(secondSetup.status).toBe(409);

      const state = await request(ctx.app, "/api/auth/state", { headers: { cookie } });
      const statePayload = (await state.json()) as { user: { username: string }; needsSetup: boolean };
      expect(statePayload.user.username).toBe("admin");
      expect(statePayload.needsSetup).toBe(false);

      const badLogin = await request(ctx.app, "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "wrong-password" }),
      });
      expect(badLogin.status).toBe(401);

      const login = await request(ctx.app, "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password123" }),
      });
      expect(login.status).toBe(200);
      const loginCookie = cookieFrom(login);
      expect(loginCookie).not.toBeNull();
      expect((await request(ctx.app, "/api/providers", { headers: { cookie: loginCookie! } })).status).toBe(200);

      const logout = await request(ctx.app, "/api/auth/logout", {
        method: "POST",
        headers: { cookie: loginCookie! },
      });
      expect(logout.status).toBe(200);
      expect((await request(ctx.app, "/api/providers", { headers: { cookie: loginCookie! } })).status).toBe(401);
    } finally {
      ctx.close();
    }
  });

  test("non-admin users cannot mutate providers or settings", async () => {
    const ctx = await createTestContext();
    try {
      const cookie = await setupAdmin(ctx);
      const created = await request(ctx.app, "/api/users", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ username: "viewer", password: "password123", role: "user" }),
      });
      expect(created.status).toBe(201);

      const login = await request(ctx.app, "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "viewer", password: "password123" }),
      });
      const viewerCookie = cookieFrom(login)!;
      expect((await request(ctx.app, "/api/providers", { headers: { cookie: viewerCookie } })).status).toBe(200);
      const createProvider = await request(ctx.app, "/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: viewerCookie },
        body: JSON.stringify({ id: "x", type: "firecrawl", baseUrl: "https://example.com" }),
      });
      expect(createProvider.status).toBe(403);
      const settings = await request(ctx.app, "/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: viewerCookie },
        body: JSON.stringify({ routing: { failureThreshold: 9 } }),
      });
      expect(settings.status).toBe(403);
    } finally {
      ctx.close();
    }
  });

  test("enabling auth with existing users requires valid admin credentials", async () => {
    const ctx = await createTestContext();
    try {
      await ctx.runtime.auth.createUser("existing-admin", "password123", "admin");
      const missing = await request(ctx.app, "/api/auth/enable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      expect(missing.status).toBe(409);
      expect(ctx.runtime.settings.get().auth.enabled).toBe(false);

      const wrong = await request(ctx.app, "/api/auth/enable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true, username: "existing-admin", password: "wrong-password" }),
      });
      expect(wrong.status).toBe(401);
      expect(ctx.runtime.settings.get().auth.enabled).toBe(false);

      const enabled = await request(ctx.app, "/api/auth/enable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true, username: "existing-admin", password: "password123" }),
      });
      expect(enabled.status).toBe(200);
      expect(ctx.runtime.settings.get().auth.enabled).toBe(true);
      expect(cookieFrom(enabled)).not.toBeNull();
    } finally {
      ctx.close();
    }
  });

  test("enabling auth without users returns needsSetup", async () => {
    const ctx = await createTestContext();
    try {
      const response = await request(ctx.app, "/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auth: { enabled: true } }),
      });
      expect(response.status).toBe(409);
      const payload = (await response.json()) as { needsSetup: boolean };
      expect(payload.needsSetup).toBe(true);
    } finally {
      ctx.close();
    }
  });
});
