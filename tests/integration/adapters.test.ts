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
