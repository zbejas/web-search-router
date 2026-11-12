export type MockMode =
  | "ok"
  | "fail400"
  | "fail401"
  | "fail402"
  | "fail429"
  | "fail500"
  | "timeout"
  | "invalid";

export interface CapturedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface MockUpstream {
  url: string;
  requests: CapturedRequest[];
  mode: MockMode;
  healthMode: "ok" | "fail";
  billingAccess: "ok" | "forbidden";
  usageAccess: "ok" | "forbidden";
  creditsRemaining: number;
  setMode: (mode: MockMode) => void;
  setHealthMode: (mode: "ok" | "fail") => void;
  setBillingAccess: (mode: "ok" | "forbidden") => void;
  setUsageAccess: (mode: "ok" | "forbidden") => void;
  setCredits: (credits: number) => void;
  close: () => void;
}

function firecrawlSearch(version: "v1" | "v2", title: string): unknown {
  const item = {
    url: "https://example.com/result",
    title,
    description: "Mock search result",
  };
  if (version === "v1") return { success: true, data: [item] };
  return {
    success: true,
    data: { web: [{ ...item, position: 1 }] },
    creditsUsed: 2,
    id: crypto.randomUUID(),
  };
}

export function startMockUpstream(port = 0): MockUpstream {
  const requests: CapturedRequest[] = [];
  const state = {
    mode: "ok" as MockMode,
    healthMode: "ok" as "ok" | "fail",
    billingAccess: "ok" as "ok" | "forbidden",
    usageAccess: "ok" as "ok" | "forbidden",
    creditsRemaining: 1_000,
  };

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.body ? await req.text() : null;
      requests.push({
        method: req.method,
        path: url.pathname + url.search,
        headers: Object.fromEntries(req.headers.entries()),
        body,
      });

      if (state.mode === "timeout") {
        await Bun.sleep(2_000);
      }

      // Out-of-process control surface for the E2E suite, which talks to the mock
      // over HTTP instead of holding the Bun.serve handle.
      if (url.pathname === "/__mock/credits") {
        const payload = body ? (JSON.parse(body) as { remaining?: unknown }) : {};
        if (typeof payload.remaining === "number") state.creditsRemaining = payload.remaining;
        return Response.json({ remaining: state.creditsRemaining });
      }

      if (url.pathname === "/v0/health/readiness") {
        if (state.healthMode === "fail") {
          return Response.json({ status: "unhealthy" }, { status: 503 });
        }
        return Response.json({ status: "ok" });
      }

      if (url.pathname === "/v2/team/credit-usage") {
        if (state.mode === "ok") {
          return Response.json({
            success: true,
            data: {
              remainingCredits: state.creditsRemaining,
              planCredits: 5_000,
              billingPeriodStart: "2026-11-01T00:00:00.000Z",
              billingPeriodEnd: "2026-12-01T00:00:00.000Z",
            },
          });
        }
        return failureResponse(state.mode);
      }

      if (url.pathname === "/v1/search" || url.pathname === "/v2/search") {
        if (state.mode !== "ok") return failureResponse(state.mode);
        return Response.json(
          firecrawlSearch(url.pathname.startsWith("/v1") ? "v1" : "v2", "Firecrawl mock"),
        );
      }

      if (url.pathname === "/v1/scrape" || url.pathname === "/v2/scrape") {
        if (state.mode !== "ok") return failureResponse(state.mode);
        return Response.json({ success: true, data: { markdown: "# mock" } });
      }

      if (url.pathname === "/v1/tools/search") {
        if (state.mode !== "ok") return failureResponse(state.mode);
        return Response.json({
          results: [
            {
              title: "DeepSeek mock",
              url: "https://example.com/deepseek",
              snippet: "A DeepSeek search result",
              summary: "Summary",
              content: "Content",
              site_name: "Example",
              date: "2026-01-01T00:00:00Z",
              rerank_score: 2.4,
            },
          ],
        });
      }

      if (url.pathname === "/console/api/websearch") {
        if (state.mode !== "ok") return failureResponse(state.mode);
        return Response.json({
          providerID: "opencode",
          results: [
            {
              title: "OpenCode mock",
              url: "https://example.com/opencode",
              content: "An OpenCode hosted search result",
              time: { published: 1_792_627_200_000 },
            },
            {
              title: "OpenCode undated",
              url: "https://example.com/opencode-undated",
              content: "A second OpenCode result",
              time: {},
            },
          ],
        });
      }

      if (url.pathname === "/console/api/usage/summary") {
        if (state.usageAccess === "forbidden") {
          return Response.json({ _tag: "Forbidden" }, { status: 403 });
        }
        if (state.mode !== "ok") return failureResponse(state.mode);
        return Response.json({
          totalRequests: "30",
          totalInputTokens: "0",
          totalOutputTokens: "0",
          totalCacheReadTokens: "0",
          totalCacheWrite5mTokens: "0",
          totalCacheWrite1hTokens: "0",
          totalCostMicroCents: "1801426762",
          services: [
            {
              service: "web-search",
              totalRequests: "7",
              totalCostMicroCents: "7000000",
            },
          ],
        });
      }

      if (url.pathname === "/console/api/billing/status") {
        if (state.billingAccess === "forbidden") {
          return Response.json({ _tag: "Forbidden" }, { status: 403 });
        }
        if (state.mode !== "ok") return failureResponse(state.mode);
        return Response.json({
          billingMode: "pay-as-you-go",
          mode: "pay-as-you-go",
          balanceMicroCents: 1_234_000_000,
          creditLimitMicroCents: null,
          availableMicroCents: 1_000_000_000,
          canPurchaseCredits: true,
          canEnableAutoRecharge: true,
        });
      }

      if (url.pathname === "/" && url.searchParams.has("q")) {
        if (state.mode !== "ok") return failureResponse(state.mode);
        return Response.json({
          RelatedTopics: [
            {
              FirstURL: "https://example.com/duckduckgo",
              Text: "DuckDuckGo result",
            },
            {
              Name: "Nested topic group",
              Topics: [
                {
                  FirstURL: "https://example.com/nested",
                  Text: "Nested DuckDuckGo result",
                },
              ],
            },
          ],
        });
      }

      if (url.pathname === "/search") {
        if (state.mode !== "ok") return failureResponse(state.mode);
        return Response.json({
          results: [
            {
              title: "Generic mock",
              url: "https://example.com/generic",
              content: "A generic search result",
            },
          ],
          usage: { credits: 1 },
        });
      }

      if (url.pathname === "/healthz") {
        return new Response("OK");
      }

      if (url.pathname === "/usage") {
        if (state.mode !== "ok") return failureResponse(state.mode);
        return Response.json({ usage: 1 });
      }

      if (url.pathname === "/res/v1/web/search") {
        if (state.mode !== "ok") return failureResponse(state.mode);
        return Response.json({
          web: {
            results: [
              { title: "Brave mock", url: "https://example.com/brave", description: "Brave result" },
            ],
          },
        });
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    get mode() {
      return state.mode;
    },
    set mode(value: MockMode) {
      state.mode = value;
    },
    get healthMode() {
      return state.healthMode;
    },
    set healthMode(value: "ok" | "fail") {
      state.healthMode = value;
    },
    get billingAccess() {
      return state.billingAccess;
    },
    set billingAccess(value: "ok" | "forbidden") {
      state.billingAccess = value;
    },
    get usageAccess() {
      return state.usageAccess;
    },
    set usageAccess(value: "ok" | "forbidden") {
      state.usageAccess = value;
    },
    get creditsRemaining() {
      return state.creditsRemaining;
    },
    set creditsRemaining(value: number) {
      state.creditsRemaining = value;
    },
    setMode: (mode) => {
      state.mode = mode;
    },
    setHealthMode: (mode) => {
      state.healthMode = mode;
    },
    setBillingAccess: (mode) => {
      state.billingAccess = mode;
    },
    setUsageAccess: (mode) => {
      state.usageAccess = mode;
    },
    setCredits: (credits) => {
      state.creditsRemaining = credits;
    },
    close: () => server.stop(true),
  };
}

function failureResponse(mode: MockMode): Response {
  if (mode === "invalid") {
    return new Response("<html>not json</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  if (mode === "fail400") {
    return Response.json({ success: false, error: "Bad request from upstream" }, { status: 400 });
  }
  if (mode === "fail401") {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (mode === "fail402") {
    return Response.json({ success: false, error: "Payment required" }, { status: 402 });
  }
  if (mode === "fail429") {
    return Response.json(
      { success: false, error: "Rate limited" },
      { status: 429, headers: { "retry-after": "30" } },
    );
  }
  return Response.json({ success: false, error: "Server error" }, { status: 500 });
}
