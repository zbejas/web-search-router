import { describe, expect, test } from "bun:test";
import { createTestContext, request } from "../helpers/runtime";
import { startMockUpstream } from "../helpers/upstream";

async function search(ctx: Awaited<ReturnType<typeof createTestContext>>) {
  return request(ctx.app, "/v2/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "hello" }),
  });
}

describe("rate limiting", () => {
  test("enforces a per-key sliding window and returns useful headers", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await request(ctx.app, "/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "fc", type: "firecrawl", baseUrl: upstream.url }),
      });
      ctx.runtime.settings.update({ rateLimit: { enabled: true, rpm: 2 } });

      const first = await search(ctx);
      expect(first.status).toBe(200);
      expect(first.headers.get("x-ratelimit-limit")).toBe("2");
      expect(first.headers.get("x-ratelimit-remaining")).toBe("1");

      const second = await search(ctx);
      expect(second.status).toBe(200);
      expect(second.headers.get("x-ratelimit-remaining")).toBe("0");

      const third = await search(ctx);
      expect(third.status).toBe(429);
      expect(third.headers.get("retry-after")).toBe("60");
      expect(upstream.requests.length).toBe(2);

      ctx.runtime.rateLimit.reset();
      const afterReset = await search(ctx);
      expect(afterReset.status).toBe(200);
    } finally {
      upstream.close();
      ctx.close();
    }
  });

  test("disabled rate limiting does not restrict traffic", async () => {
    const ctx = await createTestContext();
    const upstream = startMockUpstream();
    try {
      await request(ctx.app, "/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "fc", type: "firecrawl", baseUrl: upstream.url }),
      });
      for (let i = 0; i < 5; i++) {
        expect((await search(ctx)).status).toBe(200);
      }
    } finally {
      upstream.close();
      ctx.close();
    }
  });
});
