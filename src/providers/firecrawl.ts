import type {
  Capability,
  Operation,
  ProbeResult,
  ProviderInput,
  ProviderRecord,
  Settings,
} from "../types";
import { isHttpUrl, truncate } from "../utils";
import type { AdapterExecution, ProviderAdapter } from "./types";
import {
  FIRECRAWL_CAPABILITIES,
  errorMessageFromBody,
  hintForStatus,
  providerSupports,
  searchRequestFromBody,
  statusFailureKind,
  timedFetch,
  upstreamFailure,
} from "./shared";

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "cookie",
]);

function upstreamHeaders(
  request: Request,
  provider: ProviderRecord,
  includeAuth: boolean,
): Headers {
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower === "authorization" || lower === "x-api-key") continue;
    headers.set(key, value);
  }
  if (includeAuth && provider.apiKey) {
    headers.set("Authorization", `Bearer ${provider.apiKey}`);
  }
  return headers;
}

function targetUrl(provider: ProviderRecord, request: Request): string {
  const url = new URL(request.url);
  return `${provider.baseUrl}${url.pathname}${url.search}`;
}

async function executeSearchApiPath(
  provider: ProviderRecord,
  request: Request,
  body: ArrayBuffer | null,
  settings: Settings,
): Promise<AdapterExecution> {
  const parsed = searchRequestFromBody(body, new URL(request.url));
  if (!parsed) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ success: false, error: "A non-empty query is required" }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
      failureKind: "client",
      error: "A non-empty query is required",
    };
  }

  const payload: Record<string, unknown> = {
    query: parsed.query,
    limit: parsed.limit,
    ...parsed.extra,
  };
  const headers = upstreamHeaders(request, provider, true);
  headers.set("content-type", "application/json");

  try {
    const response = await timedFetch(
      `${provider.baseUrl}/v2/search`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      },
      settings.routing.requestTimeoutMs,
    );
    if (!response.ok) {
      const text = await response.clone().text();
      return upstreamFailure(
        response,
        statusFailureKind(response.status),
        errorMessageFromBody(text, `Firecrawl returned ${response.status}`),
      );
    }
    return { ok: true, response, failureKind: null, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ success: false, error: message }),
        { status: 502, headers: { "content-type": "application/json" } },
      ),
      failureKind: message.toLowerCase().includes("timed out") ? "timeout" : "network",
      error: message,
    };
  }
}

export const firecrawlAdapter: ProviderAdapter = {
  metadata: {
    type: "firecrawl",
    label: "Firecrawl",
    shortLabel: "Firecrawl",
    description:
      "Firecrawl Cloud or a self-hosted Firecrawl instance. Supports search, scrape, crawl, map, extract, and batch scrape passthrough.",
    defaultBaseUrl: "https://api.firecrawl.dev",
    docsUrl: "https://docs.firecrawl.dev",
    auth: {
      required: false,
      label: "Firecrawl API key",
      placeholder: "fc-...",
      hint: "Optional for self-hosted instances and Firecrawl's keyless endpoints. Cloud keys start with fc-.",
    },
    capabilities: FIRECRAWL_CAPABILITIES,
    notes: [
      "v1 and v2 paths are passed through unchanged, so responses keep Firecrawl's native shape.",
      "Health probes use /v0/health/readiness. When an API key is configured, the credit usage endpoint validates the key too.",
    ],
  },

  supports(provider: ProviderRecord, operation: Operation): boolean {
    return providerSupports(provider, operation, FIRECRAWL_CAPABILITIES);
  },

  validate(input: ProviderInput): string[] {
    const issues: string[] = [];
    if (!isHttpUrl(input.baseUrl)) issues.push("Base URL must be a valid http(s) URL");
    return issues;
  },

  async execute(provider, request, body, operation, settings) {
    const url = new URL(request.url);
    const isUnifiedSearch = url.pathname === "/api/search" || url.pathname === "/search";

    if (isUnifiedSearch) {
      return executeSearchApiPath(provider, request, body, settings);
    }

    // Firecrawl is a transparent passthrough for /v1/* and /v2/*.
    try {
      const response = await timedFetch(
        targetUrl(provider, request),
        {
          method: request.method,
          headers: upstreamHeaders(request, provider, true),
          body:
            request.method !== "GET" && request.method !== "HEAD"
              ? (body ?? undefined)
              : undefined,
        },
        settings.routing.requestTimeoutMs,
      );

      if (!response.ok) {
        const text = await response.clone().text();
        return upstreamFailure(
          response,
          statusFailureKind(response.status),
          errorMessageFromBody(text, `Firecrawl returned ${response.status}`),
        );
      }

      return { ok: true, response, failureKind: null, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error";
      return {
        ok: false,
        response: new Response(
          JSON.stringify({ success: false, error: message }),
          { status: 502, headers: { "content-type": "application/json" } },
        ),
        failureKind: message.toLowerCase().includes("timed out") ? "timeout" : "network",
        error: message,
      };
    }
  },

  async probe(provider, settings): Promise<ProbeResult> {
    const started = Date.now();
    const config = provider.config as { probeMode?: string };
    const mode = config.probeMode ?? "auto";
    const timeout = settings.routing.probeTimeoutMs;

    async function probeReadiness(): Promise<ProbeResult> {
      try {
        const response = await timedFetch(
          `${provider.baseUrl}/v0/health/readiness`,
          { method: "GET" },
          timeout,
        );
        const text = truncate(await response.text(), 2_000);
        if (response.ok) {
          return {
            ok: true,
            statusCode: response.status,
            latencyMs: Date.now() - started,
            body: text,
            error: null,
            hint: null,
            failureKind: null,
          };
        }
        return {
          ok: false,
          statusCode: response.status,
          latencyMs: Date.now() - started,
          body: text,
          error: `Health endpoint returned ${response.status}`,
          hint: hintForStatus(response.status, "Firecrawl"),
          failureKind: statusFailureKind(response.status),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Network error";
        return {
          ok: false,
          statusCode: null,
          latencyMs: Date.now() - started,
          body: null,
          error: message,
          hint: "Could not reach the Firecrawl readiness endpoint.",
          failureKind: message.toLowerCase().includes("timed out") ? "timeout" : "network",
        };
      }
    }

    const shouldCheckCredits =
      Boolean(provider.apiKey) && (mode === "auto" || mode === "credit");

    if (shouldCheckCredits) {
      try {
        const response = await timedFetch(
          `${provider.baseUrl}/v2/team/credit-usage`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${provider.apiKey}` },
          },
          timeout,
        );
        const text = truncate(await response.text(), 2_000);
        if (response.ok) {
          return {
            ok: true,
            statusCode: response.status,
            latencyMs: Date.now() - started,
            body: text,
            error: null,
            hint: null,
            failureKind: null,
          };
        }
        // Older/self-hosted builds may not expose the billing route. Fall back
        // to readiness in that case.
        if (response.status === 404) {
          return probeReadiness();
        }
        return {
          ok: false,
          statusCode: response.status,
          latencyMs: Date.now() - started,
          body: text,
          error: `Credit usage endpoint returned ${response.status}`,
          hint: hintForStatus(response.status, "Firecrawl"),
          failureKind: statusFailureKind(response.status),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Network error";
        return {
          ok: false,
          statusCode: null,
          latencyMs: Date.now() - started,
          body: null,
          error: message,
          hint: "Could not reach the Firecrawl credit usage endpoint.",
          failureKind: message.toLowerCase().includes("timed out") ? "timeout" : "network",
        };
      }
    }

    return probeReadiness();
  },
};

export type { Capability };
