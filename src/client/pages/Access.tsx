import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ClipboardCopy,
  KeyRound,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../hooks/useToast";
import type { ApiKey, CreatedKey, User } from "../lib/api";
import { api } from "../lib/api";
import { formatDate, formatRelative } from "../lib/format";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  LoadError,
  Panel,
  Select,
  Skeleton,
} from "../components/ui";

const SCOPES = ["*", "search", "scrape", "crawl", "map", "extract", "batch_scrape"] as const;

function scopeLabel(scope: string): string {
  return scope === "*" ? "all operations" : scope;
}

export function AccessPage() {
  const { push } = useToast();
  const { state, isAdmin } = useAuth();
  const [tab, setTab] = useState<"users" | "keys">("users");
  const [users, setUsers] = useState<User[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [myKeys, setMyKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userDialog, setUserDialog] = useState(false);
  const [keyDialog, setKeyDialog] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [revokingKey, setRevokingKey] = useState<ApiKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [my, allKeys, allUsers] = await Promise.all([
        api.myKeys(),
        isAdmin ? api.keys() : Promise.resolve([]),
        isAdmin ? api.users() : Promise.resolve([]),
      ]);
      setMyKeys(my);
      setKeys(allKeys);
      setUsers(allUsers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load access data");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleKeys = useMemo(() => (isAdmin ? keys : myKeys), [isAdmin, keys, myKeys]);
  const fatalError =
    !loading && Boolean(error) && users.length === 0 && myKeys.length === 0 && keys.length === 0;

  const copy = async (key: string) => {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };

  const deleteUser = async () => {
    if (!deletingUser) return;
    setBusy(true);
    try {
      await api.deleteUser(deletingUser.id);
      push("User deleted", "success");
      setDeletingUser(null);
      await load();
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not delete user", "error");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!revokingKey) return;
    setBusy(true);
    try {
      if (isAdmin) await api.revokeKey(revokingKey.id);
      else await api.revokeMyKey(revokingKey.id);
      push("API key revoked", "success");
      setRevokingKey(null);
      await load();
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not revoke key", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mono-label mb-2">Permissions</p>
          <h2 className="text-[26px] font-extrabold tracking-[-0.03em] text-ink">Access</h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted">
            Dashboard sessions and router API keys are separate. Keys are shown once at creation and
            stored as hashes.
          </p>
        </div>
        <div className="flex gap-2">
          {tab === "users" ? (
            <Button variant="primary" onClick={() => setUserDialog(true)} disabled={!isAdmin}>
              <UserPlus size={14} /> {users.length === 0 ? "Create first admin" : "Add user"}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setKeyDialog(true)}>
              <KeyRound size={14} /> Generate key
            </Button>
          )}
        </div>
      </div>

      {!state?.enabled ? (
        <div className="flex items-start gap-2 rounded-sm border border-warn/30 bg-warn/5 px-3 py-2.5 text-[11px] leading-relaxed text-warn">
          <ShieldCheck size={15} className="mt-0.5 shrink-0" />
          Authentication is off. These controls are open to anyone who can reach the host. Enable auth in
          Settings and create an admin account before exposing the service.
        </div>
      ) : null}

      {fatalError ? (
        <LoadError message={error!} onRetry={() => load()} />
      ) : error ? (
        <ErrorNotice message={error} />
      ) : null}

      <div
        className={`flex gap-1 border-b border-line ${fatalError ? "hidden" : ""}`}
        role="tablist"
        aria-label="Access sections"
      >
        {[
          { id: "users" as const, label: "Users", icon: Users },
          { id: "keys" as const, label: "API keys", icon: KeyRound },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors ${
                tab === item.id ? "border-accent text-ink" : "border-transparent text-dim hover:text-ink"
              }`}
            >
              <Icon size={14} /> {item.label}
            </button>
          );
        })}
      </div>

      {tab === "users" ? (
        <Panel bodyClassName="p-0">
          {loading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-11 w-full" />)}</div>
          ) : !isAdmin ? (
            <EmptyState title="Admin access required" description="Only administrators can manage users." />
          ) : users.length === 0 ? (
            <EmptyState
              title="No users"
              description="Create the first admin, then enable authentication in Settings."
              action={<Button variant="primary" onClick={() => setUserDialog(true)}><UserPlus size={14} /> Create the first admin</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>User</th><th>Role</th><th>Created</th><th>Updated</th><th className="text-right">Actions</th></tr></thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="grid h-6 w-6 place-items-center rounded-sm border border-line bg-bg text-[10px] font-bold text-muted">
                            {user.username.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="text-xs font-semibold text-ink">{user.username}</span>
                          {user.id === state?.user?.id ? <Badge tone="info">you</Badge> : null}
                        </div>
                      </td>
                      <td><Badge tone={user.role === "admin" ? "ok" : "dim"}>{user.role}</Badge></td>
                      <td className="font-mono text-[10px] text-dim">{formatDate(user.created_at)}</td>
                      <td className="font-mono text-[10px] text-dim">{formatRelative(user.updated_at)}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setResetUser(user)}>Reset password</Button>
                          <Button size="icon" variant="ghost" onClick={() => setDeletingUser(user)} aria-label={`Delete ${user.username}`}>
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
      ) : (
        <Panel bodyClassName="p-0">
          {loading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-11 w-full" />)}</div>
          ) : visibleKeys.length === 0 ? (
            <EmptyState
              icon={<KeyRound size={20} />}
              title="No API keys yet"
              description="Generate a key for a client, then send it as Authorization: Bearer <key> or x-api-key."
              action={<Button variant="primary" onClick={() => setKeyDialog(true)}><KeyRound size={14} /> Generate key</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Name</th><th>Owner</th><th>Prefix</th><th>Scopes</th><th>Last used</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
                <tbody>
                  {visibleKeys.map((key) => (
                    <tr key={key.id}>
                      <td className="text-xs font-semibold text-ink">{key.name}</td>
                      <td className="font-mono text-[10px] text-muted">{key.username ?? key.userId}</td>
                      <td className="font-mono text-[10px] text-muted">{key.keyPrefix}…</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {key.scopes.map((scope) => <Badge key={scope} tone={scope === "*" ? "warn" : "dim"}>{scopeLabel(scope)}</Badge>)}
                        </div>
                      </td>
                      <td className="font-mono text-[10px] text-dim">{key.lastUsedAt ? formatRelative(key.lastUsedAt) : "never"}</td>
                      <td>{key.revokedAt ? <Badge tone="bad">revoked</Badge> : <Badge tone="ok" dot>active</Badge>}</td>
                      <td>
                        <div className="flex justify-end">
                          {!key.revokedAt ? (
                            <Button size="icon" variant="ghost" onClick={() => setRevokingKey(key)} aria-label={`Revoke ${key.name}`}>
                              <Trash2 size={13} />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      <CreateUserDialog
        open={userDialog}
        onClose={() => setUserDialog(false)}
        onCreated={() => { setUserDialog(false); load(); }}
        defaultAdmin={users.length === 0}
      />
      <CreateKeyDialog
        open={keyDialog}
        onClose={() => setKeyDialog(false)}
        users={users}
        isAdmin={isAdmin}
        authEnabled={Boolean(state?.enabled)}
        onCreated={(key) => { setKeyDialog(false); setCreatedKey(key); load(); }}
      />
      <ResetPasswordDialog
        user={resetUser}
        onClose={() => setResetUser(null)}
        onDone={() => { setResetUser(null); load(); }}
      />

      <Dialog
        open={Boolean(createdKey)}
        onClose={() => setCreatedKey(null)}
        title="API key created"
        description="Copy this key now. It will not be shown again."
        footer={<Button variant="secondary" onClick={() => setCreatedKey(null)}>Done</Button>}
      >
        {createdKey ? (
          <div className="space-y-4">
            <div className="rounded-sm border border-ok/30 bg-ok/5 p-3">
              <p className="mono-label mb-1.5 text-ok">Secret</p>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-ink">{createdKey.key}</code>
                <Button size="sm" variant="secondary" onClick={() => copy(createdKey.key)}>
                  {copied ? <Check size={12} /> : <ClipboardCopy size={12} />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
            <div className="grid gap-2 text-[11px] text-muted sm:grid-cols-2">
              <p>Name: <span className="text-ink">{createdKey.name}</span></p>
              <p>Prefix: <span className="font-mono text-ink">{createdKey.keyPrefix}</span></p>
              <p>Scopes: <span className="text-ink">{createdKey.scopes.join(", ")}</span></p>
              <p>Owner: <span className="text-ink">{createdKey.username ?? createdKey.userId}</span></p>
            </div>
            <p className="text-[10px] leading-relaxed text-dim">
              Send it as <code className="font-mono text-muted">Authorization: Bearer {createdKey.keyPrefix}…</code> or
              <code className="ml-1 font-mono text-muted">x-api-key</code>.
            </p>
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={Boolean(deletingUser)}
        onClose={() => setDeletingUser(null)}
        onConfirm={deleteUser}
        loading={busy}
        danger
        title={deletingUser ? `Delete ${deletingUser.username}?` : "Delete user?"}
        description="Their sessions and API keys are removed with the account. The last admin cannot be deleted."
        confirmLabel="Delete user"
      />
      <ConfirmDialog
        open={Boolean(revokingKey)}
        onClose={() => setRevokingKey(null)}
        onConfirm={revoke}
        loading={busy}
        danger
        title={revokingKey ? `Revoke ${revokingKey.name}?` : "Revoke key?"}
        description="Requests using this key will receive 401 immediately. The key cannot be restored."
        confirmLabel="Revoke key"
      />
    </div>
  );
}

function CreateUserDialog({
  open,
  onClose,
  onCreated,
  defaultAdmin = false,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  defaultAdmin?: boolean;
}) {
  const { push } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(defaultAdmin ? "admin" : "user");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUsername("");
      setPassword("");
      setRole(defaultAdmin ? "admin" : "user");
      setError(null);
    }
  }, [open, defaultAdmin]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createUser({ username, password, role });
      push("User created", "success");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create user");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={defaultAdmin ? "Create the first admin" : "Add user"} description={defaultAdmin ? "The first account must be an admin to enable authentication. Users can view the dashboard; only admins can change providers, policy, and access." : "Users can view the dashboard; only admins can change providers, policy, and access."} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>{defaultAdmin ? "Create admin" : "Create user"}</Button></>}>
      <div className="space-y-4">
        {error ? <ErrorNotice message={error} /> : null}
        <Field label="Username"><Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="operator" /></Field>
        <Field label="Password" help="At least 8 characters."><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></Field>
        <Field label="Role" help={defaultAdmin ? "The first account should be an admin so it can enable authentication." : undefined}>
          <Select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="user">User — read-only</option>
            <option value="admin">Admin — full control</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

function CreateKeyDialog({
  open,
  onClose,
  users,
  isAdmin,
  authEnabled,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  users: User[];
  isAdmin: boolean;
  authEnabled: boolean;
  onCreated: (key: CreatedKey) => void;
}) {
  const { push } = useToast();
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const [scopes, setScopes] = useState<string[]>(["*"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setUserId("");
      setScopes(["*"]);
      setError(null);
    }
  }, [open]);

  const toggleScope = (scope: string) => {
    setScopes((current) => {
      if (scope === "*") return ["*"];
      const next = current.includes("*") ? [] : [...current];
      if (next.includes(scope)) return next.filter((item) => item !== scope);
      return [...next, scope];
    });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = isAdmin
        ? await api.createKey({ name: name || "default", user_id: userId || undefined, scopes })
        : await api.createMyKey({ name: name || "default", scopes });
      push("API key generated", "success");
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create key");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Generate API key" description="Keys are hashed at rest. Choose the narrowest scope that works." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Generate key</Button></>}>
      <div className="space-y-4">
        {error ? <ErrorNotice message={error} /> : null}
        <Field label="Key name"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="production-client" /></Field>
        {isAdmin && authEnabled && users.length > 0 ? (
          <Field label="Owner"><Select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">You ({users.find((user) => user.role === "admin")?.username ?? "admin"})</option>{users.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}</Select></Field>
        ) : !authEnabled ? (
          <p className="text-[10px] leading-relaxed text-dim">
            Owner: system (authentication is off). The key remains valid if you enable
            authentication later.
          </p>
        ) : null}
        <div>
          <p className="field-label mb-2">Scopes</p>
          <div className="flex flex-wrap gap-2">
            {SCOPES.map((scope) => (
              <button
                key={scope}
                type="button"
                onClick={() => toggleScope(scope)}
                aria-pressed={scopes.includes(scope)}
                className={`rounded-sm border px-2.5 py-1.5 font-mono text-[10px] transition-colors ${
                  scopes.includes(scope) ? "border-accent bg-accent-soft text-ink" : "border-line text-muted hover:border-line-strong"
                }`}
              >
                {scope === "*" ? "all operations" : scope}
              </button>
            ))}
          </div>
          <p className="field-help mt-2">“All operations” includes Firecrawl passthrough paths. Narrow scopes are checked before routing.</p>
        </div>
      </div>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose, onDone }: { user: User | null; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPassword("");
    setError(null);
  }, [user]);

  const submit = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await api.resetUserPassword(user.id, password);
      push("Password reset", "success");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(user)} onClose={onClose} title={user ? `Reset ${user.username}'s password` : "Reset password"} description="Existing sessions stay valid until they expire." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Reset password</Button></>}>
      <div className="space-y-4">
        {error ? <ErrorNotice message={error} /> : null}
        <Field label="New password" help="At least 8 characters."><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></Field>
      </div>
    </Dialog>
  );
}
