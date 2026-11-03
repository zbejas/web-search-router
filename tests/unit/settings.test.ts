import { describe, expect, test } from "bun:test";
import { SettingsService, SettingsValidationError } from "../../src/settings";
import { createTestContext } from "../helpers/runtime";

describe("SettingsService", () => {
  test("starts with documented defaults", async () => {
    const ctx = await createTestContext();
    try {
      const settings = ctx.runtime.settings.get();
      expect(settings.routing.failureThreshold).toBe(3);
      expect(settings.routing.healthCheckIntervalSeconds).toBe(300);
      expect(settings.auth.enabled).toBe(false);
      expect(settings.rateLimit.enabled).toBe(false);
    } finally {
      ctx.close();
    }
  });

  test("persists validated grouped updates and reloads them", async () => {
    const ctx = await createTestContext();
    try {
      ctx.runtime.settings.update({
        routing: { failureThreshold: 7, healthCheckIntervalSeconds: 60 },
        rateLimit: { enabled: true, rpm: 120 },
      });
      const reloaded = new SettingsService(ctx.runtime.db);
      expect(reloaded.get().routing.failureThreshold).toBe(7);
      expect(reloaded.get().routing.healthCheckIntervalSeconds).toBe(60);
      expect(reloaded.get().rateLimit.enabled).toBe(true);
      expect(reloaded.get().rateLimit.rpm).toBe(120);
    } finally {
      ctx.close();
    }
  });

  test("accepts flat keys and rejects unknown or out-of-range settings", async () => {
    const ctx = await createTestContext();
    try {
      ctx.runtime.settings.update({ "logging.retentionDays": 14 });
      expect(ctx.runtime.settings.get().logging.retentionDays).toBe(14);

      expect(() => ctx.runtime.settings.update({ "routing.nope": 1 })).toThrow(
        SettingsValidationError,
      );
      expect(() =>
        ctx.runtime.settings.update({ routing: { failureThreshold: 0 } }),
      ).toThrow(SettingsValidationError);
      expect(() =>
        ctx.runtime.settings.update({ rateLimit: { rpm: -1 } }),
      ).toThrow(SettingsValidationError);
      expect(() =>
        ctx.runtime.settings.update({ routing: { failureThreshold: 2.5 } }),
      ).toThrow(SettingsValidationError);
    } finally {
      ctx.close();
    }
  });

  test("reset restores defaults", async () => {
    const ctx = await createTestContext();
    try {
      ctx.runtime.settings.update({ routing: { failureThreshold: 9 } });
      const reset = ctx.runtime.settings.reset();
      expect(reset.routing.failureThreshold).toBe(3);
    } finally {
      ctx.close();
    }
  });
});
