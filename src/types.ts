export type ProviderType = "firecrawl" | "deepseek" | "generic";

export type ProviderHealth = "healthy" | "unhealthy" | "unknown";

export type Capability =
  | "search"
  | "scrape"
  | "crawl"
  | "map"
  | "extract"
  | "batch_scrape"
  | "proxy";

export type Operation = Capability;

export type FailureKind =
  | "network"
  | "timeout"
  | "auth"
  | "quota"
  | "rate_limit"
  | "server"
  | "client"
  | "unsupported"
  | "invalid_response"
  | "unknown";

export type ApiScope = "*" | "search" | "scrape" | "crawl" | "map" | "extract" | "batch_scrape";

export interface ProviderRecord {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string | null;
  apiKeyEncrypted: string | null;
  apiKeyHint: string | null;
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
  createdAt: string;
  updatedAt: string;
}

export interface Provider extends Omit<ProviderRecord, "apiKey" | "apiKeyEncrypted"> {
  apiKeySet: boolean;
  requestCount?: number;
  successRate?: number;
  avgLatencyMs?: number;
}

export interface ProviderInput {
  id?: string;
  name?: string;
  type: ProviderType;
  baseUrl: string;
  apiKey?: string | null;
  priority?: number;
  enabled?: boolean;
  config?: Record<string, unknown>;
  probeIntervalSeconds?: number | null;
}

export interface ProviderEvent {
  id: number;
  providerId: string;
  timestamp: string;
  event: string;
  message: string | null;
  statusCode: number | null;
  latencyMs: number | null;
}

export interface SearchResult {
  url: string;
  title?: string;
  description?: string;
  content?: string;
  markdown?: string;
  siteName?: string;
  publishedAt?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface SearchRequest {
  query: string;
  limit: number;
  extra: Record<string, unknown>;
}

export interface SearchResponse {
  results: SearchResult[];
  creditsUsed?: number;
  raw?: unknown;
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
  failureKind: FailureKind | null;
}

export interface CreditState {
  remainingCredits: number;
  planCredits: number | null;
  periodEnd: string | null;
}

export interface ProbeResult {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  body: string | null;
  error: string | null;
  hint: string | null;
  failureKind: FailureKind | null;
  creditsUsed?: number;
  credits?: CreditState | null;
}

export interface ProviderTestResult extends ProbeResult {
  providerId: string;
  providerType: ProviderType;
  checkedAt: string;
  state: Provider;
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

export interface AuthUser {
  id: string;
  username: string;
  role: string;
}

export interface ApiKeyValidation {
  keyId: string;
  userId: string;
  scopes: ApiScope[];
}

export interface ApiKeyRow {
  id: string;
  userId: string;
  username?: string;
  name: string;
  keyPrefix: string;
  scopes: ApiScope[];
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface RequestLogInput {
  requestId: string;
  method: string;
  path: string;
  query: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  operation: Operation;
  providerId: string | null;
  providerType: ProviderType | null;
  attempts: RouteAttempt[];
  responseStatus: number | null;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  durationMs: number;
  error: string | null;
  errorKind: FailureKind | null;
  keyId: string | null;
  clientIp: string | null;
}

export interface LogEntry extends RequestLogInput {
  id: number;
  timestamp: string;
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
