import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Code2, ExternalLink, Info } from "lucide-react";
import type { AdapterPreset, Provider, ProviderType, ProviderTypeMeta } from "../lib/api";
import { ApiError, api } from "../lib/api";
import { useToast } from "../hooks/useToast";
import { Button, Dialog, ErrorNotice, Field, Input, Select, Textarea, Toggle } from "./ui";
import { ProviderTypeMark } from "./status";

const DEFAULT_CONFIG: Record<ProviderType, Record<string, unknown>> = {
  firecrawl: { probeMode: "auto" },
  deepseek: {
    searchPath: "/v1/tools/search",
    needContent: true,
    probeMode: "search",
  },
  opencode: {
    searchPath: "/console/api/websearch",
    providerID: "opencode",
    probeMode: "usage",
    usageRange: "30d",
  },
  generic: {},
};

function prettyConfig(config: unknown): string {
  return JSON.stringify(config ?? {}, null, 2);
}

function presetFor(meta: ProviderTypeMeta | undefined, presetId: string): AdapterPreset | undefined {
  return meta?.presets?.find((preset) => preset.id === presetId);
}

export function ProviderForm({
  open,
  onClose,
  provider,
  types,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  provider: Provider | null;
  types: ProviderTypeMeta[];
  onSaved: () => void;
}) {
  const { push } = useToast();
  const [type, setType] = useState<ProviderType>(provider?.type ?? "firecrawl");
  const [id, setId] = useState(provider?.id ?? "");
  const [name, setName] = useState(provider?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [priority, setPriority] = useState(String(provider?.priority ?? 10));
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [probeInterval, setProbeInterval] = useState(
    provider?.probeIntervalSeconds == null ? "" : String(provider.probeIntervalSeconds),
  );
  const [presetId, setPresetId] = useState("custom");
  const [configText, setConfigText] = useState(prettyConfig(provider?.config ?? DEFAULT_CONFIG[provider?.type ?? "firecrawl"]));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const meta = useMemo(() => types.find((item) => item.type === type), [types, type]);
  const editing = Boolean(provider);

  useEffect(() => {
    if (!open) return;
    setType(provider?.type ?? "firecrawl");
    setId(provider?.id ?? "");
    setName(provider?.name ?? "");
    setBaseUrl(provider?.baseUrl ?? "");
    setApiKey("");
    setClearKey(false);
    setPriority(String(provider?.priority ?? 10));
    setEnabled(provider?.enabled ?? true);
    setProbeInterval(provider?.probeIntervalSeconds == null ? "" : String(provider.probeIntervalSeconds));
    setPresetId("custom");
    setConfigText(prettyConfig(provider?.config ?? DEFAULT_CONFIG[provider?.type ?? "firecrawl"]));
    setShowAdvanced(false);
    setError(null);
    setIssues([]);
  }, [open, provider]);

  const chooseType = (nextType: ProviderType) => {
    if (nextType === type) return;
    setType(nextType);
    const nextMeta = types.find((item) => item.type === nextType);
    setBaseUrl(nextMeta?.defaultBaseUrl ?? "");
    setId((current) => current || "");
    if (nextType === "generic") {
      const custom = presetFor(nextMeta, "custom");
      setPresetId("custom");
      setConfigText(prettyConfig(custom?.config ?? {}));
    } else {
      setConfigText(prettyConfig(DEFAULT_CONFIG[nextType]));
    }
  };

  const choosePreset = (nextPresetId: string) => {
    setPresetId(nextPresetId);
    const preset = presetFor(meta, nextPresetId);
    if (!preset) return;
    setConfigText(prettyConfig(preset.config));
    if (preset.baseUrl) setBaseUrl(preset.baseUrl);
    if (!name && preset.label) setName(preset.label);
    if (!id && preset.label) setId(preset.label.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIssues([]);
    let config: Record<string, unknown>;
    try {
      const parsed = JSON.parse(configText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Configuration must be a JSON object.");
      }
      config = parsed;
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Invalid JSON configuration");
      setShowAdvanced(true);
      return;
    }

    const payload: Record<string, unknown> = {
      name: name.trim() || id.trim() || type,
      type,
      baseUrl: baseUrl.trim(),
      priority: Number.parseInt(priority, 10) || 0,
      enabled,
      config,
      probeIntervalSeconds: probeInterval.trim() ? Number.parseInt(probeInterval, 10) : null,
    };
    if (!editing) payload.id = id.trim() || undefined;
    if (clearKey) payload.apiKey = "";
    else if (apiKey.trim()) payload.apiKey = apiKey.trim();

    setSaving(true);
    try {
      if (provider) await api.updateProvider(provider.id, payload);
      else await api.createProvider(payload);
      push(provider ? "Provider updated" : "Provider added", "success");
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setIssues(err.issues);
      } else {
        setError(err instanceof Error ? err.message : "Could not save provider");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={provider ? `Edit ${provider.name}` : "Add a provider"}
      description="Providers are ordered by priority and filtered by capability. Secrets are encrypted before they reach SQLite."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={submit}>
            <Check size={14} />
            {provider ? "Save changes" : "Add provider"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        {error ? <ErrorNotice message={error} issues={issues} /> : null}

        <div>
          <p className="field-label mb-2">Provider type</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {types.map((item) => (
              <button
                key={item.type}
                type="button"
                onClick={() => chooseType(item.type)}
                aria-pressed={type === item.type}
                className={`flex items-start gap-3 rounded-sm border p-3 text-left transition-colors ${
                  type === item.type
                    ? "border-accent bg-accent-soft"
                    : "border-line hover:border-line-strong hover:bg-bg"
                }`}
              >
                <ProviderTypeMark type={item.type} />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-bold text-ink">{item.label}</span>
                    {type === item.type ? <Check size={12} className="text-accent" /> : null}
                  </span>
                  <span className="mt-1 block text-[10px] leading-relaxed text-muted">{item.description}</span>
                </span>
              </button>
            ))}
          </div>
          {meta?.notes?.length ? (
            <div className="mt-2 flex items-start gap-2 rounded-sm border border-line bg-bg px-3 py-2 text-[10px] leading-relaxed text-dim">
              <Info size={13} className="mt-0.5 shrink-0" />
              <div className="space-y-1">
                {meta.notes.map((note) => <p key={note}>{note}</p>)}
                {meta.docsUrl ? (
                  <a href={meta.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    Provider docs <ExternalLink size={10} />
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider ID" help={editing ? "IDs are fixed after creation." : "Lowercase slug. Generated from the name if blank."}>
            <Input
              value={id}
              onChange={(event) => setId(event.target.value)}
              placeholder="firecrawl-cloud"
              disabled={editing}
            />
          </Field>
          <Field label="Display name">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Firecrawl Cloud" required />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <Field label="Base URL" help="Scheme and host only, no /v1 or /v2 suffix.">
            <Input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={meta?.defaultBaseUrl || "https://api.example.com"}
              required
            />
          </Field>
          <Field label="Priority" help="Higher wins.">
            <Input
              type="number"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              min={0}
              step={1}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field
            label={meta?.auth.label ?? "API key"}
            help={
              provider?.apiKeySet
                ? `A key is saved (${provider.apiKeyHint}). Leave blank to keep it.`
                : meta?.auth.hint
            }
          >
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                if (event.target.value) setClearKey(false);
              }}
              placeholder={provider?.apiKeySet ? "Leave blank to keep the saved key" : meta?.auth.placeholder}
              autoComplete="new-password"
            />
          </Field>
          {provider?.apiKeySet ? (
            <label className="flex h-9 items-center gap-2 text-[10px] text-muted">
              <input
                type="checkbox"
                checked={clearKey}
                onChange={(event) => {
                  setClearKey(event.target.checked);
                  if (event.target.checked) setApiKey("");
                }}
              />
              Clear saved key
            </label>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Probe interval (seconds)"
            help="Optional per-provider override. Leave blank to use the global health interval."
          >
            <Input
              type="number"
              min={10}
              max={86_400}
              value={probeInterval}
              onChange={(event) => setProbeInterval(event.target.value)}
              placeholder="Use global setting"
            />
          </Field>
          <div className="flex items-center justify-between gap-4 rounded-sm border border-line bg-bg px-3 py-2.5">
            <div>
              <p className="text-xs font-semibold text-ink">Enabled in routing</p>
              <p className="mt-0.5 text-[10px] text-dim">
                Manual disable is respected permanently. Auto-disabled providers are managed by health probes.
              </p>
            </div>
            <Toggle checked={enabled} onChange={setEnabled} label="Enabled in routing" />
          </div>
        </div>

        {meta?.presets?.length ? (
          <Field label="Preset" help="Presets only fill the configuration. Everything remains editable.">
            <Select value={presetId} onChange={(event) => choosePreset(event.target.value)}>
              {meta.presets.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.label}</option>
              ))}
            </Select>
          </Field>
        ) : null}

        <div className="rounded-sm border border-line">
          <button
            type="button"
            onClick={() => setShowAdvanced((value) => !value)}
            className="flex w-full items-center justify-between px-3 py-2.5 text-left"
          >
            <span className="flex items-center gap-2">
              <Code2 size={14} className="text-dim" />
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Adapter configuration</span>
            </span>
            <ChevronDown size={14} className={`text-dim transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
          </button>
          {showAdvanced ? (
            <div className="border-t border-line p-3">
              <p className="mb-2 text-[10px] leading-relaxed text-dim">
                JSON passed to the {meta?.label ?? type} adapter. Search paths, auth style, result mapping,
                and probe behavior live here. Invalid JSON is rejected before saving.
              </p>
              <Textarea
                value={configText}
                onChange={(event) => setConfigText(event.target.value)}
                spellCheck={false}
                className="min-h-[220px]"
              />
            </div>
          ) : (
            <div className="border-t border-line px-3 py-2">
              <p className="truncate font-mono text-[10px] text-dim">
                {configText.replace(/\s+/g, " ").slice(0, 140)}
              </p>
            </div>
          )}
        </div>
      </form>
    </Dialog>
  );
}
