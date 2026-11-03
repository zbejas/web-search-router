import { describe, expect, test } from "bun:test";
import { detectOperation, orderCandidates } from "../../src/router";
import type { ProviderRecord } from "../../src/types";

function provider(overrides: Partial<ProviderRecord>): ProviderRecord {
  return {
    id: "p",
    name: "Provider",
    type: "firecrawl",
    baseUrl: "http://localhost",
    apiKey: null,
    apiKeyEncrypted: null,
    apiKeyHint: null,
    priority: 10,
    enabled: true,
    health: "healthy",
    consecutiveFailures: 0,
    lastCheckedAt: null,
    lastHealthyAt: null,
    lastError: null,
    lastStatusCode: null,
    lastLatencyMs: null,
    creditsRemaining: null,
    creditsPlan: null,
    creditsPeriodEnd: null,
    creditsCheckedAt: null,
    capabilities: [],
    config: {},
    probeIntervalSeconds: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("detectOperation", () => {
  test("maps Firecrawl v1/v2 paths to capabilities", () => {
    expect(detectOperation("/v1/search")).toBe("search");
    expect(detectOperation("/v2/search")).toBe("search");
    expect(detectOperation("/v1/scrape")).toBe("scrape");
    expect(detectOperation("/v2/crawl")).toBe("crawl");
    expect(detectOperation("/v2/crawl/abc")).toBe("crawl");
    expect(detectOperation("/v2/map")).toBe("map");
    expect(detectOperation("/v1/extract")).toBe("extract");
    expect(detectOperation("/v2/batch/scrape")).toBe("batch_scrape");
    expect(detectOperation("/api/search")).toBe("search");
    expect(detectOperation("/search")).toBe("search");
    expect(detectOperation("/v1/team/credit-usage")).toBe("proxy");
  });
});

describe("orderCandidates", () => {
  test("orders by priority descending and separates unhealthy providers", () => {
    const a = provider({ id: "a", priority: 10 });
    const b = provider({ id: "b", priority: 50 });
    const c = provider({ id: "c", priority: 30, health: "unhealthy" });
    const d = provider({ id: "d", priority: 100, enabled: false });
    const result = orderCandidates([a, b, c, d], "search");
    expect(result.primary.map((p) => p.id)).toEqual(["b", "a"]);
    expect(result.lastResort.map((p) => p.id)).toEqual(["c"]);
    expect(result.supporting.map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  test("filters by capability", () => {
    const firecrawl = provider({ id: "fc", type: "firecrawl", priority: 10 });
    const deepseek = provider({
      id: "ds",
      type: "deepseek",
      priority: 100,
      capabilities: ["search"],
    });
    const search = orderCandidates([firecrawl, deepseek], "search");
    expect(search.supporting.map((p) => p.id)).toEqual(["ds", "fc"]);

    const scrape = orderCandidates([firecrawl, deepseek], "scrape");
    expect(scrape.supporting.map((p) => p.id)).toEqual(["fc"]);
  });

  test("unknown health is eligible before unhealthy providers", () => {
    const unknown = provider({ id: "unknown", health: "unknown", priority: 1 });
    const healthy = provider({ id: "healthy", health: "healthy", priority: 100 });
    const unhealthy = provider({ id: "unhealthy", health: "unhealthy", priority: 1000 });
    const result = orderCandidates([unknown, healthy, unhealthy], "search");
    expect(result.primary.map((p) => p.id)).toEqual(["healthy", "unknown"]);
    expect(result.lastResort.map((p) => p.id)).toEqual(["unhealthy"]);
  });
});
