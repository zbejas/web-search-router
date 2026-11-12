import { useState } from "react";
import { Activity, ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { APP_VERSION } from "../lib/version";
import { useAuth } from "../hooks/useAuth";
import { Button, ErrorNotice, Field, Input } from "../components/ui";

export function LoginPage({ needsSetup = false }: { needsSetup?: boolean }) {
  const { login, refresh } = useAuth();
  const [username, setUsername] = useState(needsSetup ? "admin" : "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (needsSetup && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      if (needsSetup) {
        await api.setup(username, password, true);
        await refresh();
      } else {
        await login(username, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.15fr_0.85fr]">
      <section className="relative hidden overflow-hidden border-r border-line bg-rail p-10 lg:flex lg:flex-col lg:justify-between">
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-sm border border-accent/40 bg-accent-soft">
              <Activity size={19} className="text-accent" />
            </span>
            <div>
              <p className="text-[12px] font-extrabold tracking-[0.18em] text-ink">WEB SEARCH ROUTER</p>
              <p className="font-mono text-[9px] tracking-[0.28em] text-muted">CONTROL PLANE / V{APP_VERSION}</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 max-w-xl">
          <p className="mono-label mb-5">Routing discipline</p>
          <h1 className="text-[clamp(2.6rem,5vw,4.8rem)] font-extrabold leading-[0.93] tracking-[-0.055em] text-ink">
            Route.
            <br />
            Fail.
            <br />
            <span className="text-accent">Recover.</span>
          </h1>
          <p className="mt-7 max-w-md text-sm leading-relaxed text-muted">
            One gateway for Firecrawl, DeepSeek, OpenCode, and any JSON search API. Priority first,
            automatic health recovery always, credentials encrypted at rest.
          </p>
        </div>

        <div className="relative z-10 grid grid-cols-3 gap-px border border-line bg-line">
          {[
            ["01", "Priority", "Highest healthy provider wins"],
            ["02", "Failover", "Next provider takes the request"],
            ["03", "Probe", "Disabled providers return on success"],
          ].map(([number, title, detail]) => (
            <div key={number} className="bg-panel p-4">
              <p className="font-mono text-[9px] tracking-[0.2em] text-accent">{number}</p>
              <p className="mt-2 text-xs font-bold text-ink">{title}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-dim">{detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center bg-bg p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-sm border border-accent/40 bg-accent-soft">
              <Activity size={17} className="text-accent" />
            </span>
            <p className="text-[12px] font-extrabold tracking-[0.16em] text-ink">WEB SEARCH ROUTER</p>
          </div>

          <div className="mb-6">
            <p className="mono-label mb-2">{needsSetup ? "First-run setup" : "Restricted surface"}</p>
            <h2 className="text-2xl font-extrabold tracking-tight text-ink">
              {needsSetup ? "Create the admin account" : "Sign in"}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {needsSetup
                ? "Authentication is enabled, but no admin exists yet. This account will own the control plane."
                : "Use your operator account to manage providers, policy, and access."}
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <Field label="Username">
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </Field>
            <Field label="Password" help={needsSetup ? "At least 8 characters." : undefined}>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={needsSetup ? "new-password" : "current-password"}
                required
              />
            </Field>
            {needsSetup ? (
              <Field label="Confirm password">
                <Input
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </Field>
            ) : null}

            {error ? <ErrorNotice message={error} /> : null}

            <Button type="submit" variant="primary" loading={loading} className="w-full">
              {needsSetup ? "Create account and continue" : "Enter control plane"}
              <ArrowRight size={14} />
            </Button>
          </form>

          <div className="mt-6 flex items-start gap-2 border-t border-line pt-5 text-[10px] leading-relaxed text-dim">
            {needsSetup ? <ShieldCheck size={14} className="mt-0.5 shrink-0" /> : <LockKeyhole size={14} className="mt-0.5 shrink-0" />}
            <p>
              {needsSetup
                ? "Auth is enabled as part of setup. You can turn it off later in Settings, but only while signed in."
                : "Sessions are HttpOnly and SameSite. API keys are separate from your login session."}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
