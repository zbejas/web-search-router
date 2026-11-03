import { ArrowDown, ArrowRight, ArrowUp, Ban, Clock3, FlaskConical } from "lucide-react";
import type { Provider } from "../lib/api";
import { formatDuration, formatPercent, formatRelative, truncate } from "../lib/format";
import { CreditBadge, HealthBadge, ProviderTypeMark } from "./status";
import { Badge, Button, EmptyState } from "./ui";

export function RouteBoard({
  providers,
  onManage,
  lastResortEnabled = true,
  onReorder,
  onTest,
  testingId = null,
}: {
  providers: Provider[];
  onManage: () => void;
  lastResortEnabled?: boolean;
  onReorder?: (provider: Provider, direction: -1 | 1) => void;
  onTest?: (provider: Provider) => void;
  testingId?: string | null;
}) {
  const ordered = [...providers].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  const primary = ordered.filter((provider) => provider.enabled && provider.health !== "unhealthy");
  const standby = ordered.filter((provider) => provider.enabled && provider.health === "unhealthy");
  const disabled = ordered.filter((provider) => !provider.enabled);

  if (ordered.length === 0) {
    return (
      <EmptyState
        title="No route exists yet"
        description="Add a provider, give it a priority, and the router will send the next search request there."
        action={
          <button className="btn btn-primary" onClick={onManage}>
            Add the first provider
            <ArrowRight size={14} />
          </button>
        }
      />
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="mono-label">Primary lane</span>
          <Badge tone={primary.length > 0 ? "ok" : "bad"} dot>
            {primary.length > 0 ? `${primary.length} eligible` : "empty"}
          </Badge>
        </div>
        <span className="mono-label">Priority desc</span>
      </div>

      {primary.length === 0 ? (
        <div className="rounded-sm border border-dashed border-bad/30 bg-bad/5 px-4 py-5 text-xs leading-relaxed text-bad">
          No healthy provider is eligible.{" "}
          {lastResortEnabled
            ? "Last-resort failover is on; the standby lane will be tried once before returning an error."
            : "Last-resort failover is off; requests will return 503 until a provider recovers."}
        </div>
      ) : (
        primary.map((provider, index) => (
          <div key={provider.id} className={`route-row animate-row-in ${index === 0 ? "is-live" : ""}`}>
            <div className="route-priority">{provider.priority}</div>
            <div className="flex min-w-0 items-center gap-3">
              <ProviderTypeMark type={provider.type} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13px] font-bold text-ink">{provider.name}</span>
                  {index === 0 ? <Badge tone="ok" dot>live</Badge> : null}
                  <span className="mono-label">{provider.type}</span>
                </div>
                <p className="mt-1 truncate font-mono text-[10px] text-dim">{provider.baseUrl}</p>
                {provider.lastError ? (
                  <p className="mt-1 truncate text-[10px] text-bad/80">{truncate(provider.lastError, 90)}</p>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden text-right sm:block">
                <p className="mono-label">Requests</p>
                <p className="metric mt-0.5 text-xs text-ink">
                  {provider.requestCount > 0 ? provider.requestCount.toLocaleString() : "—"}
                </p>
              </div>
              <div className="hidden text-right md:block">
                <p className="mono-label">Success</p>
                <p className="metric mt-0.5 text-xs text-ink">
                  {provider.requestCount > 0 ? formatPercent(provider.successRate) : "—"}
                </p>
              </div>
              <div className="hidden text-right lg:block">
                <p className="mono-label">Avg</p>
                <p className="metric mt-0.5 text-xs text-ink">
                  {provider.requestCount > 0 ? formatDuration(provider.avgLatencyMs) : "—"}
                </p>
              </div>
              <CreditBadge provider={provider} />
              <HealthBadge health={provider.health} enabled={provider.enabled} />
              {onReorder ? (
                <div className="flex flex-col">
                  <button
                    className="grid h-6 w-6 place-items-center text-dim transition-colors hover:text-ink disabled:opacity-20"
                    onClick={() => onReorder(provider, -1)}
                    disabled={ordered[0]?.id === provider.id}
                    aria-label={`Raise ${provider.name}`}
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    className="grid h-6 w-6 place-items-center text-dim transition-colors hover:text-ink disabled:opacity-20"
                    onClick={() => onReorder(provider, 1)}
                    disabled={ordered.at(-1)?.id === provider.id}
                    aria-label={`Lower ${provider.name}`}
                  >
                    <ArrowDown size={12} />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))
      )}

      {standby.length > 0 ? (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 px-1">
            <ArrowDown size={12} className="text-bad" />
            <span className="mono-label">Auto-disabled / standby</span>
            <Badge tone="bad" dot>{standby.length}</Badge>
          </div>
          {standby.map((provider) => (
            <div key={provider.id} className="route-row is-down">
              <div className="route-priority">{provider.priority}</div>
              <div className="flex min-w-0 items-center gap-3">
                <ProviderTypeMark type={provider.type} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13px] font-bold text-ink">{provider.name}</span>
                    <span className="mono-label">{provider.type}</span>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-[10px] text-dim">
                    <Clock3 size={10} />
                    Last checked {formatRelative(provider.lastCheckedAt)}
                    <span className="hidden sm:inline">· fails {provider.consecutiveFailures}</span>
                  </p>
                  {provider.lastError ? (
                    <p className="mt-0.5 max-w-[420px] text-[10px] leading-relaxed text-bad/90">
                      {truncate(provider.lastError, 120)}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {onTest ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onTest(provider)}
                    loading={testingId === provider.id}
                    aria-label={`Test ${provider.name}`}
                    title="Run a health probe"
                  >
                    <FlaskConical size={12} />
                  </Button>
                ) : null}
                <CreditBadge provider={provider} />
                <HealthBadge health={provider.health} enabled={provider.enabled} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {disabled.length > 0 ? (
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-3 text-[10px] text-dim">
          <Ban size={12} />
          <span>
            {disabled.length} manually disabled provider{disabled.length === 1 ? "" : "s"} excluded from routing.
          </span>
        </div>
      ) : null}
    </div>
  );
}
