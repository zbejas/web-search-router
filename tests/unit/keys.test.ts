import { describe, expect, test } from "bun:test";
import { KeyService } from "../../src/apikeys";
import { createTestContext } from "../helpers/runtime";

describe("KeyService", () => {
  test("creates wsr_ keys, validates them, and updates last_used_at", async () => {
    const ctx = await createTestContext();
    try {
      const user = await ctx.runtime.auth.createUser("keyuser", "password123", "admin");
      const { key, row } = ctx.runtime.keys.create(user.id, "test", ["search"]);
      expect(key.startsWith("wsr_")).toBe(true);
      expect(row.scopes).toEqual(["search"]);
      expect(row.keyPrefix).toBe(key.slice(0, 10));

      const validation = ctx.runtime.keys.validate(key);
      expect(validation?.userId).toBe(user.id);
      expect(validation?.scopes).toEqual(["search"]);
      expect(KeyService.allowsScope(validation!.scopes, "search")).toBe(true);
      expect(KeyService.allowsScope(validation!.scopes, "scrape")).toBe(false);

      const lastUsed = ctx.runtime.db
        .prepare("SELECT last_used_at FROM api_keys WHERE id = ?")
        .get(row.id) as { last_used_at: string | null };
      expect(lastUsed.last_used_at).not.toBeNull();
    } finally {
      ctx.close();
    }
  });

  test("rejects invalid scopes and normalizes *", async () => {
    const ctx = await createTestContext();
    try {
      const user = await ctx.runtime.auth.createUser("scopeuser", "password123", "user");
      expect(() => ctx.runtime.keys.create(user.id, "bad", ["nope" as never])).toThrow(
        "Invalid API key scope",
      );
      const { row } = ctx.runtime.keys.create(user.id, "star", ["*", "search"]);
      expect(row.scopes).toEqual(["*"]);
    } finally {
      ctx.close();
    }
  });

  test("revoked and unknown keys are rejected", async () => {
    const ctx = await createTestContext();
    try {
      const user = await ctx.runtime.auth.createUser("keyuser2", "password123", "user");
      const { key, row } = ctx.runtime.keys.create(user.id, "test");
      expect(ctx.runtime.keys.revoke(row.id)).toBe(true);
      expect(ctx.runtime.keys.validate(key)).toBeNull();
      expect(ctx.runtime.keys.validate("wsr_does_not_exist")).toBeNull();
      expect(ctx.runtime.keys.validate("fr_legacy_but_unknown")).toBeNull();
    } finally {
      ctx.close();
    }
  });

  test("old fr_ keys still validate after migration", async () => {
    const ctx = await createTestContext();
    try {
      const user = await ctx.runtime.auth.createUser("legacy", "password123", "user");
      const key = `fr_${crypto.randomUUID()}`;
      const hash = Bun.SHA512.hash(key, "hex") as string;
      ctx.runtime.db
        .prepare(
          "INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(crypto.randomUUID(), user.id, "legacy", hash, key.slice(0, 8), '["*"]');
      expect(ctx.runtime.keys.validate(key)?.userId).toBe(user.id);
    } finally {
      ctx.close();
    }
  });
});
