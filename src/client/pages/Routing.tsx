import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, RefreshCw, Save, ShieldAlert, Timer, Waypoints } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../hooks/useToast";
import type { Provider, Settings } from "../lib/api";
import { api } from "../lib/api";
import { formatDuration, formatRelative } from "../lib/format";
import { HealthBadge, ProviderTypeMark } from "../components/status";
import { Badge, Button, ErrorNotice, Field, Input, LoadError, Panel, Skeleton, Toggle } from "../components/ui";

export function RoutingPage() {
  const { push } = useToast();
  const { isAdmin } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSettings, nextProviders] = await Promise.all([api.settings(), api.providers()]);
      setSettings(nextSettings);
      setProviders(nextProviders);
      setDirty(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load routing policy");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const update = (group: keyof Settings, key: string, value: number | boolean) => {
    setSettings((current) => {
      if (!current) return current;
      return { ...current, [group]: { ...current[group], [key]: value } };
    });
    setDirty(true);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const next = await api.patchSettings({
        routing: settings.routing,
      });
      setSettings(next);
      setDirty(false);
      push("Routing policy saved", "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not save policy", "error");
    } finally {
      setSaving(false);
    }
  };

  const probe = async () => {
    setProbing(true);
    try {
      const result = await api.healthCheck();
      push(result.checked === 0 ? "No providers were due." : `Probed ${result.checked} provider${result.checked === 1 ? "" : "s"}.`, "success");
      await load();
    } catch (err) {
      push(err instanceof Error ? err.message : "Probe failed", "error");
    } finally {
      setProbing(false);
    }
  };

  const reorder = async (provider: Provider, direction: -1 | 1) => {
    const ordered = [...providers].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
    const index = ordered.findIndex((item) => item.id === provider.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    try {
      setProviders(await api.reorderProviders(next.map((item) => item.id)));
      push("Route order updated", "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not reorder", "error");
    }
  };

  if (loading && !settings) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="space-y-5">
        <div>
          <p className="mono-label mb-2">Policy surface</p>
          <h2 className="text-[26px] font-extrabold tracking-[-0.03em] text-ink">Routing</h2>
        </div>
        <LoadError message={error ?? "Could not load routing policy"} onRetry={() => load()} />
      </div>
    );
  }

  const ordered = [...providers].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  const routing = settings.routing;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mono-label mb-2">Policy surface</p>
          <h2 className="text-[26px] font-extrabold tracking-[-0.03em] text-ink">Routing</h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted">
            The route is evaluated on every request. Health state changes here apply without a restart.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty ? <Badge tone="warn">Unsaved changes</Badge> : null}
          <Button variant="secondary" onClick={probe} loading={probing} disabled={!isAdmin}>
            <RefreshCw size={13} /> Probe now
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!isAdmin || !dirty}>
            <Save size={13} /> Save policy
          </Button>
        </div>
      </div>

      {error ? <ErrorNotice message={error} /> : null}

      <div className="grid items-start gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Panel eyebrow="Route order" title="Priority chain" action={<Badge tone="dim">{ordered.length} providers</Badge>}>
          {ordered.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted">No providers configured.</p>
          ) : (
            <div className="space-y-0">
              {ordered.map((provider, index) => (
                <div key={provider.id} className="flex items-center gap-3 border-b border-line py-3 last:border-0">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-line font-mono text-[10px] font-bold text-muted">
                    {index + 1}
                  </span>
                  <ProviderTypeMark type={provider.type} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-xs font-bold text-ink">{provider.name}</span>
                      <span className="mono-label">{provider.type}</span>
                    </div>
                    <p className="mt-0.5 font-mono text-[9px] text-dim">
                      priority {provider.priority} · {provider.enabled ? formatRelative(provider.lastCheckedAt) : "manual off"}
                    </p>
                  </div>
                  <HealthBadge health={provider.health} enabled={provider.enabled} />
                  <div className="flex flex-col">
                    <button
                      className="grid h-6 w-6 place-items-center text-dim hover:text-ink disabled:opacity-20"
                      onClick={() => reorder(provider, -1)}
                      disabled={!isAdmin || index === 0}
                      aria-label={`Raise ${provider.name}`}
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      className="grid h-6 w-6 place-items-center text-dim hover:text-ink disabled:opacity-20"
                      onClick={() => reorder(provider, 1)}
                      disabled={!isAdmin || index === ordered.length - 1}
                      aria-label={`Lower ${provider.name}`}
                    >
                      <ArrowDown size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-4 border-t border-line pt-3 text-[10px] leading-relaxed text-dim">
            Higher numbers are tried first. Auto-disabled providers are moved to the last-resort phase,
            not deleted from the chain.
          </p>
        </Panel>

        <div className="space-y-4">
          <Panel eyebrow="Recovery" title="Failure and probe policy">
            <div className="space-y-4">
              <Field label="Failures before auto-disable" help="Consecutive provider-caused failures. Client 4xx errors do not count.">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={routing.failureThreshold}
                  onChange={(event) => update("routing", "failureThreshold", Number(event.target.value))}
                />
              </Field>
              <Field label="Probe interval (seconds)" help="Unhealthy and unverified providers are checked on this cadence.">
                <Input
                  type="number"
                  min={10}
                  max={86_400}
                  value={routing.healthCheckIntervalSeconds}
                  onChange={(event) => update("routing", "healthCheckIntervalSeconds", Number(event.target.value))}
                />
              </Field>
              <div className="flex items-center justify-between gap-4 border-t border-line pt-3">
                <div>
                  <p className="text-xs font-semibold text-ink">Automatic recovery</p>
                  <p className="mt-0.5 text-[10px] text-dim">A successful probe moves an auto-disabled provider back to healthy.</p>
                </div>
                <Toggle checked={routing.autoRecoverEnabled} onChange={(value) => update("routing", "autoRecoverEnabled", value)} label="Automatic recovery" />
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-line pt-3">
                <div>
                  <p className="text-xs font-semibold text-ink">Probe healthy providers</p>
                  <p className="mt-0.5 text-[10px] text-dim">Optional continuous checks. Off by default to avoid unnecessary provider calls.</p>
                </div>
                <Toggle checked={routing.probeHealthy} onChange={(value) => update("routing", "probeHealthy", value)} label="Probe healthy providers" />
              </div>
            </div>
          </Panel>

          <Panel eyebrow="Last resort" title="When everything is down">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-ink">Try auto-disabled providers last</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-dim">
                  If every healthy provider fails, retry the standby lane once before returning 502.
                  Manually disabled providers are always excluded.
                </p>
              </div>
              <Toggle checked={routing.lastResortEnabled} onChange={(value) => update("routing", "lastResortEnabled", value)} label="Last-resort failover" />
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-sm border border-warn/25 bg-warn/5 px-3 py-2.5 text-[10px] leading-relaxed text-warn">
              <ShieldAlert size={14} className="mt-0.5 shrink-0" />
              A last-resort request records a failure against the standby provider if it also fails.
            </div>
          </Panel>
        </div>
      </div>

      <Panel eyebrow="Limits" title="Time budget and attempts">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Probe timeout (ms)" help="Per health check.">
            <Input
              type="number"
              min={500}
              max={60_000}
              step={500}
              value={routing.probeTimeoutMs}
              onChange={(event) => update("routing", "probeTimeoutMs", Number(event.target.value))}
            />
          </Field>
          <Field label="Request timeout (ms)" help="Per provider attempt.">
            <Input
              type="number"
              min={1_000}
              max={300_000}
              step={1_000}
              value={routing.requestTimeoutMs}
              onChange={(event) => update("routing", "requestTimeoutMs", Number(event.target.value))}
            />
          </Field>
          <Field label="Total budget (ms)" help="All attempts, including failover.">
            <Input
              type="number"
              min={1_000}
              max={600_000}
              step={1_000}
              value={routing.totalTimeoutMs}
              onChange={(event) => update("routing", "totalTimeoutMs", Number(event.target.value))}
            />
          </Field>
          <Field label="Maximum attempts" help="0 tries every eligible provider.">
            <Input
              type="number"
              min={0}
              max={50}
              value={routing.maxAttempts}
              onChange={(event) => update("routing", "maxAttempts", Number(event.target.value))}
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line pt-3">
          <span className="flex items-center gap-1.5 font-mono text-[9px] text-dim"><Timer size={11} /> attempt timeout {formatDuration(routing.requestTimeoutMs)}</span>
          <span className="flex items-center gap-1.5 font-mono text-[9px] text-dim"><Waypoints size={11} /> last resort {routing.lastResortEnabled ? "on" : "off"}</span>
          <span className="flex items-center gap-1.5 font-mono text-[9px] text-dim"><Check size={11} /> auto recovery {routing.autoRecoverEnabled ? "on" : "off"}</span>
        </div>
      </Panel>
    </div>
  );
}
