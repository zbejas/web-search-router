import { useCallback, useEffect, useState } from "react";
import {
  Database,
  KeyRound,
  LockKeyhole,
  RotateCcw,
  Save,
  ServerCog,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../hooks/useToast";
import type { Settings } from "../lib/api";
import { ApiError, api } from "../lib/api";
import { formatDuration } from "../lib/format";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  LoadError,
  Panel,
  Skeleton,
  Toggle,
} from "../components/ui";

export function SettingsPage() {
  const { push } = useToast();
  const { state: authState, refresh: refreshAuth, isAdmin } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [meta, setMeta] = useState<{ version: string; port: number; host: string; uptimeSeconds: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [authDialog, setAuthDialog] = useState(false);
  const [disableAuthDialog, setDisableAuthDialog] = useState(false);
  const [resetDialog, setResetDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState("admin");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [changePassword, setChangePassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSettings, nextMeta] = await Promise.all([api.settings(), api.meta()]);
      setSettings(nextSettings);
      setMeta(nextMeta);
      setDirty(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load settings");
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

  const update = (group: "logging" | "rateLimit", key: string, value: number | boolean) => {
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
        logging: settings.logging,
        rateLimit: settings.rateLimit,
        auth: { sessionDays: settings.auth.sessionDays },
      });
      setSettings(next);
      setDirty(false);
      push("Settings saved", "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not save settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleAuth = (enabled: boolean) => {
    if (enabled) {
      setAuthError(null);
      setNewUsername("admin");
      setNewPassword("");
      setConfirmPassword("");
      setAuthDialog(true);
      return;
    }
    setDisableAuthDialog(true);
  };

  const disableAuth = async () => {
    setBusy(true);
    try {
      await api.enableAuth(false);
      await refreshAuth();
      setDisableAuthDialog(false);
      push("Authentication disabled", "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not change authentication", "error");
    } finally {
      setBusy(false);
    }
  };

  const createAdminAndEnable = async () => {
    if (!authState?.hasUsers && newPassword !== confirmPassword) {
      setAuthError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setAuthError(null);
    try {
      await api.enableAuth(true, newUsername, newPassword);
      setAuthDialog(false);
      await refreshAuth();
      push(
        authState?.hasUsers
          ? "Authentication enabled"
          : "Admin created and authentication enabled",
        "success",
      );
      await load();
    } catch (err) {
      if (err instanceof ApiError) setAuthError(err.message);
      else setAuthError(err instanceof Error ? err.message : "Could not enable authentication");
    } finally {
      setBusy(false);
    }
  };

  const changeOwnPassword = async () => {
    setBusy(true);
    try {
      await api.changePassword(currentPassword, changePassword);
      push("Password changed", "success");
      setCurrentPassword("");
      setChangePassword("");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not change password", "error");
    } finally {
      setBusy(false);
    }
  };

  const resetSettings = async () => {
    setBusy(true);
    try {
      const next = await api.resetSettings();
      setSettings(next);
      setDirty(false);
      setResetDialog(false);
      await refreshAuth();
      push("Settings reset to defaults", "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not reset settings", "error");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !settings) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="space-y-5">
        <div>
          <p className="mono-label mb-2">Control surface</p>
          <h2 className="text-[26px] font-extrabold tracking-[-0.03em] text-ink">Settings</h2>
        </div>
        <LoadError message={error ?? "Could not load settings"} onRetry={() => load()} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mono-label mb-2">Control surface</p>
          <h2 className="text-[26px] font-extrabold tracking-[-0.03em] text-ink">Settings</h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted">
            Runtime configuration lives in SQLite. There is no .env file. Policy, auth, rate limits, and
            retention are all edited here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty ? <Badge tone="warn">Unsaved changes</Badge> : null}
          <Button variant="secondary" onClick={() => setResetDialog(true)} disabled={!isAdmin}>
            <RotateCcw size={13} /> Reset defaults
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!isAdmin || !dirty}>
            <Save size={13} /> Save settings
          </Button>
        </div>
      </div>

      {error ? <ErrorNotice message={error} /> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel eyebrow="Security" title="Authentication" action={<Badge tone={authState?.enabled ? "ok" : "warn"} dot>{authState?.enabled ? "enabled" : "disabled"}</Badge>}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-ink">Require login and router API keys</p>
              <p className="mt-1 max-w-md text-[10px] leading-relaxed text-dim">
                When on, dashboard APIs require a session and proxy traffic requires a valid router key.
                Enabling with no users creates the first admin.
              </p>
            </div>
            <Toggle
              checked={Boolean(authState?.enabled)}
              onChange={toggleAuth}
              label="Require authentication"
              disabled={!isAdmin || busy}
            />
          </div>
          {authState?.enabled && authState.user ? (
            <div className="mt-4 border-t border-line pt-4">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck size={14} className="status-ok" />
                <span className="text-[11px] text-muted">Signed in as</span>
                <span className="text-[11px] font-semibold text-ink">{authState.user.username}</span>
                <Badge tone="dim">{authState.user.role}</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Current password"><Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></Field>
                <Field label="New password"><Input type="password" value={changePassword} onChange={(event) => setChangePassword(event.target.value)} autoComplete="new-password" /></Field>
              </div>
              <Field label="Session lifetime (days)" help="Applies to new dashboard logins.">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={settings.auth.sessionDays}
                  onChange={(event) => {
                    setSettings((current) => current ? { ...current, auth: { ...current.auth, sessionDays: Number(event.target.value) } } : current);
                    setDirty(true);
                  }}
                />
              </Field>
              <Button size="sm" variant="secondary" className="mt-3" onClick={changeOwnPassword} disabled={!currentPassword || changePassword.length < 8} loading={busy}>
                <KeyRound size={12} /> Change password
              </Button>
            </div>
          ) : !authState?.enabled ? (
            <div className="mt-4 flex items-start gap-2 border-t border-line pt-4 text-[10px] leading-relaxed text-warn">
              <ShieldOff size={14} className="mt-0.5 shrink-0" />
              The control plane is open to the network. Enable authentication before exposing this host.
            </div>
          ) : null}
        </Panel>

        <Panel eyebrow="Traffic" title="Rate limiting" action={<Badge tone={settings.rateLimit.enabled ? "info" : "dim"} dot>{settings.rateLimit.enabled ? "on" : "off"}</Badge>}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-ink">Per-key sliding window</p>
              <p className="mt-1 text-[10px] leading-relaxed text-dim">
                Applies before routing. Anonymous traffic is limited by client address.
              </p>
            </div>
            <Toggle checked={settings.rateLimit.enabled} onChange={(value) => update("rateLimit", "enabled", value)} label="Enable rate limiting" disabled={!isAdmin} />
          </div>
          <div className="mt-4">
            <Field label="Requests per minute" help="Maximum proxied requests per API key per minute.">
              <Input type="number" min={1} max={100_000} value={settings.rateLimit.rpm} onChange={(event) => update("rateLimit", "rpm", Number(event.target.value))} />
            </Field>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel eyebrow="Storage" title="Request logging">
          <div className="space-y-4">
            <Field label="Retention (days)" help="Older request logs are deleted by the hourly cleanup.">
              <Input type="number" min={1} max={3_650} value={settings.logging.retentionDays} onChange={(event) => update("logging", "retentionDays", Number(event.target.value))} />
            </Field>
            <div className="flex items-center justify-between gap-4 border-t border-line pt-3">
              <div>
                <p className="text-xs font-semibold text-ink">Store request and response bodies</p>
                <p className="mt-0.5 text-[10px] text-dim">Bodies are truncated and redacted before storage.</p>
              </div>
              <Toggle checked={settings.logging.logBodies} onChange={(value) => update("logging", "logBodies", value)} label="Log bodies" />
            </div>
            <Field label="Maximum body length (characters)" help="Per request or response body.">
              <Input type="number" min={1_000} max={1_000_000} step={1_000} value={settings.logging.maxBodyChars} onChange={(event) => update("logging", "maxBodyChars", Number(event.target.value))} />
            </Field>
          </div>
        </Panel>

        <Panel eyebrow="Runtime" title="Deployment">
          <div className="space-y-3">
            {[
              ["Version", meta?.version ?? "—"],
              ["Listening", `${meta?.host ?? "—"}:${meta?.port ?? "—"}`],
              ["Uptime", meta ? formatDuration(meta.uptimeSeconds * 1_000) : "—"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between border-b border-line pb-2.5 last:border-0 last:pb-0">
                <span className="text-[11px] text-muted">{label}</span>
                <span className="font-mono text-[10px] text-ink">{value}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-sm border border-line bg-bg px-3 py-2.5 text-[10px] leading-relaxed text-dim">
            <ServerCog size={14} className="mt-0.5 shrink-0" />
            <p>
              Host and port are CLI flags (<code className="font-mono text-muted">--host</code>,
              <code className="ml-1 font-mono text-muted">--port</code>). All other configuration is stored
              in the data directory and editable here.
            </p>
          </div>
          <div className="mt-3 flex items-start gap-2 text-[10px] leading-relaxed text-dim">
            <Database size={13} className="mt-0.5 shrink-0" />
            SQLite with WAL, encrypted provider secrets, and a single migration path from the old
            Firecrawl Router database.
          </div>
        </Panel>
      </div>

      <Dialog
        open={authDialog}
        onClose={() => setAuthDialog(false)}
        title={authState?.hasUsers ? "Enable authentication" : "Create the first admin"}
        description={
          authState?.hasUsers
            ? "Confirm an existing admin account. Authentication will not be enabled if the credentials are invalid."
            : "Authentication is about to be enabled. No users exist, so this account becomes the owner of the control plane."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setAuthDialog(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={createAdminAndEnable}>
              {authState?.hasUsers ? "Enable authentication" : "Create admin and enable"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {authError ? <ErrorNotice message={authError} /> : null}
          <Field label="Admin username"><Input value={newUsername} onChange={(event) => setNewUsername(event.target.value)} autoComplete="username" /></Field>
          <Field label="Password" help={authState?.hasUsers ? "Password for the existing admin account." : "At least 8 characters."}>
            <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete={authState?.hasUsers ? "current-password" : "new-password"} />
          </Field>
          {!authState?.hasUsers ? (
            <Field label="Confirm password"><Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></Field>
          ) : null}
          <div className="flex items-start gap-2 rounded-sm border border-line bg-bg px-3 py-2 text-[10px] leading-relaxed text-dim">
            <LockKeyhole size={13} className="mt-0.5 shrink-0" />
            Once enabled, this browser receives a session cookie. Keep these credentials safe; there is no
            recovery email in a self-hosted deployment.
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={disableAuthDialog}
        onClose={() => setDisableAuthDialog(false)}
        onConfirm={disableAuth}
        loading={busy}
        danger
        title="Disable authentication?"
        description="The dashboard and proxy stop requiring login/API keys immediately. Anyone who can reach this host can change providers and policy."
        confirmLabel="Disable authentication"
      />

      <Dialog
        open={resetDialog}
        onClose={() => setResetDialog(false)}
        title="Reset all settings?"
        description="Routing, logging, auth, and rate-limit policy return to defaults. Providers, keys, users, and logs are untouched."
        footer={<><Button variant="ghost" onClick={() => setResetDialog(false)}>Cancel</Button><Button variant="danger" loading={busy} onClick={resetSettings}>Reset settings</Button></>}
      >
        <p className="text-xs leading-relaxed text-muted">
          Authentication will be disabled by this reset. If you are relying on it, re-enable it before
          leaving the dashboard.
        </p>
      </Dialog>
    </div>
  );
}
