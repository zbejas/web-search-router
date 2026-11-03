import { describe, expect, test } from "bun:test";
import { createTestContext, json, request, type TestContext } from "../helpers/runtime";
import { startMockUpstream } from "../helpers/upstream";
import type { Provider, ProviderTestResult } from "../../src/types";

async function createProvider(ctx: TestContext, input: Record<string, unknown>) {
  return request(ctx.app, "/api/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

describe("provider management API", () => {
  test("creates providers without exposing secrets and supports clearing keys", async () => {
    const ctx = await createTestContext();
    try {
      const created = await createProvider(ctx, {
        id: "firecrawl-cloud",
        name: "Firecrawl Cloud",
        type: "firecrawl",
        baseUrl: "https://api.firecrawl.dev/",
        apiKey: "fc-1234567890",
        priority: 50,
      });
      expect(created.status).toBe(201);
      const provider = await json<Provider>(created);
      expect(provider.id).toBe("firecrawl-cloud");
      expect(provider.baseUrl).toBe("https://api.firecrawl.dev");
      expect(provider.apiKeySet).toBe(true);
      expect(provider.apiKeyHint).toBe("****7890");
      expect("apiKey" in provider).toBe(false);
      expect("apiKeyEncrypted" in provider).toBe(false);

      const row = ctx.runtime.db
        .prepare("SELECT api_key FROM providers WHERE id = ?")
        .get("firecrawl-cloud") as { api_key: string };
      expect(row.api_key.startsWith("v1.")).toBe(true);
      expect(row.api_key).not.toContain("fc-1234567890");

      const cleared = await request(ctx.app, "/api/providers/firecrawl-cloud", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: "" }),
      });
      expect(cleared.status).toBe(200);
      expect((await cleared.json()) as Provider).toMatchObject({
        apiKeySet: false,
        apiKeyHint: null,
      });
    } finally {
      ctx.close();
    }
  });

  test("rejects invalid provider payloads and duplicate IDs", async () => {
    const ctx = await createTestContext();
    try {
      const badUrl = await createProvider(ctx, {
        id: "bad",
        type: "firecrawl",
        baseUrl: "not-a-url",
      });
      expect(badUrl.status).toBe(400);
      const badUrlBody = (await badUrl.json()) as { issues: string[] };
      expect(badUrlBody.issues.join(" ")).toContain("Base URL");

      const badType = await createProvider(ctx, {
        id: "bad-type",
        type: "unknown",
        baseUrl: "https://example.com",
      });
      expect(badType.status).toBe(400);

      expect(
        (
          await createProvider(ctx, {
            id: "dupe",
            type: "firecrawl",
            baseUrl: "https://example.com",
          })
        ).status,
      ).toBe(201);
      const duplicate = await createProvider(ctx, {
        id: "dupe",
        type: "firecrawl",
        baseUrl: "https://example.com",
      });
      expect(duplicate.status).toBe(400);
      expect(((await duplicate.json()) as { issues: string[] }).issues[0]).toContain("already exists");
    } finally {
      ctx.close();
    }
  });

  test("reorders providers by rewriting priority", async () => {
    const ctx = await createTestContext();
    try {
      for (const [id, priority] of [
        ["a", 100],
        ["b", 50],
        ["c", 10],
      ] as const) {
        const response = await createProvider(ctx, {
          id,
          type: "firecrawl",
          baseUrl: "https://example.com",
          priority,
        });
        expect(response.status).toBe(201);
      }
      const reordered = await request(ctx.app, "/api/providers/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: ["c", "a", "b"] }),
      });
      expect(reordered.status).toBe(200);
      const list = (await reordered.json()) as Provider[];
      expect(list.map((provider) => provider.id)).toEqual(["c", "a", "b"]);
      expect(list[0]?.priority).toBeGreaterThan(list[1]!.priority);
    } finally {
      ctx.close();
    }
  });

  test("enables, disables, tests, and deletes providers", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      const created = await createProvider(ctx, {
        id: "firecrawl",
        type: "firecrawl",
        baseUrl: upstream.url,
        priority: 10,
      });
      expect(created.status).toBe(201);

      const disabled = await request(ctx.app, "/api/providers/firecrawl/disable", {
        method: "POST",
      });
      expect(disabled.status).toBe(200);
      expect((await disabled.json()) as Provider).toMatchObject({ enabled: false });

      const enabled = await request(ctx.app, "/api/providers/firecrawl/enable", {
        method: "POST",
      });
      expect(enabled.status).toBe(200);
      expect((await enabled.json()) as Provider).toMatchObject({
        enabled: true,
        health: "unknown",
      });

      const tested = await request(ctx.app, "/api/providers/firecrawl/test", {
        method: "POST",
      });
      expect(tested.status).toBe(200);
      const result = (await tested.json()) as ProviderTestResult;
      expect(result.ok).toBe(true);
      expect(result.state.health).toBe("healthy");

      const events = await request(ctx.app, "/api/providers/firecrawl/events");
      expect(events.status).toBe(200);
      const eventRows = (await events.json()) as { event: string }[];
      expect(eventRows.some((event) => event.event === "test_ok")).toBe(true);

      const deleted = await request(ctx.app, "/api/providers/firecrawl", { method: "DELETE" });
      expect(deleted.status).toBe(200);
      expect((await request(ctx.app, "/api/providers/firecrawl")).status).toBe(404);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("exposes adapter metadata and presets", async () => {
    const ctx = await createTestContext();
    try {
      const response = await request(ctx.app, "/api/providers/types");
      expect(response.status).toBe(200);
      const types = (await response.json()) as {
        type: string;
        presets?: { id: string }[];
      }[];
      expect(types.map((type) => type.type)).toEqual(
        expect.arrayContaining(["firecrawl", "deepseek", "generic"]),
      );
      const generic = types.find((type) => type.type === "generic");
      expect(generic?.presets?.map((preset) => preset.id)).toEqual(
        expect.arrayContaining([
          "tavily",
          "brave",
          "searxng",
          "exa",
          "serper",
          "duckduckgo",
          "google-cse",
          "serpapi",
          "searchapi",
          "scrapingdog",
          "valueserp",
          "zenserp",
          "kagi",
          "youcom",
          "newsapi",
          "gnews",
          "hackernews",
          "github",
          "stackexchange",
          "reddit",
          "crossref",
          "semantic-scholar",
          "google-books",
          "custom",
        ]),
      );
    } finally {
      ctx.close();
    }
  });
});
