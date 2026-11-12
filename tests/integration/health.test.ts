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
      expect(afterFirst?.creditsRemaining).toBe(0);
      expect(afterFirst?.creditsPlan).toBe(5_000);
      expect(afterFirst?.creditsPeriodEnd).toBe("2026-12-01T00:00:00.000Z");
      expect(afterFirst?.creditsCheckedAt).not.toBeNull();

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
      const recoveredState = await ctx.runtime.providers.getPublic("firecrawl");
      expect(recoveredState?.health).toBe("healthy");
      expect(recoveredState?.creditsRemaining).toBe(25);
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

  test("a zero credit balance disables the provider on the first probe, ahead of the failure threshold", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      expect(ctx.runtime.settings.get().routing.failureThreshold).toBe(3);
      await addProvider(ctx, upstream.url, { apiKey: "fc-test" });
      expect((await ctx.runtime.health.runDueChecks({ force: true }))[0]?.ok).toBe(true);

      upstream.setCredits(0);
      const exhausted = await ctx.runtime.health.runDueChecks({ force: true });
      expect(exhausted[0]?.ok).toBe(false);
      expect(exhausted[0]?.failureKind).toBe("quota");

      const state = await ctx.runtime.providers.getPublic("firecrawl");
      expect(state?.health).toBe("unhealthy");
      expect(state?.consecutiveFailures).toBe(1);
      expect(state?.creditsRemaining).toBe(0);
      expect(state?.lastError).toContain("0 remaining credits");
      expect(
        (await ctx.runtime.providers.events("firecrawl")).some(
          (event) => event.event === "auto_disabled",
        ),
      ).toBe(true);

      // Transient failures still honour the threshold.
      upstream.setCredits(1_000);
      await ctx.runtime.health.runDueChecks({ force: true });
      expect((await ctx.runtime.providers.getPublic("firecrawl"))?.health).toBe("healthy");

      upstream.setMode("fail500");
      const firstTransient = await ctx.runtime.health.runDueChecks({ force: true });
      expect(firstTransient[0]?.failureKind).toBe("server");
      const afterTransient = await ctx.runtime.providers.getPublic("firecrawl");
      expect(afterTransient?.health).toBe("healthy");
      expect(afterTransient?.consecutiveFailures).toBe(1);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("the dashboard probe route reports the exhausted balance and the new health state", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await addProvider(ctx, upstream.url, { apiKey: "fc-test" });
      await ctx.runtime.health.runDueChecks({ force: true });
      upstream.setCredits(0);

      const response = await request(ctx.app, "/api/providers/firecrawl/test", { method: "POST" });
      expect(response.status).toBe(200);
      const result = (await response.json()) as {
        ok: boolean;
        failureKind: string | null;
        statusCode: number | null;
        credits: { remainingCredits: number; planCredits: number | null } | null;
        state: { health: string; creditsRemaining: number | null };
      };
      expect(result.ok).toBe(false);
      expect(result.failureKind).toBe("quota");
      expect(result.statusCode).toBe(200);
      expect(result.credits?.remainingCredits).toBe(0);
      expect(result.credits?.planCredits).toBe(5_000);
      expect(result.state.health).toBe("unhealthy");
      expect(result.state.creditsRemaining).toBe(0);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("refreshes credits for a healthy Firecrawl provider on the health interval", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await addProvider(ctx, upstream.url, { apiKey: "fc-test" });
      await ctx.runtime.health.runDueChecks({ force: true });
      expect((await ctx.runtime.providers.getPublic("firecrawl"))?.creditsRemaining).toBe(1_000);

      upstream.setCredits(25);
      ctx.runtime.db
        .prepare("UPDATE providers SET last_checked_at = datetime('now', '-1 hour') WHERE id = ?")
        .run("firecrawl");
      const refreshed = await ctx.runtime.health.runDueChecks();
      expect(refreshed.length).toBe(1);
      const state = await ctx.runtime.providers.getPublic("firecrawl");
      expect(state?.health).toBe("healthy");
      expect(state?.creditsRemaining).toBe(25);
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

  test("refreshes OpenCode billing on the health interval with the free usage probe", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await addProvider(ctx, upstream.url, {
        id: "opencode",
        type: "opencode",
        apiKey: "oc_sk_test",
      });

      const first = await ctx.runtime.health.runDueChecks({ force: true });
      expect(first[0]?.ok).toBe(true);
      const initial = await ctx.runtime.providers.getPublic("opencode");
      expect(initial?.health).toBe("healthy");
      expect(initial?.billing?.spendUsd).toBeCloseTo(18.01426762);
      expect(
        upstream.requests.some((entry) => entry.path === "/console/api/websearch"),
      ).toBe(false);

      const before = upstream.requests.length;
      ctx.runtime.db
        .prepare("UPDATE providers SET last_checked_at = datetime('now', '-1 hour') WHERE id = ?")
        .run("opencode");
      const refreshed = await ctx.runtime.health.runDueChecks();
      expect(refreshed.length).toBe(1);
      expect(upstream.requests.length).toBeGreaterThan(before);
      expect(
        upstream.requests.some((entry) =>
          entry.path.startsWith("/console/api/usage/summary"),
        ),
      ).toBe(true);
    } finally {
      upstream.close();
      ctx.close();
    }
  });
});
