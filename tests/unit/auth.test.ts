import { describe, expect, test } from "bun:test";
import { createTestContext } from "../helpers/runtime";

describe("AuthService", () => {
  test("creates users, logs in, validates sessions, and logs out", async () => {
    const ctx = await createTestContext();
    try {
      const user = await ctx.runtime.auth.createUser("alice", "password123", "admin");
      expect(user.role).toBe("admin");

      const session = await ctx.runtime.auth.login("alice", "password123");
      expect(session?.user.username).toBe("alice");
      expect(ctx.runtime.auth.getSessionUser(session!.token)?.id).toBe(user.id);

      ctx.runtime.auth.logout(session!.token);
      expect(ctx.runtime.auth.getSessionUser(session!.token)).toBeNull();
      expect(await ctx.runtime.auth.login("alice", "wrong-password")).toBeNull();
    } finally {
      ctx.close();
    }
  });

  test("rejects weak passwords and duplicate usernames", async () => {
    const ctx = await createTestContext();
    try {
      await expect(ctx.runtime.auth.createUser("bob", "short", "user")).rejects.toThrow();
      await ctx.runtime.auth.createUser("bob", "password123", "user");
      await expect(ctx.runtime.auth.createUser("bob", "password123", "user")).rejects.toThrow();
    } finally {
      ctx.close();
    }
  });

  test("changes passwords and prevents deleting the last admin", async () => {
    const ctx = await createTestContext();
    try {
      const admin = await ctx.runtime.auth.createUser("admin2", "password123", "admin");
      expect(await ctx.runtime.auth.changePassword(admin.id, "wrong", "newpassword123")).toBe(false);
      expect(await ctx.runtime.auth.changePassword(admin.id, "password123", "newpassword123")).toBe(true);
      expect(await ctx.runtime.auth.login("admin2", "newpassword123")).not.toBeNull();
      expect(() => ctx.runtime.auth.deleteUser(admin.id)).toThrow("last admin");
    } finally {
      ctx.close();
    }
  });

  test("expired sessions are rejected", async () => {
    const ctx = await createTestContext();
    try {
      await ctx.runtime.auth.createUser("expired", "password123", "user");
      const session = await ctx.runtime.auth.login("expired", "password123");
      ctx.runtime.db
        .prepare("UPDATE sessions SET expires_at = datetime('now', '-1 day') WHERE token = ?")
        .run(session!.token);
      expect(ctx.runtime.auth.getSessionUser(session!.token)).toBeNull();
    } finally {
      ctx.close();
    }
  });
});
