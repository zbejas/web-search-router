import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Filter,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useToast } from "../hooks/useToast";
import type { LogEntry, Provider, RouteAttempt } from "../lib/api";
import { api } from "../lib/api";
import { formatDate, formatDuration, formatNumber, statusCodeTone, toSqliteDateTime } from "../lib/format";
import { Badge, Button, ErrorNotice, Input, LoadError, Panel, Select, Skeleton } from "../components/ui";

const PAGE_SIZE = 50;

interface Filters {
  status: string;
  provider_id: string;
  operation: string;
  search: string;
  from: string;
  to: string;
}

function pretty(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function AttemptChain({ attempts }: { attempts: RouteAttempt[] }) {
  if (attempts.length === 0) return <span className="text-[10px] text-dim">No attempts recorded.</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {attempts.map((attempt, index) => (
        <div key={`${attempt.providerId}-${index}`} className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-1 font-mono text-[9px] ${
              attempt.ok
                ? "border-ok/30 bg-ok/5 text-ok"
                : "border-bad/30 bg-bad/5 text-bad"
            }`}
            title={attempt.error ?? undefined}
          >
            <span className="text-dim">{attempt.phase === "last_resort" ? "LAST" : attempt.priority}</span>
            {attempt.providerId}
            <span className="text-dim">{attempt.statusCode ?? "ERR"}</span>
            <span className="text-dim">{formatDuration(attempt.latencyMs)}</span>
          </span>
          {index < attempts.length - 1 ? <span className="text-dim">→</span> : null}
        </div>
      ))}
    </div>
  );
}

export function LogsPage() {
  const { push } = useToast();
  const [rows, setRows] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<Filters>({ status: "", provider_id: "", operation: "", search: "", from: "", to: "" });
  const [draft, setDraft] = useState<Filters>(filters);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [showFilters, setShowFilters] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.providers().then(setProviders).catch(() => {});
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const response = await api.logs({
        limit: PAGE_SIZE,
        offset,
        status: filters.status || undefined,
        provider_id: filters.provider_id || undefined,
        operation: filters.operation || undefined,
        search: filters.search || undefined,
        from: filters.from ? toSqliteDateTime(filters.from) : undefined,
        to: filters.to ? toSqliteDateTime(filters.to) : undefined,
      });
      setRows(response.rows);
      setTotal(response.total);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load logs";
      setError(message);
      push(message, "error");
    } finally {
      setLoading(false);
    }
  }, [filters, offset, push]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden && expanded.size === 0) load(true);
    }, 10_000);
    return () => clearInterval(timer);
  }, [load, expanded.size]);

  const apply = () => {
    setFilters(draft);
    setOffset(0);
  };

  const clear = () => {
    const empty = { status: "", provider_id: "", operation: "", search: "", from: "", to: "" };
    setDraft(empty);
    setFilters(empty);
    setOffset(0);
  };

  const toggle = (id: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const activeFilterCount = useMemo(
    () => Object.values(filters).filter((value) => value !== "").length,
    [filters],
  );
  const fatalError = !loading && rows.length === 0 && Boolean(error);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mono-label mb-2">Attempt history</p>
          <h2 className="text-[26px] font-extrabold tracking-[-0.03em] text-ink">Request logs</h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted">
            One row per routed request, with the full attempt chain. Provider credentials and cookies
            are redacted before storage.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setShowFilters((value) => !value)}>
            <Filter size={13} />
            {showFilters ? "Hide filters" : "Filters"}
            {activeFilterCount > 0 ? <Badge tone="info">{activeFilterCount}</Badge> : null}
          </Button>
          <Button variant="secondary" onClick={() => load()} loading={loading}>
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>
      </div>

      {fatalError ? (
        <LoadError message={error!} onRetry={() => load()} />
      ) : error ? (
        <ErrorNotice message={error} />
      ) : null}

      <Panel bodyClassName="p-0" className={fatalError ? "hidden" : undefined}>
        {showFilters ? (
          <div className="border-b border-line p-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <label className="space-y-1">
                <span className="mono-label">Search</span>
                <div className="relative">
                  <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
                  <Input
                    value={draft.search}
                    onChange={(event) => setDraft({ ...draft, search: event.target.value })}
                    placeholder="Path, body, error"
                    className="pl-7"
                  />
                </div>
              </label>
              <label className="space-y-1">
                <span className="mono-label">Status</span>
                <Select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                  <option value="">All statuses</option>
                  <option value="error">Errors only</option>
                  <option value="200">200 OK</option>
                  <option value="400">400</option>
                  <option value="429">429</option>
                  <option value="500">500</option>
                </Select>
              </label>
              <label className="space-y-1">
                <span className="mono-label">Provider</span>
                <Select value={draft.provider_id} onChange={(event) => setDraft({ ...draft, provider_id: event.target.value })}>
                  <option value="">All providers</option>
                  {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                </Select>
              </label>
              <label className="space-y-1">
                <span className="mono-label">Operation</span>
                <Select value={draft.operation} onChange={(event) => setDraft({ ...draft, operation: event.target.value })}>
                  <option value="">All operations</option>
                  {["search", "scrape", "crawl", "map", "extract", "batch_scrape", "proxy"].map((operation) => (
                    <option key={operation} value={operation}>{operation}</option>
                  ))}
                </Select>
              </label>
              <label className="space-y-1">
                <span className="mono-label">From</span>
                <Input type="datetime-local" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="mono-label">To</span>
                <Input type="datetime-local" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
              </label>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={clear}>
                <X size={12} /> Clear
              </Button>
              <Button variant="primary" onClick={apply}>Apply filters</Button>
            </div>
          </div>
        ) : null}

        {loading && rows.length === 0 ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-semibold text-ink">
              {activeFilterCount === 0 ? "No requests yet" : "No requests match these filters"}
            </p>
            <p className="mt-1 text-xs text-muted">
              {activeFilterCount === 0
                ? "Send a search through /v2/search or /api/search and it will appear here."
                : "Widen the filter range or clear the filters to see all request history."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Operation</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th className="text-right">Duration</th>
                  <th className="text-right">Attempts</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="cursor-pointer" onClick={() => toggle(row.id)}>
                      <td className="whitespace-nowrap font-mono text-[10px] text-muted">{formatDate(row.timestamp)}</td>
                      <td><Badge tone="dim">{row.method}</Badge></td>
                      <td>
                        <span className="block max-w-[240px] truncate font-mono text-[10px] text-ink" title={row.path}>
                          {row.path}
                        </span>
                        {row.query ? <span className="block max-w-[240px] truncate font-mono text-[9px] text-dim">{row.query}</span> : null}
                      </td>
                      <td><Badge tone="dim">{row.operation}</Badge></td>
                      <td>
                        <span className="font-mono text-[10px] text-muted">{row.providerId ?? "—"}</span>
                        {row.providerType ? <span className="block font-mono text-[9px] text-dim">{row.providerType}</span> : null}
                      </td>
                      <td><Badge tone={statusCodeTone(row.responseStatus)}>{row.responseStatus ?? "ERR"}</Badge></td>
                      <td className="num text-right">{formatDuration(row.durationMs)}</td>
                      <td className="num text-right">{row.attempts.length}</td>
                      <td className="text-right">
                        <button
                          className="btn btn-ghost btn-icon"
                          aria-expanded={expanded.has(row.id)}
                          aria-label={expanded.has(row.id) ? "Hide request details" : "Show request details"}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggle(row.id);
                          }}
                        >
                          {expanded.has(row.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </td>
                    </tr>
                    {expanded.has(row.id) ? (
                      <tr>
                        <td colSpan={9} className="bg-bg/60 p-0">
                          <div className="space-y-4 border-y border-line px-4 py-4">
                            <div>
                              <p className="mono-label mb-2">Attempt chain</p>
                              <AttemptChain attempts={row.attempts} />
                            </div>
                            {row.error ? <ErrorNotice message={row.error} /> : null}
                            <div className="grid gap-3 lg:grid-cols-2">
                              <Detail title="Request headers" value={pretty(JSON.stringify(row.requestHeaders))} />
                              <Detail title="Response headers" value={pretty(JSON.stringify(row.responseHeaders))} />
                              <Detail title="Request body" value={pretty(row.requestBody)} />
                              <Detail title="Response body" value={pretty(row.responseBody)} />
                            </div>
                            <div className="flex flex-wrap gap-4 border-t border-line pt-3 font-mono text-[9px] text-dim">
                              <span>request {row.requestId.slice(0, 8)}</span>
                              <span>key {row.keyId ?? "anonymous"}</span>
                              <span>client {row.clientIp ?? "unknown"}</span>
                              <span>error kind {row.errorKind ?? "none"}</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <span className="font-mono text-[9px] text-dim">
            {formatNumber(total)} rows · page {pages === 0 ? 0 : currentPage} / {pages || 1}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
              Next
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Detail({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <p className="mono-label mb-1.5">{title}</p>
      <pre className="max-h-[220px] overflow-auto rounded-sm border border-line bg-panel p-2.5 font-mono text-[10px] leading-relaxed text-muted">
        {value}
      </pre>
    </div>
  );
}
