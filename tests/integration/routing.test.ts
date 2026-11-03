import { describe, expect, test } from "bun:test";
import { createTestContext, json, request, type TestContext } from "../helpers/runtime";
import { startMockUpstream, type MockUpstream } from "../helpers/upstream";
import type { Provider } from "../../src/types";

async function addProvider(ctx: TestContext, input: Record<string, unknown>): Promise<Provider> {
  const response = await request(ctx.app, "/api/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  expect(response.status).toBe(201);
  return json<Provider>(response);
}

async function search(
  ctx: TestContext,
  path = "/v2/search",
  body: Record<string, unknown> = { query: "hello", limit: 5 },
): Promise<Response> {
  return request(ctx.app, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("priority routing and failover", () => {
  test("uses the highest-priority healthy provider and logs one request", async () => {
    const ctx = await createTestContext();
    const primary = startMockUpstream();
    const secondary = startMockUpstream();
    try {
      await addProvider(ctx, {
        id: "primary",
        type: "firecrawl",
        baseUrl: primary.url,
        priority: 100,
      });
      await addProvider(ctx, {
        id: "secondary",
        type: "firecrawl",
        baseUrl: secondary.url,
        priority: 10,
      });

      const response = await search(ctx);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-router-provider")).toBe("primary");
      const payload = (await response.json()) as {
        success: boolean;
        data: { web: { title: string }[] };
      };
      expect(payload.success).toBe(true);
      expect(payload.data.web[0]?.title).toBe("Firecrawl mock");
      expect(primary.requests.length).toBe(1);
      expect(secondary.requests.length).toBe(0);

      const logs = ctx.runtime.logger.query({ limit: 10 });
      expect(logs.total).toBe(1);
      expect(logs.rows[0]?.attempts.length).toBe(1);
      expect(logs.rows[0]?.providerId).toBe("primary");
    } finally {
      primary.close();
      secondary.close();
      ctx.close();
    }
  });

  test("fails over, auto-disables at the threshold, and skips the disabled provider next time", async () => {
    const ctx = await createTestContext();
    const primary = startMockUpstream();
    const secondary = startMockUpstream();
    try {
      ctx.runtime.settings.update({ routing: { failureThreshold: 1 } });
      await addProvider(ctx, {
        id: "primary",
        type: "firecrawl",
        baseUrl: primary.url,
        priority: 100,
      });
      await addProvider(ctx, {
        id: "secondary",
        type: "firecrawl",
        baseUrl: secondary.url,
        priority: 10,
      });
      primary.setMode("fail500");

      const first = await search(ctx);
      expect(first.status).toBe(200);
      expect(first.headers.get("x-router-provider")).toBe("secondary");
      expect(first.headers.get("x-router-attempts")).toBe("2");
      expect(primary.requests.length).toBe(1);
      expect(secondary.requests.length).toBe(1);

      const primaryState = await ctx.runtime.providers.getPublic("primary");
      expect(primaryState?.health).toBe("unhealthy");
      expect(primaryState?.consecutiveFailures).toBe(1);

      const second = await search(ctx);
      expect(second.status).toBe(200);
      expect(second.headers.get("x-router-provider")).toBe("secondary");
      expect(primary.requests.length).toBe(1);
      expect(secondary.requests.length).toBe(2);
    } finally {
      primary.close();
      secondary.close();
      ctx.close();
    }
  });

  test("health probes recover an auto-disabled provider and restore priority routing", async () => {
    const ctx = await createTestContext();
    const primary = startMockUpstream();
    const secondary = startMockUpstream();
    try {
      ctx.runtime.settings.update({ routing: { failureThreshold: 1 } });
      await addProvider(ctx, {
        id: "primary",
        type: "firecrawl",
        baseUrl: primary.url,
        priority: 100,
      });
      await addProvider(ctx, {
        id: "secondary",
        type: "firecrawl",
        baseUrl: secondary.url,
        priority: 10,
      });
      primary.setMode("fail500");
      await search(ctx);
      expect((await ctx.runtime.providers.getPublic("primary"))?.health).toBe("unhealthy");

      primary.setMode("ok");
      const probes = await ctx.runtime.health.runDueChecks({ force: true });
      expect(probes.some((probe) => probe.providerId === "primary" && probe.ok)).toBe(true);
      expect((await ctx.runtime.providers.getPublic("primary"))?.health).toBe("healthy");

      const response = await search(ctx);
      expect(response.headers.get("x-router-provider")).toBe("primary");
    } finally {
      primary.close();
      secondary.close();
      ctx.close();
    }
  });

  test("last-resort failover tries auto-disabled providers when healthy ones fail", async () => {
    const ctx = await createTestContext();
    const primary = startMockUpstream();
    const secondary = startMockUpstream();
    try {
      ctx.runtime.settings.update({ routing: { failureThreshold: 1 } });
      await addProvider(ctx, {
        id: "primary",
        type: "firecrawl",
        baseUrl: primary.url,
        priority: 100,
      });
      await addProvider(ctx, {
        id: "secondary",
        type: "firecrawl",
        baseUrl: secondary.url,
        priority: 10,
      });
      primary.setMode("fail500");
      await search(ctx);
      expect((await ctx.runtime.providers.getPublic("primary"))?.health).toBe("unhealthy");

      primary.setMode("ok");
      secondary.setMode("fail500");
      const response = await search(ctx);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-router-provider")).toBe("primary");
      expect(response.headers.get("x-router-attempts")).toBe("2");
    } finally {
      primary.close();
      secondary.close();
      ctx.close();
    }
  });

  test("last-resort can be disabled", async () => {
    const ctx = await createTestContext();
    const primary = startMockUpstream();
    try {
      ctx.runtime.settings.update({
        routing: { failureThreshold: 1, lastResortEnabled: false },
      });
      await addProvider(ctx, {
        id: "primary",
        type: "firecrawl",
        baseUrl: primary.url,
        priority: 100,
      });
      primary.setMode("fail500");
      await search(ctx);
      expect((await ctx.runtime.providers.getPublic("primary"))?.health).toBe("unhealthy");

      primary.setMode("ok");
      const response = await search(ctx);
      expect(response.status).toBe(503);
    } finally {
      primary.close();
      ctx.close();
    }
  });

  test("manually disabled providers are never used", async () => {
    const ctx = await createTestContext();
    const disabled = startMockUpstream();
    const active = startMockUpstream();
    try {
      await addProvider(ctx, {
        id: "disabled",
        type: "firecrawl",
        baseUrl: disabled.url,
        priority: 100,
        enabled: false,
      });
      await addProvider(ctx, {
        id: "active",
        type: "firecrawl",
        baseUrl: active.url,
        priority: 10,
      });
      const response = await search(ctx);
      expect(response.headers.get("x-router-provider")).toBe("active");
      expect(disabled.requests.length).toBe(0);
    } finally {
      disabled.close();
      active.close();
      ctx.close();
    }
  });

  test("client errors are passed through and do not disable the provider", async () => {
    const ctx = await createTestContext();
    const primary = startMockUpstream();
    const secondary = startMockUpstream();
    try {
      ctx.runtime.settings.update({ routing: { failureThreshold: 1 } });
      await addProvider(ctx, {
        id: "primary",
        type: "firecrawl",
        baseUrl: primary.url,
        priority: 100,
      });
      await addProvider(ctx, {
        id: "secondary",
        type: "firecrawl",
        baseUrl: secondary.url,
        priority: 10,
      });
      primary.setMode("fail400");

      const response = await search(ctx);
      expect(response.status).toBe(400);
      const payload = (await response.json()) as { error: string };
      expect(payload.error).toContain("Bad request");
      expect(primary.requests.length).toBe(1);
      expect(secondary.requests.length).toBe(0);
      expect((await ctx.runtime.providers.getPublic("primary"))?.health).not.toBe("unhealthy");
      expect((await ctx.runtime.providers.getPublic("primary"))?.consecutiveFailures).toBe(0);
    } finally {
      primary.close();
      secondary.close();
      ctx.close();
    }
  });

  test("quota failures disable the provider and fail over", async () => {
    const ctx = await createTestContext();
    const primary = startMockUpstream();
    const secondary = startMockUpstream();
    try {
      ctx.runtime.settings.update({ routing: { failureThreshold: 1 } });
      await addProvider(ctx, {
        id: "primary",
        type: "firecrawl",
        baseUrl: primary.url,
        priority: 100,
      });
      await addProvider(ctx, {
        id: "secondary",
        type: "firecrawl",
        baseUrl: secondary.url,
        priority: 10,
      });
      primary.setMode("fail402");
      const response = await search(ctx);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-router-provider")).toBe("secondary");
      expect((await ctx.runtime.providers.getPublic("primary"))?.health).toBe("unhealthy");
    } finally {
      primary.close();
      secondary.close();
      ctx.close();
    }
  });
});
