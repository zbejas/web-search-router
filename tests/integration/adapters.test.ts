import { describe, expect, test } from "bun:test";
import { createTestContext, json, request, type TestContext } from "../helpers/runtime";
import { startMockUpstream } from "../helpers/upstream";
import type { Provider } from "../../src/types";
import { genericAdapter } from "../../src/providers/generic";

async function addProvider(ctx: TestContext, input: Record<string, unknown>): Promise<Provider> {
  const response = await request(ctx.app, "/api/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  expect(response.status).toBe(201);
  return json<Provider>(response);
}

async function postSearch(
  ctx: TestContext,
  path: string,
  body: Record<string, unknown> = { query: "hello", limit: 5 },
): Promise<Response> {
  return request(ctx.app, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("provider adapters", () => {
  test("DeepSeek returns v1 and v2 Firecrawl-shaped responses", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await addProvider(ctx, {
        id: "deepseek",
        type: "deepseek",
        baseUrl: upstream.url,
        apiKey: "sk-test",
        priority: 100,
      });

      const v1 = await postSearch(ctx, "/v1/search");
      expect(v1.status).toBe(200);
      const v1Payload = (await v1.json()) as { data: { title: string; url: string }[] };
      expect(Array.isArray(v1Payload.data)).toBe(true);
      expect(v1Payload.data[0]?.title).toBe("DeepSeek mock");

      const v2 = await postSearch(ctx, "/v2/search");
      const v2Payload = (await v2.json()) as {
        data: { web: { title: string; url: string }[] };
        creditsUsed: number;
      };
      expect(v2Payload.data.web[0]?.title).toBe("DeepSeek mock");
      expect(v2Payload.creditsUsed).toBe(0);

      const unified = await postSearch(ctx, "/api/search");
      const unifiedPayload = (await unified.json()) as { data: { web: { title: string }[] } };
      expect(unifiedPayload.data.web[0]?.title).toBe("DeepSeek mock");

      const deepseekRequest = upstream.requests.find(
        (entry) => entry.path === "/v1/tools/search",
      );
      expect(deepseekRequest?.headers.authorization).toBe("Bearer sk-test");
      const body = JSON.parse(deepseekRequest!.body!) as Record<string, unknown>;
      expect(body.query).toBe("hello");
      expect(body.count).toBe(5);
      expect(body.need_content).toBe(true);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("OpenCode maps hosted search results and sends auth and org headers", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await addProvider(ctx, {
        id: "opencode",
        type: "opencode",
        baseUrl: upstream.url,
        apiKey: "oc_sk_test",
        priority: 100,
        config: { orgId: "org-test" },
      });

      const v2 = await postSearch(ctx, "/v2/search", {
        query: "latest bun release",
        limit: 1,
      });
      expect(v2.status).toBe(200);
      const v2Payload = (await v2.json()) as {
        data: {
          web: {
            title: string;
            url: string;
            description: string;
            markdown: string;
            metadata: { publishedAt?: string };
          }[];
        };
        creditsUsed: number;
      };
      expect(v2Payload.data.web).toHaveLength(1);
      expect(v2Payload.data.web[0]?.title).toBe("OpenCode mock");
      expect(v2Payload.data.web[0]?.url).toBe("https://example.com/opencode");
      expect(v2Payload.data.web[0]?.description).toBe("");
      expect(v2Payload.data.web[0]?.markdown).toBe("An OpenCode hosted search result");
      expect(v2Payload.data.web[0]?.metadata.publishedAt).toBe("2026-10-22T00:00:00.000Z");
      expect(v2Payload.creditsUsed).toBe(0);

      const opencodeRequest = upstream.requests.find(
        (entry) => entry.path === "/console/api/websearch",
      );
      expect(opencodeRequest?.headers.authorization).toBe("Bearer oc_sk_test");
      expect(opencodeRequest?.headers["x-org-id"]).toBe("org-test");
      const body = JSON.parse(opencodeRequest!.body!) as Record<string, unknown>;
      expect(body).toEqual({ query: "latest bun release", providerID: "opencode" });
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("OpenCode probe posts a health search", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await addProvider(ctx, {
        id: "opencode",
        type: "opencode",
        baseUrl: upstream.url,
        apiKey: "oc_sk_test",
        priority: 100,
        config: { probeMode: "search" },
      });

      const tested = await request(ctx.app, "/api/providers/opencode/test", { method: "POST" });
      expect(tested.status).toBe(200);
      const result = (await tested.json()) as { ok: boolean; state: { health: string } };
      expect(result.ok).toBe(true);
      expect(result.state.health).toBe("healthy");

      const probeRequest = upstream.requests.find(
        (entry) => entry.path === "/console/api/websearch",
      );
      const body = JSON.parse(probeRequest!.body!) as Record<string, unknown>;
      expect(body.query).toBe("web search router health check");
      expect(body.providerID).toBe("opencode");
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("OpenCode probe records workspace spend and balance", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await addProvider(ctx, {
        id: "opencode",
        type: "opencode",
        baseUrl: upstream.url,
        apiKey: "oc_sk_test",
        priority: 100,
        config: { usageRange: "30d" },
      });

      const tested = await request(ctx.app, "/api/providers/opencode/test", { method: "POST" });
      expect(tested.status).toBe(200);
      const result = (await tested.json()) as {
        ok: boolean;
        billing: {
          balanceUsd: number | null;
          availableUsd: number | null;
          spendUsd: number | null;
          range: string | null;
          webSearchRequests: number | null;
          webSearchSpendUsd: number | null;
          billingMode: string | null;
          mode: string | null;
          checkedAt: string;
        } | null;
        state: { billing: { spendUsd: number | null } | null };
      };
      expect(result.ok).toBe(true);
      expect(result.billing?.balanceUsd).toBeCloseTo(12.34);
      expect(result.billing?.availableUsd).toBeCloseTo(10);
      expect(result.billing?.spendUsd).toBeCloseTo(18.01426762);
      expect(result.billing?.range).toBe("30d");
      expect(result.billing?.webSearchRequests).toBe(7);
      expect(result.billing?.webSearchSpendUsd).toBeCloseTo(0.07);
      expect(result.billing?.billingMode).toBe("pay-as-you-go");
      expect(result.billing?.checkedAt).toBeTruthy();
      expect(result.state.billing?.spendUsd).toBeCloseTo(18.01426762);

      const summaryRequest = upstream.requests.find((entry) =>
        entry.path.startsWith("/console/api/usage/summary"),
      );
      expect(summaryRequest?.path).toBe("/console/api/usage/summary?range=30d");
      expect(summaryRequest?.headers.authorization).toBe("Bearer oc_sk_test");
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("OpenCode billing falls back to spend when Billing is forbidden", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      upstream.setBillingAccess("forbidden");
      await addProvider(ctx, {
        id: "opencode",
        type: "opencode",
        baseUrl: upstream.url,
        apiKey: "oc_sk_test",
        priority: 100,
      });

      const tested = await request(ctx.app, "/api/providers/opencode/test", { method: "POST" });
      expect(tested.status).toBe(200);
      const result = (await tested.json()) as {
        ok: boolean;
        billing: {
          balanceUsd: number | null;
          availableUsd: number | null;
          spendUsd: number | null;
          webSearchSpendUsd: number | null;
        } | null;
      };
      expect(result.ok).toBe(true);
      expect(result.billing?.balanceUsd).toBeNull();
      expect(result.billing?.availableUsd).toBeNull();
      expect(result.billing?.spendUsd).toBeCloseTo(18.01426762);
      expect(result.billing?.webSearchSpendUsd).toBeCloseTo(0.07);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("OpenCode usage probe skips the paid search request", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await addProvider(ctx, {
        id: "opencode",
        type: "opencode",
        baseUrl: upstream.url,
        apiKey: "oc_sk_test",
        priority: 100,
        config: { probeMode: "usage" },
      });

      const tested = await request(ctx.app, "/api/providers/opencode/test", { method: "POST" });
      expect(tested.status).toBe(200);
      const result = (await tested.json()) as { ok: boolean; state: { health: string } };
      expect(result.ok).toBe(true);
      expect(result.state.health).toBe("healthy");
      expect(
        upstream.requests.some((entry) => entry.path === "/console/api/websearch"),
      ).toBe(false);
      expect(
        upstream.requests.some((entry) => entry.path.startsWith("/console/api/usage/summary")),
      ).toBe(true);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("OpenCode usage probe falls back to search when Usage is forbidden", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      upstream.setUsageAccess("forbidden");
      await addProvider(ctx, {
        id: "opencode",
        type: "opencode",
        baseUrl: upstream.url,
        apiKey: "oc_sk_test",
        priority: 100,
      });

      const tested = await request(ctx.app, "/api/providers/opencode/test", { method: "POST" });
      expect(tested.status).toBe(200);
      const result = (await tested.json()) as {
        ok: boolean;
        billing: { balanceUsd: number | null; spendUsd: number | null } | null;
        state: { health: string };
      };
      expect(result.ok).toBe(true);
      expect(result.state.health).toBe("healthy");
      expect(result.billing?.balanceUsd).toBeCloseTo(12.34);
      expect(result.billing?.spendUsd).toBeNull();
      expect(
        upstream.requests.some((entry) => entry.path === "/console/api/websearch"),
      ).toBe(true);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("OpenCode invalid JSON is classified as an invalid response", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await addProvider(ctx, {
        id: "opencode",
        type: "opencode",
        baseUrl: upstream.url,
        apiKey: "oc_sk_test",
        priority: 100,
      });
      upstream.setMode("invalid");
      const response = await postSearch(ctx, "/v2/search");
      expect(response.status).toBe(502);
      const payload = (await response.json()) as {
        error: string;
        attempts: { failureKind: string }[];
      };
      expect(payload.error).toBe("All providers failed");
      expect(payload.attempts[0]?.failureKind).toBe("invalid_response");
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("generic POST adapter maps configurable results", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      const custom = genericAdapter.metadata.presets!.find((preset) => preset.id === "custom")!;
      await addProvider(ctx, {
        id: "generic",
        type: "generic",
        baseUrl: upstream.url,
        priority: 100,
        config: custom.config,
      });
      const response = await postSearch(ctx, "/v2/search");
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        data: { web: { title: string; url: string }[] };
      };
      expect(payload.data.web[0]?.title).toBe("Generic mock");
      expect(upstream.requests[0]?.path).toBe("/search");
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("generic GET adapter sends query parameters", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      const searxng = genericAdapter.metadata.presets!.find((preset) => preset.id === "searxng")!;
      await addProvider(ctx, {
        id: "searxng",
        type: "generic",
        baseUrl: upstream.url,
        priority: 100,
        config: searxng.config,
      });
      const response = await postSearch(ctx, "/v2/search", { query: "hello world", limit: 3 });
      expect(response.status).toBe(200);
      const requestPath = upstream.requests[0]?.path ?? "";
      expect(requestPath.startsWith("/search?")).toBe(true);
      expect(requestPath).toContain("q=hello+world");
      expect(requestPath).toContain("format=json");
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("generic presets are unique and pass validation", () => {
    const presets = genericAdapter.metadata.presets ?? [];
    expect(new Set(presets.map((preset) => preset.id)).size).toBe(presets.length);
    for (const preset of presets) {
      const issues = genericAdapter.validate({
        name: preset.label,
        type: "generic",
        baseUrl: preset.baseUrl || "https://example.com",
        config: preset.config,
      });
      expect(issues, `${preset.id}: ${issues.join("; ")}`).toEqual([]);
    }
  });

  test("DuckDuckGo Instant Answer preset maps related topics", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      const duckduckgo = genericAdapter.metadata.presets!.find(
        (preset) => preset.id === "duckduckgo",
      )!;
      await addProvider(ctx, {
        id: "duckduckgo",
        type: "generic",
        baseUrl: upstream.url,
        priority: 100,
        config: duckduckgo.config,
      });
      const response = await postSearch(ctx, "/v2/search", { query: "hello", limit: 3 });
      expect(response.status).toBe(200);
      expect(response.headers.get("x-router-provider")).toBe("duckduckgo");
      const payload = (await response.json()) as {
        data: { web: { title: string; url: string }[] };
      };
      expect(payload.data.web).toHaveLength(1);
      expect(payload.data.web[0]?.title).toBe("DuckDuckGo result");
      expect(upstream.requests[0]?.path).toContain("format=json");
      expect(upstream.requests[0]?.path).toContain("q=hello");
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("Tavily preset sends bearer auth and max_results", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      const tavily = genericAdapter.metadata.presets!.find((preset) => preset.id === "tavily")!;
      await addProvider(ctx, {
        id: "tavily",
        type: "generic",
        baseUrl: upstream.url,
        apiKey: "tvly-test",
        priority: 100,
        config: tavily.config,
      });
      const response = await postSearch(ctx, "/v2/search", { query: "hello", limit: 4 });
      expect(response.status).toBe(200);
      const mockRequest = upstream.requests[0]!;
      expect(mockRequest.headers.authorization).toBe("Bearer tvly-test");
      const body = JSON.parse(mockRequest.body!) as Record<string, unknown>;
      expect(body.max_results).toBe(4);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("unsupported operations return a clear 501", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await addProvider(ctx, {
        id: "deepseek",
        type: "deepseek",
        baseUrl: upstream.url,
        apiKey: "sk-test",
      });
      const response = await postSearch(ctx, "/v2/scrape", { url: "https://example.com" });
      expect(response.status).toBe(501);
      const payload = (await response.json()) as { error: string };
      expect(payload.error).toContain("supports scrape");
      expect(upstream.requests.length).toBe(0);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("generic invalid JSON is classified as a failure", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      const custom = genericAdapter.metadata.presets!.find((preset) => preset.id === "custom")!;
      await addProvider(ctx, {
        id: "generic",
        type: "generic",
        baseUrl: upstream.url,
        config: custom.config,
      });
      upstream.setMode("invalid");
      const response = await postSearch(ctx, "/v2/search");
      expect(response.status).toBe(502);
      const payload = (await response.json()) as { error: string; attempts: { failureKind: string }[] };
      expect(payload.error).toBe("All providers failed");
      expect(payload.attempts[0]?.failureKind).toBe("invalid_response");
    } finally {
      upstream.close();
      ctx.close();
    }
  });
});
