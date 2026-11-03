import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  CircleAlert,
  Gauge,
  ListChecks,
  RefreshCw,
  Timer,
  TrendingDown,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../hooks/useToast";
import type { LogStats, Overview, ProviderEvent } from "../lib/api";
import { api } from "../lib/api";
import { formatDuration, formatInterval, formatNumber, formatPercent, formatRelative, truncate } from "../lib/format";
import { RouteBoard } from "../components/RouteBoard";
import { Badge, Button, EmptyState, ErrorNotice, LoadError, Panel, Skeleton } from "../components/ui";
import { ProviderTypeMark } from "../components/status";

type Range = "1h" | "24h" | "7d";

function eventTone(event: string): "ok" | "warn" | "bad" | "dim" {
  if (event.includes("enabled") || event === "test_ok" || event === "created") return "ok";
  if (event.includes("disabled") || event === "test_failed") return "bad";
  if (event === "migrated" || event === "updated") return "warn";
  return "dim";
}

function EventRow({ event }: { event: ProviderEvent }) {
  return (
    <div className="flex items-start gap-3 border-b border-line py-2.5 last:border-0">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[11px] font-semibold text-ink">
            {event.providerName ?? event.providerId}
          </span>
          <Badge tone={eventTone(event.event)}>{event.event.replaceAll("_", " ")}</Badge>
        </div>
        {event.message ? (
          <p className="mt-1 text-[10px] leading-relaxed text-muted">{truncate(event.message, 120)}</p>
        ) : null}
      </div>
      <span className="shrink-0 font-mono text-[9px] text-dim">{formatRelative(event.timestamp)}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  icon: Icon,
  tone = "dim",
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone?: "ok" | "warn" | "bad" | "dim";
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between">
        <span className="mono-label">{label}</span>
        <Icon size={14} className={tone === "ok" ? "status-ok" : tone === "warn" ? "status-warn" : tone === "bad" ? "status-bad" : "text-dim"} />
      </div>
      <p className="metric mt-3 text-[26px] font-bold leading-none text-ink">{value}</p>
      <p className="mt-2 text-[10px] text-dim">{detail}</p>
    </div>
  );
}

export function OverviewPage({
  onNavigate,
  onAddProvider,
}: {
  onNavigate: (tab: "providers" | "routing" | "logs") => void;
  onAddProvider: () => void;
}) {
  const { push } = useToast();
  const { isAdmin } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [chart, setChart] = useState<{ label: string; requests: number; errors: number }[]>([]);
  const [range, setRange] = useState<Range>("1h");
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const next = await api.overview();
      setOverview(next);
      setStats(next.stats);
      setUpdated(new Date());
      setError(null);

      const series =
        range === "1h"
          ? await api.logTimeseries(60, 5)
          : range === "24h"
            ? await api.logTimeseries(1_440, 60)
            : await api.logDaily(7);
      const buckets = series.buckets as { time?: string; date?: string; requests: number; errors: number }[];
      setChart(
        buckets.map((bucket) => ({
          label: bucket.time
            ? new Date(bucket.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : new Date(`${bucket.date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          requests: bucket.requests,
          errors: bucket.errors,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the routing board");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load(true);
    }, 8_000);
    return () => clearInterval(timer);
  }, [load]);

  const probeNow = async () => {
    setProbing(true);
    try {
      const result = await api.healthCheck();
      await load(true);
      push(
        result.checked === 0 ? "No providers were due for a check." : `Checked ${result.checked} provider${result.checked === 1 ? "" : "s"}.`,
        "success",
      );
    } catch (err) {
      push(err instanceof Error ? err.message : "Probe failed", "error");
    } finally {
      setProbing(false);
    }
  };

  const providers = overview?.providers ?? [];
  const enabled = providers.filter((provider) => provider.enabled);
  const healthy = enabled.filter((provider) => provider.health === "healthy");
  const unverified = enabled.filter((provider) => provider.health === "unknown");
  const unhealthy = enabled.filter((provider) => provider.health === "unhealthy");
  const errorRate = stats && stats.total > 0 ? stats.errorCount / stats.total : 0;
  const chartEmpty = useMemo(() => chart.every((bucket) => bucket.requests === 0), [chart]);

  const reorder = async (provider: (typeof providers)[number], direction: -1 | 1) => {
    const ordered = [...providers].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
    const index = ordered.findIndex((item) => item.id === provider.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await api.reorderProviders(next.map((item) => item.id));
      await load(true);
      push("Route order updated", "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not reorder providers", "error");
    }
  };

  const testProvider = async (provider: (typeof providers)[number]) => {
    setTestingProvider(provider.id);
    try {
      const result = await api.testProvider(provider.id);
      await load(true);
      push(
        result.ok ? `${provider.name} passed its probe.` : `${provider.name} failed: ${result.error ?? "unknown error"}`,
        result.ok ? "success" : "error",
      );
    } catch (err) {
      push(err instanceof Error ? err.message : "Probe failed", "error");
    } finally {
      setTestingProvider(null);
    }
  };

  if (loading && !overview) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 w-full" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  if (!overview && error) {
    return (
      <div className="space-y-5">
        <div>
          <p className="mono-label mb-2">Live routing board</p>
          <h2 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em] text-ink">
            The next request has a path.
          </h2>
        </div>
        <LoadError message={error} onRetry={() => load()} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mono-label mb-2">Live routing board</p>
          <h2 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em] text-ink">
            The next request has a path.
          </h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted">
            Priority order, current health, and the provider that will take the next search. The
            board refreshes every eight seconds; updates are shown in place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {updated ? (
            <span className="hidden font-mono text-[9px] text-dim sm:inline">
              UPDATED {formatRelative(updated.toISOString())}
            </span>
          ) : null}
          <Button variant="secondary" onClick={probeNow} loading={probing} disabled={!isAdmin}>
            <RefreshCw size={13} className={probing ? "animate-spin" : ""} />
            Probe now
          </Button>
          <Button variant="primary" onClick={onAddProvider} disabled={!isAdmin}>
            Add provider
            <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      {error ? <ErrorNotice message={error} /> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Healthy providers"
          value={`${healthy.length}/${enabled.length || 0}`}
          detail={
            providers.length === 0
              ? "No providers configured"
              : enabled.length === 0
                ? "All providers are manually disabled"
                : `${unverified.length} unverified · ${unhealthy.length} auto-disabled`
          }
          icon={Activity}
          tone={healthy.length > 0 ? "ok" : "bad"}
        />
        <Stat
          label="Requests"
          value={stats?.total ? formatNumber(stats.total) : "—"}
          detail={stats?.total ? "Retention window" : "No traffic yet"}
          icon={ListChecks}
        />
        <Stat
          label="Error rate"
          value={stats?.total ? formatPercent(errorRate) : "—"}
          detail={stats?.total ? `${formatNumber(stats.errorCount)} errors` : "No requests yet"}
          icon={TrendingDown}
          tone={errorRate > 0.1 ? "bad" : errorRate > 0 ? "warn" : "ok"}
        />
        <Stat
          label="P50 latency"
          value={stats?.total ? formatDuration(stats.p50) : "—"}
          detail={stats?.total ? `P95 ${formatDuration(stats.p95)}` : "No traffic yet"}
          icon={Timer}
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Panel
          eyebrow="Route chain"
          title="Primary and standby lanes"
          action={<Badge tone={healthy.length > 0 ? "ok" : "bad"} dot>{healthy.length > 0 ? "serving" : "degraded"}</Badge>}
          bodyClassName="p-0"
        >
          <RouteBoard
            providers={providers}
            onManage={onAddProvider}
            lastResortEnabled={overview?.settings.routing.lastResortEnabled}
            onReorder={isAdmin ? reorder : undefined}
            onTest={isAdmin ? testProvider : undefined}
            testingId={testingProvider}
          />
        </Panel>

        <Panel
          eyebrow="Policy"
          title="Health envelope"
          action={
            <button className="btn btn-ghost btn-icon" onClick={() => onNavigate("routing")} aria-label="Open routing policy">
              <ArrowRight size={14} />
            </button>
          }
        >
          <div className="space-y-3">
            {[
              ["Disable after", `${overview?.settings.routing.failureThreshold ?? 3} consecutive failures`],
              ["Probe every", formatInterval(overview?.settings.routing.healthCheckIntervalSeconds ?? 300)],
              ["Request budget", formatDuration(overview?.settings.routing.totalTimeoutMs ?? 60_000)],
              ["Last resort", overview?.settings.routing.lastResortEnabled ? "Enabled" : "Disabled"],
              ["Auto recovery", overview?.settings.routing.autoRecoverEnabled ? "Enabled" : "Disabled"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between border-b border-line pb-2.5 last:border-0 last:pb-0">
                <span className="text-[11px] text-muted">{label}</span>
                <span className="font-mono text-[10px] text-ink">{value}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-sm border border-line bg-bg px-3 py-2.5">
            <Gauge size={13} className="shrink-0 text-dim" />
            <p className="text-[10px] leading-relaxed text-dim">
              Health checks never run against manually disabled providers. A successful probe re-enables
              an auto-disabled provider when recovery is on.
            </p>
          </div>
        </Panel>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Panel
          eyebrow="Traffic"
          title="Requests and errors"
          action={
            <div className="flex gap-1">
              {(["1h", "24h", "7d"] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setRange(option)}
                  aria-pressed={range === option}
                  className={`rounded-sm px-2 py-1 font-mono text-[9px] tracking-wider transition-colors ${
                    range === option ? "bg-accent text-bg" : "text-dim hover:text-ink"
                  }`}
                >
                  {option.toUpperCase()}
                </button>
              ))}
            </div>
          }
        >
          {chartEmpty ? (
            <EmptyState
              icon={<Activity size={20} />}
              title="No traffic in this window"
              description="Send a request through /v2/search or /api/search and the attempt chain will appear here."
            />
          ) : (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="requestsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.24} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "var(--dim)", fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "var(--dim)", fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--panel-raised)",
                      border: "1px solid var(--line-strong)",
                      borderRadius: 3,
                      fontSize: 11,
                      color: "var(--ink)",
                    }}
                    labelStyle={{ color: "var(--muted)" }}
                  />
                  <Area type="monotone" dataKey="requests" stroke="var(--accent)" fill="url(#requestsGradient)" strokeWidth={1.5} isAnimationActive={false} />
                  <Area type="monotone" dataKey="errors" stroke="var(--bad)" fill="transparent" strokeWidth={1.2} strokeDasharray="3 3" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-3 flex items-center gap-4 border-t border-line pt-3">
            <span className="flex items-center gap-1.5 font-mono text-[9px] text-dim">
              <span className="h-1.5 w-4 bg-accent" /> requests
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[9px] text-dim">
              <span className="h-1.5 w-4 border-t border-dashed border-bad" /> errors
            </span>
            <button className="ml-auto text-[10px] text-muted hover:text-ink" onClick={() => onNavigate("logs")}>
              Open request logs
            </button>
          </div>
        </Panel>

        <Panel
          eyebrow="Provider ledger"
          title="Recent state changes"
          action={<Badge tone="dim">{overview?.events.length ?? 0}</Badge>}
        >
          {overview?.events.length ? (
            <div className="max-h-[270px] overflow-auto pr-1">
              {overview.events.map((event) => <EventRow key={event.id} event={event} />)}
            </div>
          ) : (
            <EmptyState
              icon={<CircleAlert size={19} />}
              title="No state changes yet"
              description="Provider creation, test results, and automatic recovery events will be recorded here."
            />
          )}
          <div className="mt-3 border-t border-line pt-3">
            <div className="flex items-center justify-between">
              <span className="mono-label">Configured providers</span>
              <span className="metric text-xs text-ink">{providers.length}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {providers.map((provider) => (
                <span key={provider.id} className="flex items-center gap-1.5 rounded-sm border border-line px-1.5 py-1">
                  <ProviderTypeMark type={provider.type} size={16} />
                  <span className="font-mono text-[9px] text-muted">{provider.id}</span>
                </span>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
