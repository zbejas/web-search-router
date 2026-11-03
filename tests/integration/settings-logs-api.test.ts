import { describe, expect, test } from "bun:test";
import { createTestContext, json, request, type TestContext } from "../helpers/runtime";
import { startMockUpstream } from "../helpers/upstream";
import type { LogEntry, Settings } from "../../src/types";

async function addFirecrawl(ctx: TestContext, url: string): Promise<void> {
  const response = await request(ctx.app, "/api/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "firecrawl", type: "firecrawl", baseUrl: url, priority: 10 }),
  });
  expect(response.status).toBe(201);
}

describe("settings and logs API", () => {
  test("validates settings, persists changes, and resets defaults", async () => {
    const ctx = await createTestContext();
    try {
      const invalid = await request(ctx.app, "/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ routing: { failureThreshold: 0 } }),
      });
      expect(invalid.status).toBe(400);
      const invalidBody = (await invalid.json()) as { issues: string[] };
      expect(invalidBody.issues[0]).toContain("at least 1");

      const updated = await request(ctx.app, "/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          routing: { failureThreshold: 8, healthCheckIntervalSeconds: 45 },
          logging: { retentionDays: 30 },
        }),
      });
      expect(updated.status).toBe(200);
      const settings = (await updated.json()) as Settings;
      expect(settings.routing.failureThreshold).toBe(8);
      expect(settings.routing.healthCheckIntervalSeconds).toBe(45);
      expect(settings.logging.retentionDays).toBe(30);

      const reloaded = await request(ctx.app, "/api/settings");
      expect(((await reloaded.json()) as Settings).routing.failureThreshold).toBe(8);

      const schema = await request(ctx.app, "/api/settings/schema");
      const schemaBody = (await schema.json()) as { schema: { path: string }[] };
      expect(schemaBody.schema.some((field) => field.path === "routing.totalTimeoutMs")).toBe(true);

      const reset = await request(ctx.app, "/api/settings/reset", { method: "POST" });
      expect(reset.status).toBe(200);
      expect(((await reset.json()) as Settings).routing.failureThreshold).toBe(3);
    } finally {
      ctx.close();
    }
  });

  test("records one log row per request with attempts and provider metadata", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await addFirecrawl(ctx, upstream.url);
      const response = await request(ctx.app, "/v2/search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "session=secret",
          authorization: "Bearer wsr_not_a_valid_key_for_testing",
        },
        body: JSON.stringify({ query: "hello" }),
      });
      // Auth is disabled, so an unknown router key is still rejected.
      expect(response.status).toBe(401);
      expect(upstream.requests.length).toBe(0);

      const allowed = await request(ctx.app, "/v2/search", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "session=secret" },
        body: JSON.stringify({ query: "hello" }),
      });
      expect(allowed.status).toBe(200);

      const logsResponse = await request(ctx.app, "/api/logs?limit=10");
      expect(logsResponse.status).toBe(200);
      const logs = (await logsResponse.json()) as { rows: LogEntry[]; total: number };
      expect(logs.total).toBe(1);
      const row = logs.rows[0]!;
      expect(row.path).toBe("/v2/search");
      expect(row.operation).toBe("search");
      expect(row.providerId).toBe("firecrawl");
      expect(row.providerType).toBe("firecrawl");
      expect(row.attempts.length).toBe(1);
      expect(row.attempts[0]?.ok).toBe(true);
      expect(row.requestHeaders.cookie).toBe("[redacted]");

      const stats = await request(ctx.app, "/api/logs/stats");
      const statsBody = (await stats.json()) as { total: number; successCount: number };
      expect(statsBody.total).toBe(1);
      expect(statsBody.successCount).toBe(1);

      const series = await request(ctx.app, "/api/logs/timeseries?minutes=60&bucket=5");
      expect(series.status).toBe(200);
      expect(((await series.json()) as { buckets: unknown[] }).buckets.length).toBe(12);

      const tooMany = await request(ctx.app, "/api/logs/timeseries?minutes=1440&bucket=1");
      expect(tooMany.status).toBe(400);

      const overview = await request(ctx.app, "/api/overview");
      expect(overview.status).toBe(200);
      const overviewBody = (await overview.json()) as {
        providers: unknown[];
        route: unknown[];
        stats: { total: number };
      };
      expect(overviewBody.providers.length).toBe(1);
      expect(overviewBody.route.length).toBe(1);
      expect(overviewBody.stats.total).toBe(1);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("log filters and pagination are bounded", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await addFirecrawl(ctx, upstream.url);
      for (let i = 0; i < 3; i++) {
        const response = await request(ctx.app, "/v2/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: `hello ${i}` }),
        });
        expect(response.status).toBe(200);
      }
      const page = await request(ctx.app, "/api/logs?limit=-5&offset=-1");
      expect(page.status).toBe(200);
      const pageBody = (await page.json()) as { rows: LogEntry[]; total: number };
      expect(pageBody.total).toBe(3);
      expect(pageBody.rows.length).toBe(1);
      expect(pageBody.rows[0]?.requestBody).toContain("hello 2");

      const filtered = await request(ctx.app, "/api/logs?provider_id=firecrawl&operation=search");
      const filteredBody = (await filtered.json()) as { total: number };
      expect(filteredBody.total).toBe(3);

      const noMatch = await request(ctx.app, "/api/logs?provider_id=missing");
      expect(((await noMatch.json()) as { total: number }).total).toBe(0);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("health endpoint reports down with 503 when all providers are unhealthy", async () => {
    const ctx = await createTestContext();
    try {
      const empty = await request(ctx.app, "/_router/health");
      expect(empty.status).toBe(503);
      expect(((await empty.json()) as { status: string }).status).toBe("down");
    } finally {
      ctx.close();
    }
  });
});
