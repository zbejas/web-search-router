import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  CheckCircle2,
  FlaskConical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../hooks/useToast";
import type { Provider, ProviderTestResult, ProviderType, ProviderTypeMeta } from "../lib/api";
import { api } from "../lib/api";
import { formatDate, formatDuration, formatMoney, formatNumber, formatPercent, formatRelative, truncate } from "../lib/format";
import { ProviderForm } from "../components/ProviderForm";
import { CreditBadge, HealthBadge, ProviderTypeMark } from "../components/status";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorNotice,
  Input,
  LoadError,
  Panel,
  Select,
  Skeleton,
} from "../components/ui";

type Filter = "all" | "healthy" | "unhealthy" | "disabled";

function matchesFilter(provider: Provider, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "disabled") return !provider.enabled;
  if (filter === "healthy") return provider.enabled && provider.health !== "unhealthy";
  return provider.enabled && provider.health === "unhealthy";
}

export function ProvidersPage({
  autoOpen = false,
  onAutoOpen,
}: {
  autoOpen?: boolean;
  onAutoOpen?: () => void;
} = {}) {
  const { push } = useToast();
  const { isAdmin } = useAuth();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [types, setTypes] = useState<ProviderTypeMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [typeFilter, setTypeFilter] = useState<ProviderType | "all">("all");
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [deleting, setDeleting] = useState<Provider | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [providerList, typeList] = await Promise.all([api.providers(), api.providerTypes()]);
      setProviders(providerList);
      setTypes(typeList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load(true);
    }, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (autoOpen && !loading && types.length > 0) {
      setEditing(null);
      setFormOpen(true);
      onAutoOpen?.();
    }
  }, [autoOpen, loading, types.length, onAutoOpen]);

  const sorted = useMemo(() => {
    const term = query.toLowerCase().trim();
    return [...providers]
      .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))
      .filter((provider) => matchesFilter(provider, filter))
      .filter((provider) => typeFilter === "all" || provider.type === typeFilter)
      .filter(
        (provider) =>
          !term ||
          provider.name.toLowerCase().includes(term) ||
          provider.id.toLowerCase().includes(term) ||
          provider.baseUrl.toLowerCase().includes(term),
      );
  }, [providers, filter, typeFilter, query]);

  const fatalError = !loading && providers.length === 0 && Boolean(error);

  const counts = useMemo(
    () => ({
      total: providers.length,
      healthy: providers.filter((provider) => provider.enabled && provider.health !== "unhealthy").length,
      unhealthy: providers.filter((provider) => provider.enabled && provider.health === "unhealthy").length,
      disabled: providers.filter((provider) => !provider.enabled).length,
    }),
    [providers],
  );

  const move = async (provider: Provider, direction: -1 | 1) => {
    const ordered = [...providers].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
    const index = ordered.findIndex((item) => item.id === provider.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    try {
      const updated = await api.reorderProviders(next.map((item) => item.id));
      setProviders(updated);
      push("Route order updated", "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not reorder providers", "error");
    }
  };

  const toggle = async (provider: Provider) => {
    try {
      const updated = provider.enabled
        ? await api.disableProvider(provider.id)
        : await api.enableProvider(provider.id);
      setProviders((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      push(provider.enabled ? "Provider disabled" : "Provider enabled", "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not update provider", "error");
    }
  };

  const test = async (provider: Provider) => {
    setTesting(provider.id);
    try {
      const result = await api.testProvider(provider.id);
      setTestResult(result);
      await load(true);
    } catch (err) {
      push(err instanceof Error ? err.message : "Test failed", "error");
    } finally {
      setTesting(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await api.deleteProvider(deleting.id);
      push("Provider deleted", "success");
      setDeleting(null);
      await load(true);
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not delete provider", "error");
    } finally {
      setDeletingBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mono-label mb-2">Upstream registry</p>
          <h2 className="text-[26px] font-extrabold tracking-[-0.03em] text-ink">Providers</h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted">
            Priority decides order. Capability decides eligibility. Health decides whether the router
            will use the provider without a last-resort fallback.
          </p>
        </div>
        <Button variant="primary" onClick={() => { setEditing(null); setFormOpen(true); }} disabled={!isAdmin}>
          <Plus size={14} />
          Add provider
        </Button>
      </div>

      {fatalError ? (
        <LoadError message={error!} onRetry={() => load()} />
      ) : error ? (
        <ErrorNotice message={error} />
      ) : null}

      <div className={`grid grid-cols-2 gap-3 lg:grid-cols-4 ${fatalError ? "hidden" : ""}`}>
        {[
          ["Total", counts.total, "dim"],
          ["Eligible", counts.healthy, "ok"],
          ["Auto-disabled", counts.unhealthy, "bad"],
          ["Manual off", counts.disabled, "warn"],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="panel flex items-center justify-between p-4">
            <span className="mono-label">{label}</span>
            <span className={`metric text-xl font-bold ${tone === "ok" ? "status-ok" : tone === "bad" ? "status-bad" : tone === "warn" ? "status-warn" : "text-ink"}`}>
              {value}
            </span>
          </div>
        ))}
      </div>

      <Panel bodyClassName="p-0" className={fatalError ? "hidden" : undefined}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="flex flex-wrap gap-1">
            {(["all", "healthy", "unhealthy", "disabled"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setFilter(option)}
                aria-pressed={filter === option}
                className={`rounded-sm px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors ${
                  filter === option ? "bg-accent text-bg" : "text-muted hover:bg-bg hover:text-ink"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-1 flex-wrap items-center justify-end gap-2">
            <div className="relative min-w-[170px] flex-1 sm:max-w-[260px]">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by name, ID, or URL"
                className="pl-8"
              />
            </div>
            <Select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as ProviderType | "all")}
              className="w-[150px]"
            >
              <option value="all">All types</option>
              {types.map((type) => <option key={type.type} value={type.type}>{type.label}</option>)}
            </Select>
          </div>
        </div>

        {loading && providers.length === 0 ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}
          </div>
        ) : providers.length === 0 ? (
          <EmptyState
            title="No providers configured"
            description="The router has nowhere to send traffic. Add Firecrawl, DeepSeek Search, OpenCode Web Search, or a generic REST provider."
            action={
              <Button variant="primary" onClick={() => { setEditing(null); setFormOpen(true); }} disabled={!isAdmin}>
                <Plus size={14} /> Add the first provider
              </Button>
            }
          />
        ) : sorted.length === 0 ? (
          <EmptyState title="No matches" description="Adjust the filters or search term to find a provider." />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Provider</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Base URL</th>
                  <th>Key</th>
                  <th className="text-right">Billing</th>
                  <th className="text-right">Requests</th>
                  <th className="text-right">Success</th>
                  <th className="text-right">Avg</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((provider, index) => (
                  <tr key={provider.id}>
                    <td>
                      <div className="flex items-center gap-1">
                        <span className="metric w-7 text-xs font-bold text-ink">{provider.priority}</span>
                        <div className="flex flex-col">
                          <button
                            className="grid h-6 w-6 place-items-center text-dim transition-colors hover:text-ink disabled:opacity-20"
                            onClick={() => move(provider, -1)}
                            disabled={!isAdmin || index === 0}
                            aria-label={`Raise ${provider.name}`}
                          >
                            <ArrowUp size={12} />
                          </button>
                          <button
                            className="grid h-6 w-6 place-items-center text-dim transition-colors hover:text-ink disabled:opacity-20"
                            onClick={() => move(provider, 1)}
                            disabled={!isAdmin || index === sorted.length - 1}
                            aria-label={`Lower ${provider.name}`}
                          >
                            <ArrowDown size={12} />
                          </button>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <ProviderTypeMark type={provider.type} size={26} />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-ink">{provider.name}</p>
                          <p className="font-mono text-[9px] text-dim">{provider.id}</p>
                        </div>
                      </div>
                    </td>
                    <td><Badge tone="dim">{provider.type}</Badge></td>
                    <td>
                      <div className="space-y-1">
                        <HealthBadge health={provider.health} enabled={provider.enabled} />
                        {provider.lastError ? (
                          <p className="max-w-[160px] truncate text-[9px] text-bad/80" title={provider.lastError}>
                            {truncate(provider.lastError, 40)}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span className="block max-w-[180px] truncate font-mono text-[10px] text-muted" title={provider.baseUrl}>
                        {provider.baseUrl}
                      </span>
                      <span className="block font-mono text-[9px] text-dim">
                        {provider.lastCheckedAt ? `checked ${formatRelative(provider.lastCheckedAt)}` : "never checked"}
                      </span>
                    </td>
                    <td>
                      <span className="font-mono text-[10px] text-muted">
                        {provider.apiKeySet ? provider.apiKeyHint ?? "saved" : "no key"}
                      </span>
                    </td>
                    <td className="text-right">
                      {provider.creditsRemaining !== null || provider.billing !== null ? (
                        <div className="flex flex-col items-end gap-1">
                          <CreditBadge provider={provider} showPlan />
                          <span className="font-mono text-[9px] text-dim">
                            {provider.billing?.checkedAt || provider.creditsCheckedAt
                              ? formatRelative(
                                  provider.billing?.checkedAt ?? provider.creditsCheckedAt,
                                )
                              : "never checked"}
                          </span>
                        </div>
                      ) : (
                        <span className="font-mono text-[10px] text-dim">—</span>
                      )}
                    </td>
                    <td className="num text-right">{formatNumber(provider.requestCount)}</td>
                    <td className="num text-right">{provider.requestCount > 0 ? formatPercent(provider.successRate) : "—"}</td>
                    <td className="num text-right">{provider.requestCount > 0 ? formatDuration(provider.avgLatencyMs) : "—"}</td>
                    <td>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => test(provider)}
                          loading={testing === provider.id}
                          disabled={!isAdmin}
                          aria-label={`Test ${provider.name}`}
                          title="Run a health probe"
                        >
                          <FlaskConical size={13} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => { setEditing(provider); setFormOpen(true); }}
                          disabled={!isAdmin}
                          aria-label={`Edit ${provider.name}`}
                          title="Edit provider"
                        >
                          <Pencil size={13} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => toggle(provider)}
                          disabled={!isAdmin}
                          aria-label={provider.enabled ? `Disable ${provider.name}` : `Enable ${provider.name}`}
                          title={provider.enabled ? "Disable in routing" : "Enable in routing"}
                        >
                          {provider.enabled ? <Ban size={13} /> : <RefreshCw size={13} />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleting(provider)}
                          disabled={!isAdmin}
                          aria-label={`Delete ${provider.name}`}
                          title="Delete provider"
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <ProviderForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        provider={editing}
        types={types}
        onSaved={() => load(true)}
      />

      <Dialog
        open={Boolean(testResult)}
        onClose={() => setTestResult(null)}
        title={testResult ? `Probe: ${testResult.providerId}` : "Probe"}
        description="A probe updates provider health exactly like the scheduler. It does not enable a manually disabled provider."
        wide
        footer={<Button variant="secondary" onClick={() => setTestResult(null)}>Close</Button>}
      >
        {testResult ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={testResult.ok ? "ok" : "bad"} dot>{testResult.ok ? "healthy" : "failed"}</Badge>
              <span className="font-mono text-[11px] text-muted">HTTP {testResult.statusCode ?? "—"}</span>
              <span className="font-mono text-[11px] text-muted">{formatDuration(testResult.latencyMs)}</span>
              {testResult.failureKind ? <Badge tone="warn">{testResult.failureKind}</Badge> : null}
            </div>
            {testResult.error ? <ErrorNotice message={testResult.error} /> : null}
            {testResult.hint ? (
              <div className="flex items-start gap-2 rounded-sm border border-warn/30 bg-warn/5 px-3 py-2 text-[11px] leading-relaxed text-warn">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                {testResult.hint}
              </div>
            ) : null}
            {testResult.credits ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-sm border border-line bg-bg px-3 py-2">
                <span className="mono-label">Credits</span>
                <span className="font-mono text-[11px] text-ink">
                  {formatNumber(testResult.credits.remainingCredits)} remaining
                </span>
                {testResult.credits.planCredits !== null ? (
                  <span className="font-mono text-[10px] text-muted">
                    of {formatNumber(testResult.credits.planCredits)}
                  </span>
                ) : null}
                {testResult.credits.periodEnd ? (
                  <span className="font-mono text-[10px] text-dim">
                    resets {formatDate(testResult.credits.periodEnd)}
                  </span>
                ) : null}
              </div>
            ) : null}
            {testResult.billing ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-sm border border-line bg-bg px-3 py-2">
                <span className="mono-label">Billing</span>
                {testResult.billing.balanceUsd !== null ? (
                  <span className="font-mono text-[11px] text-ink">
                    {formatMoney(testResult.billing.balanceUsd)} balance
                  </span>
                ) : null}
                {testResult.billing.spendUsd !== null ? (
                  <span className="font-mono text-[10px] text-muted">
                    {formatMoney(testResult.billing.spendUsd)} spend
                    {testResult.billing.range
                      ? ` (${testResult.billing.range === "all" ? "all-time" : testResult.billing.range})`
                      : ""}
                  </span>
                ) : null}
                {testResult.billing.webSearchSpendUsd !== null ? (
                  <span className="font-mono text-[10px] text-dim">
                    {formatMoney(testResult.billing.webSearchSpendUsd)} web search
                    {testResult.billing.webSearchRequests !== null
                      ? ` · ${formatNumber(testResult.billing.webSearchRequests)} requests`
                      : ""}
                  </span>
                ) : null}
                {testResult.billing.mode ? (
                  <span className="font-mono text-[10px] text-dim">
                    {testResult.billing.mode}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div>
              <p className="mono-label mb-1.5">Response body</p>
              <pre className="max-h-[260px] overflow-auto rounded-sm border border-line bg-bg p-3 font-mono text-[10px] leading-relaxed text-muted">
                {testResult.body || "(empty)"}
              </pre>
            </div>
            {!testResult.ok ? (
              <div className="flex items-center gap-2 text-[10px] text-dim">
                <XCircle size={12} />{" "}
                {testResult.failureKind === "quota"
                  ? "An exhausted balance marks the provider unhealthy right away; it recovers when credits return."
                  : "The provider remains subject to the configured failure threshold."}
              </div>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        loading={deletingBusy}
        danger
        title={deleting ? `Delete ${deleting.name}?` : "Delete provider?"}
        description="The provider and its event history are removed. Existing request logs keep their provider ID. This cannot be undone."
        confirmLabel="Delete provider"
      />
    </div>
  );
}
