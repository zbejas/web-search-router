import { describe, expect, test } from "bun:test";
import { randomId } from "../../src/client/lib/random";

describe("client random IDs", () => {
  test("uses randomUUID when the browser exposes it", () => {
    expect(randomId({ randomUUID: () => "fixed-uuid" })).toBe("fixed-uuid");
  });

  test("falls back to getRandomValues in a non-secure context", () => {
    const id = randomId({
      getRandomValues: (bytes) => crypto.getRandomValues(bytes),
    });
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("has a final fallback when Web Crypto is unavailable", () => {
    expect(randomId({})).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });
});
