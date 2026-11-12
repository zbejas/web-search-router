export type ProviderType = "firecrawl" | "deepseek" | "opencode" | "generic";
export type ProviderHealth = "healthy" | "unhealthy" | "unknown";
export type Capability =
  | "search"
  | "scrape"
  | "crawl"
  | "map"
  | "extract"
  | "batch_scrape"
  | "proxy";

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  priority: number;
  enabled: boolean;
  health: ProviderHealth;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  lastHealthyAt: string | null;
  lastError: string | null;
  lastStatusCode: number | null;
  lastLatencyMs: number | null;
  creditsRemaining: number | null;
  creditsPlan: number | null;
  creditsPeriodEnd: string | null;
  creditsCheckedAt: string | null;
  capabilities: Capability[];
  config: Record<string, unknown>;
  probeIntervalSeconds: number | null;
  apiKeySet: boolean;
  apiKeyHint: string | null;
  requestCount: number;
  successRate: number;
  avgLatencyMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdapterPreset {
  id: string;
  label: string;
  description: string;
  baseUrl: string;
  apiKeyHint?: string;
  config: Record<string, unknown>;
}

export interface ProviderTypeMeta {
  type: ProviderType;
  label: string;
  shortLabel: string;
  description: string;
  defaultBaseUrl: string;
  docsUrl?: string;
  auth: {
    required: boolean;
    label: string;
    placeholder?: string;
    hint?: string;
  };
  capabilities: Capability[];
  presets?: AdapterPreset[];
  notes?: string[];
}

export interface RouteAttempt {
  providerId: string;
  providerType: ProviderType;
  priority: number;
  phase: "primary" | "last_resort";
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  error: string | null;
  failureKind: string | null;
}

export interface LogEntry {
  id: number;
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  query: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  operation: string;
  providerId: string | null;
  providerType: ProviderType | null;
  attempts: RouteAttempt[];
  responseStatus: number | null;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  durationMs: number;
  error: string | null;
  errorKind: string | null;
  keyId: string | null;
  clientIp: string | null;
}

export interface LogStats {
  total: number;
  successCount: number;
  errorCount: number;
  avgDurationMs: number;
  p50: number;
  p95: number;
  perProvider: {
    providerId: string;
    count: number;
    successRate: number;
    avgLatencyMs: number;
  }[];
}

export interface Settings {
  routing: {
    failureThreshold: number;
    healthCheckIntervalSeconds: number;
    probeTimeoutMs: number;
    requestTimeoutMs: number;
    totalTimeoutMs: number;
    maxAttempts: number;
    lastResortEnabled: boolean;
    probeHealthy: boolean;
    autoRecoverEnabled: boolean;
  };
  logging: {
    retentionDays: number;
    logBodies: boolean;
    maxBodyChars: number;
  };
  auth: {
    enabled: boolean;
    sessionDays: number;
  };
  rateLimit: {
    enabled: boolean;
    rpm: number;
  };
}

export interface SettingsField {
  path: string;
  group: keyof Settings;
  label: string;
  description: string;
  type: "number" | "boolean";
  default: number | boolean;
  min?: number;
  max?: number;
  step?: number;
}

export interface Overview {
  providers: Provider[];
  route: Provider[];
  stats: LogStats;
  events: ProviderEvent[];
  settings: Settings;
  auth: { enabled: boolean; hasUsers: boolean };
  meta: { version: string; port: number; uptimeSeconds: number };
}

export interface ProviderEvent {
  id: number;
  providerId: string;
  providerName?: string;
  timestamp: string;
  event: string;
  message: string | null;
  statusCode: number | null;
  latencyMs: number | null;
}

export interface CreditState {
  remainingCredits: number;
  planCredits: number | null;
  periodEnd: string | null;
}

export interface ProviderTestResult {
  providerId: string;
  providerType: ProviderType;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  body: string | null;
  error: string | null;
  hint: string | null;
  failureKind: string | null;
  credits?: CreditState | null;
  checkedAt: string;
  state: Provider;
}

export interface AuthState {
  enabled: boolean;
  hasUsers: boolean;
  needsSetup: boolean;
  user: { id: string; username: string; role: string } | null;
}

export interface User {
  id: string;
  username: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  userId: string;
  username?: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreatedKey extends ApiKey {
  key: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const issues = Array.isArray(payload.issues) ? (payload.issues as string[]) : [];
    throw new ApiError(
      typeof payload.error === "string" ? payload.error : `${response.status} ${response.statusText}`,
      response.status,
      issues,
    );
  }
  return payload as T;
}

function get<T>(url: string): Promise<T> {
  return requestJson<T>(url);
}

function post<T>(url: string, body?: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function put<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, { method: "PUT", body: JSON.stringify(body) });
}

function patch<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, { method: "PATCH", body: JSON.stringify(body) });
}

function del<T>(url: string): Promise<T> {
  return requestJson<T>(url, { method: "DELETE" });
}

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  return search.toString();
}

export const api = {
  authState: () => get<AuthState>("/api/auth/state"),
  login: (username: string, password: string) => post<{ user: AuthState["user"] }>("/api/auth/login", { username, password }),
  logout: () => post<{ ok: boolean }>("/api/auth/logout"),
  setup: (username: string, password: string, enableAuth: boolean) =>
    post<{ user: AuthState["user"]; enabled: boolean }>("/api/auth/setup", { username, password, enableAuth }),
  enableAuth: (enabled: boolean, username?: string, password?: string) =>
    post<{ enabled: boolean; hasUsers: boolean }>("/api/auth/enable", { enabled, username, password }),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ ok: boolean }>("/api/auth/password", { currentPassword, newPassword }),

  overview: () => get<Overview>("/api/overview"),
  meta: () => get<{ name: string; version: string; port: number; host: string; uptimeSeconds: number }>("/api/meta"),
  healthCheck: () => post<{ checked: number; results: ProviderTestResult[] }>("/api/health/check"),

  providerTypes: () => get<ProviderTypeMeta[]>("/api/providers/types"),
  providers: () => get<Provider[]>("/api/providers"),
  provider: (id: string) => get<Provider>(`/api/providers/${encodeURIComponent(id)}`),
  createProvider: (body: unknown) => post<Provider>("/api/providers", body),
  updateProvider: (id: string, body: unknown) => put<Provider>(`/api/providers/${encodeURIComponent(id)}`, body),
  deleteProvider: (id: string) => del<{ deleted: string }>(`/api/providers/${encodeURIComponent(id)}`),
  testProvider: (id: string) => post<ProviderTestResult>(`/api/providers/${encodeURIComponent(id)}/test`),
  enableProvider: (id: string) => post<Provider>(`/api/providers/${encodeURIComponent(id)}/enable`),
  disableProvider: (id: string) => post<Provider>(`/api/providers/${encodeURIComponent(id)}/disable`),
  reorderProviders: (ids: string[]) => post<Provider[]>("/api/providers/reorder", { ids }),
  providerEvents: (id: string, limit = 50) =>
    get<ProviderEvent[]>(`/api/providers/${encodeURIComponent(id)}/events?limit=${limit}`),
  events: (limit = 20) => get<ProviderEvent[]>(`/api/events?limit=${limit}`),

  settings: () => get<Settings>("/api/settings"),
  settingsSchema: () => get<{ schema: SettingsField[]; defaults: Settings }>("/api/settings/schema"),
  patchSettings: (body: unknown) => patch<Settings>("/api/settings", body),
  resetSettings: () => post<Settings>("/api/settings/reset"),

  logs: (params: Record<string, string | number | undefined>) =>
    get<{ rows: LogEntry[]; total: number }>(`/api/logs?${queryString(params)}`),
  logStats: () => get<LogStats>("/api/logs/stats"),
  logTimeseries: (minutes = 60, bucket = 5) =>
    get<{ buckets: { time: string; requests: number; errors: number; p50: number; p95: number }[] }>(
      `/api/logs/timeseries?minutes=${minutes}&bucket=${bucket}`,
    ),
  logDaily: (days = 30) =>
    get<{ buckets: { date: string; requests: number; errors: number; p50: number; p95: number }[] }>(
      `/api/logs/timeseries/daily?days=${days}`,
    ),
  logWeekly: (weeks = 12) =>
    get<{ buckets: { week: string; requests: number; errors: number; p50: number; p95: number }[] }>(
      `/api/logs/timeseries/weekly?weeks=${weeks}`,
    ),
  sourceTotals: () => get<{ sources: { providerId: string; total: number }[] }>("/api/logs/source-totals"),

  users: () => get<User[]>("/api/users"),
  createUser: (body: { username: string; password: string; role?: string }) => post<User>("/api/users", body),
  deleteUser: (id: string) => del<{ deleted: string }>(`/api/users/${encodeURIComponent(id)}`),
  resetUserPassword: (id: string, password: string) =>
    post<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}/password`, { password }),

  keys: () => get<ApiKey[]>("/api/keys"),
  createKey: (body: { name: string; user_id?: string; scopes?: string[] }) => post<CreatedKey>("/api/keys", body),
  revokeKey: (id: string) => del<{ revoked: string }>(`/api/keys/${encodeURIComponent(id)}`),
  myKeys: () => get<ApiKey[]>("/api/keys/mine"),
  createMyKey: (body: { name: string; scopes?: string[] }) => post<CreatedKey>("/api/keys/mine", body),
  revokeMyKey: (id: string) => del<{ revoked: string }>(`/api/keys/mine/${encodeURIComponent(id)}`),
};
