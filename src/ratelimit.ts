import type { SettingsService } from "./settings";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export class RateLimitService {
  private readonly windows = new Map<string, number[]>();

  constructor(private readonly settings: SettingsService) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const config = this.settings.get().rateLimit;
    const limit = config.rpm;
    const resetAt = now + 60_000;
    if (!config.enabled) {
      return { allowed: true, limit, remaining: limit, resetAt };
    }

    const cutoff = now - 60_000;
    const timestamps = (this.windows.get(key) ?? []).filter((time) => time > cutoff);
    if (timestamps.length >= limit) {
      this.windows.set(key, timestamps);
      return { allowed: false, limit, remaining: 0, resetAt };
    }
    timestamps.push(now);
    this.windows.set(key, timestamps);
    this.cleanupOccasionally(now);
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - timestamps.length),
      resetAt,
    };
  }

  private cleanupOccasionally(now: number): void {
    if (this.windows.size < 1_000) return;
    const cutoff = now - 60_000;
    for (const [key, timestamps] of this.windows) {
      const live = timestamps.filter((time) => time > cutoff);
      if (live.length === 0) this.windows.delete(key);
      else this.windows.set(key, live);
    }
  }

  reset(): void {
    this.windows.clear();
  }
}
