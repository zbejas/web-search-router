import type {
  ProbeResult,
  ProviderRecord,
  ProviderTestResult,
  Settings,
} from "./types";
import type { ProviderStore } from "./providers/store";
import { getAdapter } from "./providers/registry";
import type { SettingsService } from "./settings";
import { nowIso } from "./utils";

interface DueOptions {
  force?: boolean;
  includeHealthy?: boolean;
}

function isDue(provider: ProviderRecord, settings: Settings, options: DueOptions): boolean {
  if (!provider.enabled) return false;
  if (options.force) return true;
  const probeHealthy = options.includeHealthy || settings.routing.probeHealthy;
  if (provider.health === "healthy" && !probeHealthy) return false;
  const interval =
    (provider.probeIntervalSeconds ?? settings.routing.healthCheckIntervalSeconds) * 1_000;
  if (!provider.lastCheckedAt) return true;
  const last = new Date(provider.lastCheckedAt).getTime();
  return !Number.isFinite(last) || Date.now() - last >= interval;
}

export class HealthService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly providers: ProviderStore,
    private readonly settings: SettingsService,
  ) {}

  async probe(provider: ProviderRecord): Promise<ProbeResult> {
    const settings = this.settings.get();
    try {
      return await getAdapter(provider.type).probe(provider, settings);
    } catch (error) {
      return {
        ok: false,
        statusCode: null,
        latencyMs: 0,
        body: null,
        error: error instanceof Error ? error.message : "Provider probe failed",
        hint: "The provider adapter could not run a probe.",
        failureKind: "unknown",
      };
    }
  }

  async testProvider(id: string): Promise<ProviderTestResult | null> {
    const provider = await this.providers.getInternal(id);
    if (!provider) return null;
    const result = await this.probe(provider);
    const settings = this.settings.get();
    const { provider: updated } = await this.providers.recordProbe(id, result, settings, {
      forceRecover: true,
    });
    this.providers.addEvent(
      id,
      result.ok ? "test_ok" : "test_failed",
      result.ok ? "Manual test succeeded" : `Manual test failed: ${result.error ?? "unknown error"}`,
      result.statusCode,
      result.latencyMs,
    );
    const publicProvider = await this.providers.getPublic(id);
    return {
      ...result,
      providerId: id,
      providerType: provider.type,
      checkedAt: nowIso(),
      state: publicProvider!,
    };
  }

  async runDueChecks(options: DueOptions = {}): Promise<ProviderTestResult[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const settings = this.settings.get();
      const all = await this.providers.listInternal();
      const due = all
        .filter((provider) => isDue(provider, settings, options))
        .sort((a, b) => {
          const aTime = a.lastCheckedAt ? new Date(a.lastCheckedAt).getTime() : 0;
          const bTime = b.lastCheckedAt ? new Date(b.lastCheckedAt).getTime() : 0;
          return aTime - bTime || b.priority - a.priority;
        });

      const results: ProviderTestResult[] = [];
      const concurrency = Math.min(4, Math.max(1, due.length));
      let nextIndex = 0;

      const worker = async () => {
        while (nextIndex < due.length) {
          const provider = due[nextIndex++];
          const result = await this.probe(provider);
          const { provider: updated } = await this.providers.recordProbe(
            provider.id,
            result,
            settings,
          );
          if (!updated) continue;
          const publicProvider = await this.providers.getPublic(provider.id);
          results.push({
            ...result,
            providerId: provider.id,
            providerType: provider.type,
            checkedAt: nowIso(),
            state: publicProvider!,
          });
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      return results;
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runDueChecks().catch((error) => {
        console.error("Health check cycle failed:", error);
      });
    }, 1_000);
    this.runDueChecks().catch((error) => {
      console.error("Initial health check failed:", error);
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  isRunning(): boolean {
    return this.running;
  }
}
