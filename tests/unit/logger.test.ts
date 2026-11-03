import { describe, expect, test } from "bun:test";
import { createTestContext } from "../helpers/runtime";
import type { RequestLogInput } from "../../src/types";

function logInput(overrides: Partial<RequestLogInput> = {}): RequestLogInput {
  return {
    requestId: crypto.randomUUID(),
    method: "POST",
    path: "/v1/search",
    query: "?x=1",
    requestHeaders: {
      authorization: "Bearer wsr_secret",
      "x-api-key": "wsr_secret",
      "content-type": "application/json",
    },
    requestBody: JSON.stringify({ query: "hello", apiKey: "secret" }),
    operation: "search",
    providerId: "p1",
    providerType: "firecrawl",
    attempts: [],
    responseStatus: 200,
    responseHeaders: { "set-cookie": "secret=1", "content-type": "application/json" },
    responseBody: JSON.stringify({ success: true, token: "secret" }),
    durationMs: 12,
    error: null,
    errorKind: null,
    keyId: "k1",
    clientIp: "127.0.0.1",
    ...overrides,
  };
}

describe("Logger", () => {
  test("redacts credentials from headers and bodies", async () => {
    const ctx = await createTestContext();
    try {
      ctx.runtime.logger.log(logInput());
      const result = ctx.runtime.logger.query({ limit: 10 });
      expect(result.total).toBe(1);
      const row = result.rows[0];
      expect(row.requestHeaders.authorization).toBe("[redacted]");
      expect(row.requestHeaders["x-api-key"]).toBe("[redacted]");
      expect(row.responseHeaders["set-cookie"]).toBe("[redacted]");
      expect(row.requestBody).not.toContain("secret");
      expect(row.responseBody).not.toContain("\"secret\"");
      expect(row.requestBody).toContain("hello");
    } finally {
      ctx.close();
    }
  });

  test("computes stats and bounded timeseries", async () => {
    const ctx = await createTestContext();
    try {
      ctx.runtime.logger.log(logInput({ responseStatus: 200, durationMs: 10 }));
      ctx.runtime.logger.log(logInput({ responseStatus: 500, durationMs: 30, error: "boom" }));
      const stats = ctx.runtime.logger.stats();
      expect(stats.total).toBe(2);
      expect(stats.successCount).toBe(1);
      expect(stats.errorCount).toBe(1);
      expect(stats.p50).toBeGreaterThan(0);
      expect(stats.perProvider[0]?.providerId).toBe("p1");

      const series = ctx.runtime.logger.timeseries(60, 5);
      expect(series.buckets.length).toBe(12);
      expect(series.buckets.some((bucket) => bucket.requests > 0)).toBe(true);
    } finally {
      ctx.close();
    }
  });

  test("clamps query limits and supports filters", async () => {
    const ctx = await createTestContext();
    try {
      for (let i = 0; i < 5; i++) ctx.runtime.logger.log(logInput());
      const result = ctx.runtime.logger.query({ limit: -1, offset: -4 });
      expect(result.rows.length).toBe(1);
      expect(ctx.runtime.logger.query({ provider_id: "nope" }).total).toBe(0);
      expect(ctx.runtime.logger.query({ status: null }).total).toBe(0);
    } finally {
      ctx.close();
    }
  });
});
