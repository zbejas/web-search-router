import type { Capability, Operation, ProviderRecord } from "../types";

export const FIRECRAWL_CAPABILITIES: Capability[] = [
  "search",
  "scrape",
  "crawl",
  "map",
  "extract",
  "batch_scrape",
  "proxy",
];

export function providerSupports(
  provider: ProviderRecord,
  operation: Operation,
  supported: Capability[],
): boolean {
  if (provider.capabilities.length > 0) {
    return provider.capabilities.includes(operation);
  }
  return supported.includes(operation);
}

export function trimLimit(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(parsed)));
}

export function searchRequestFromBody(
  body: ArrayBuffer | null,
  requestUrl: URL,
): { query: string; limit: number; extra: Record<string, unknown> } | null {
  let parsed: Record<string, unknown> = {};
  if (body && body.byteLength > 0) {
    try {
      const value = JSON.parse(new TextDecoder().decode(body));
      if (value && typeof value === "object" && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  const queryValue = parsed.query ?? requestUrl.searchParams.get("query") ?? requestUrl.searchParams.get("q");
  if (typeof queryValue !== "string" || queryValue.trim().length === 0) return null;

  const limitValue = parsed.limit ?? requestUrl.searchParams.get("limit");
  const limit = trimLimit(limitValue, 10, 100);
  const extra = { ...parsed };
  delete extra.query;
  delete extra.limit;
  return { query: queryValue.trim(), limit, extra };
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export function errorMessageFromBody(text: string, fallback: string): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.error === "string") return parsed.error;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // not JSON
  }
  return text.trim() || fallback;
}

export function upstreamFailure(
  response: Response,
  kind: import("../types").FailureKind,
  error: string | null,
): import("./types").AdapterExecution {
  return { ok: false, response, failureKind: kind, error };
}

export function statusFailureKind(status: number): import("../types").FailureKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  if (status >= 400) return "client";
  return "unknown";
}

export function hintForStatus(status: number, providerType: string): string | null {
  if (status === 401) return "Authentication failed. Check the provider API key.";
  if (status === 402) return "Upstream reports insufficient credits or billing is not configured.";
  if (status === 403) return "The upstream key is not permitted to use this endpoint.";
  if (status === 404) return "Endpoint not found. Check the base URL and API version.";
  if (status === 408) return "The upstream timed out before completing the request.";
  if (status === 429) return "The upstream is rate limiting or at its concurrency limit.";
  if (status >= 500) return `The ${providerType} upstream returned a server error.`;
  return null;
}
