import { describe, expect, test } from "bun:test";
import { createTestContext, request } from "../helpers/runtime";
import { startMockUpstream } from "../helpers/upstream";

async function addProvider(
  ctx: Awaited<ReturnType<typeof createTestContext>>,
  url: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await request(ctx.app, "/api/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "firecrawl",
      type: "firecrawl",
      baseUrl: url,
      priority: 100,
      ...overrides,
    }),
  });
  expect(response.status).toBe(201);
}

describe("health service", () => {
  test("probes unhealthy providers, records state, and recovers automatically", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      ctx.runtime.settings.update({ routing: { failureThreshold: 1 } });
      await addProvider(ctx, upstream.url);
      upstream.setHealthMode("fail");

      const first = await ctx.runtime.health.runDueChecks({ force: true });
      expect(first.length).toBe(1);
      expect(first[0]?.ok).toBe(false);
      const unhealthy = await ctx.runtime.providers.getPublic("firecrawl");
      expect(unhealthy?.health).toBe("unhealthy");
      expect(unhealthy?.lastError).toContain("503");

      upstream.setHealthMode("ok");
      const second = await ctx.runtime.health.runDueChecks({ force: true });
      expect(second[0]?.ok).toBe(true);
      const healthy = await ctx.runtime.providers.getPublic("firecrawl");
      expect(healthy?.health).toBe("healthy");
      expect(healthy?.consecutiveFailures).toBe(0);
      expect(healthy?.lastHealthyAt).not.toBeNull();

      const events = await ctx.runtime.providers.events("firecrawl");
      expect(events.some((event) => event.event === "auto_disabled")).toBe(true);
      expect(events.some((event) => event.event === "auto_enabled")).toBe(true);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("an exhausted Firecrawl credit balance keeps the provider unhealthy until credits return", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      ctx.runtime.settings.update({ routing: { failureThreshold: 1 } });
      await addProvider(ctx, upstream.url, { apiKey: "fc-test" });
      upstream.setCredits(0);

      const exhausted = await ctx.runtime.health.runDueChecks({ force: true });
      expect(exhausted[0]?.ok).toBe(false);
      expect(exhausted[0]?.failureKind).toBe("quota");
      expect(exhausted[0]?.statusCode).toBe(200);
      const afterFirst = await ctx.runtime.providers.getPublic("firecrawl");
      expect(afterFirst?.health).toBe("unhealthy");
      expect(afterFirst?.lastError).toContain("remaining credits");

      const stillExhausted = await ctx.runtime.health.runDueChecks({ force: true });
      expect(stillExhausted[0]?.ok).toBe(false);
      expect((await ctx.runtime.providers.getPublic("firecrawl"))?.health).toBe("unhealthy");
      expect(
        (await ctx.runtime.providers.events("firecrawl")).filter(
          (event) => event.event === "auto_enabled",
        ),
      ).toHaveLength(0);

      upstream.setCredits(25);
      const recovered = await ctx.runtime.health.runDueChecks({ force: true });
      expect(recovered[0]?.ok).toBe(true);
      expect((await ctx.runtime.providers.getPublic("firecrawl"))?.health).toBe("healthy");
      expect(
        (await ctx.runtime.providers.events("firecrawl")).some(
          (event) => event.event === "auto_enabled",
        ),
      ).toBe(true);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("does not re-probe healthy providers unless configured or forced", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await addProvider(ctx, upstream.url);
      await ctx.runtime.health.runDueChecks({ force: true });
      const afterFirst = upstream.requests.length;
      const second = await ctx.runtime.health.runDueChecks();
      expect(second.length).toBe(0);
      expect(upstream.requests.length).toBe(afterFirst);

      ctx.runtime.settings.update({ routing: { probeHealthy: true } });
      ctx.runtime.db
        .prepare("UPDATE providers SET last_checked_at = datetime('now', '-1 hour') WHERE id = ?")
        .run("firecrawl");
      const third = await ctx.runtime.health.runDueChecks();
      expect(third.length).toBe(1);

      ctx.runtime.settings.update({ routing: { probeHealthy: false } });
      ctx.runtime.db
        .prepare("UPDATE providers SET last_checked_at = datetime('now', '-1 hour') WHERE id = ?")
        .run("firecrawl");
      const fourth = await ctx.runtime.health.runDueChecks();
      expect(fourth.length).toBe(0);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("manual test succeeds without enabling a manually disabled provider", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await addProvider(ctx, upstream.url);
      await request(ctx.app, "/api/providers/firecrawl/disable", { method: "POST" });
      const result = await ctx.runtime.health.testProvider("firecrawl");
      expect(result?.ok).toBe(true);
      expect(result?.state.enabled).toBe(false);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("DeepSeek probes the search endpoint", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await request(ctx.app, "/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "deepseek",
          type: "deepseek",
          baseUrl: upstream.url,
          apiKey: "sk-test",
        }),
      });
      const results = await ctx.runtime.health.runDueChecks({ force: true });
      expect(results[0]?.ok).toBe(true);
      expect(upstream.requests.some((entry) => entry.path === "/v1/tools/search")).toBe(true);
    } finally {
      upstream.close();
      ctx.close();
    }
  });
});
