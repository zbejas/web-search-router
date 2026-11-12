import type {
  Operation,
  ProbeResult,
  ProviderInput,
  ProviderRecord,
  SearchResponse,
  SearchResult,
  Settings,
} from "../types";
import { isHttpUrl, truncate } from "../utils";
import type { AdapterExecution, ProviderAdapter } from "./types";
import {
  errorMessageFromBody,
  hintForStatus,
  jsonResponse,
  searchRequestFromBody,
  statusFailureKind,
  timedFetch,
  upstreamFailure,
} from "./shared";

/** OpenCode caps hosted web search at eight results per request. */
const MAX_RESULTS = 8;
const DEFAULT_PATH = "/console/api/websearch";
const DEFAULT_PROVIDER_ID = "opencode";

interface OpenCodeConfig {
  searchPath?: string;
  providerID?: string;
  orgId?: string;
}

function configOf(provider: ProviderRecord): OpenCodeConfig {
  return (provider.config ?? {}) as OpenCodeConfig;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function publishedAtOf(value: Record<string, unknown>): string | undefined {
  const time = value.time;
  if (!time || typeof time !== "object") return undefined;
  const published = (time as Record<string, unknown>).published;
  if (typeof published === "number" && Number.isFinite(published)) {
    const date = new Date(published);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return asString(published);
}

function normalizeResults(payload: unknown, limit: number): SearchResult[] {
  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  return results
    .slice(0, Math.min(limit, MAX_RESULTS))
    .map((item): SearchResult | null => {
      if (!item || typeof item !== "object") return null;
      const value = item as Record<string, unknown>;
      const url = asString(value.url);
      if (!url) return null;
      const content = asString(value.content);
      return {
        url,
        title: asString(value.title),
        description: content,
        content,
        publishedAt: publishedAtOf(value),
        metadata: {},
      };
    })
    .filter((item): item is SearchResult => item !== null);
}

function payloadFor(query: string, config: OpenCodeConfig): Record<string, unknown> {
  return {
    query,
    providerID: asString(config.providerID) ?? DEFAULT_PROVIDER_ID,
  };
}

function requestHeaders(provider: ProviderRecord, config: OpenCodeConfig): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  const orgId = asString(config.orgId);
  if (orgId) headers["x-org-id"] = orgId;
  return headers;
}

function upstreamError(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed._tag === "string") return `OpenCode returned ${status} (${parsed._tag})`;
  } catch {
    // fall through to the shared parser
  }
  return errorMessageFromBody(text, `OpenCode returned ${status}`);
}

export const opencodeAdapter: ProviderAdapter = {
  metadata: {
    type: "opencode",
    label: "OpenCode Web Search",
    shortLabel: "OpenCode",
    description:
      "Hosted web search from OpenCode Console. Returns up to eight results with page content.",
    defaultBaseUrl: "https://opencode.ai",
    docsUrl: "https://opencode.ai/docs/console/websearch/",
    auth: {
      required: true,
      label: "OpenCode API key",
      placeholder: "oc_sk_...",
      hint: "Sent as Authorization: Bearer <key>. Hosted Web Search must be enabled for the workspace.",
    },
    capabilities: ["search"],
    notes: [
      "Enable Hosted Web Search for the workspace in OpenCode Console before adding the provider.",
      "Each successful search costs $0.01 and returns at most eight results.",
      "Health probes issue a one-result search; successful probes are billed $0.01.",
      "Set config.orgId to send x-org-id when the key can access more than one workspace.",
    ],
  },

  supports(_provider, operation) {
    return operation === "search";
  },

  validate(input: ProviderInput): string[] {
    const issues: string[] = [];
    if (!isHttpUrl(input.baseUrl)) issues.push("Base URL must be a valid http(s) URL");
    const config = (input.config ?? {}) as OpenCodeConfig;
    if (
      config.searchPath !== undefined &&
      (typeof config.searchPath !== "string" || !config.searchPath.startsWith("/"))
    ) {
      issues.push("Search path must start with /");
    }
    if (
      config.providerID !== undefined &&
      (typeof config.providerID !== "string" || config.providerID.trim().length === 0)
    ) {
      issues.push("Provider ID must be a non-empty string");
    }
    if (config.orgId !== undefined && typeof config.orgId !== "string") {
      issues.push("Organization ID must be a string");
    }
    return issues;
  },

  async execute(provider, request, body, operation, settings): Promise<AdapterExecution> {
    if (operation !== "search") {
      return {
        ok: false,
        response: jsonResponse(
          { success: false, error: "OpenCode supports search only" },
          501,
        ),
        failureKind: "unsupported",
        error: "OpenCode supports search only",
      };
    }

    const parsed = searchRequestFromBody(body, new URL(request.url));
    if (!parsed) {
      return {
        ok: false,
        response: jsonResponse({ success: false, error: "A non-empty query is required" }, 400),
        failureKind: "client",
        error: "A non-empty query is required",
      };
    }

    const config = configOf(provider);
    const url = `${provider.baseUrl}${config.searchPath ?? DEFAULT_PATH}`;
    try {
      const response = await timedFetch(
        url,
        {
          method: "POST",
          headers: requestHeaders(provider, config),
          body: JSON.stringify(payloadFor(parsed.query, config)),
        },
        settings.routing.requestTimeoutMs,
      );
      const text = await response.text();
      if (!response.ok) {
        return upstreamFailure(
          response,
          statusFailureKind(response.status),
          upstreamError(text, response.status),
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        return {
          ok: false,
          response: jsonResponse(
            { success: false, error: "OpenCode returned an unexpected payload" },
            502,
          ),
          failureKind: "invalid_response",
          error: "OpenCode returned an unexpected payload",
        };
      }

      if (!Array.isArray((payload as { results?: unknown })?.results)) {
        return {
          ok: false,
          response: jsonResponse(
            { success: false, error: "OpenCode returned an unexpected payload" },
            502,
          ),
          failureKind: "invalid_response",
          error: "OpenCode returned an unexpected payload",
        };
      }

      const searchResponse: SearchResponse = {
        results: normalizeResults(payload, parsed.limit),
        raw: payload,
      };
      return {
        ok: true,
        response: jsonResponse(searchResponse),
        failureKind: null,
        error: null,
        searchResponse,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error";
      return {
        ok: false,
        response: jsonResponse({ success: false, error: message }, 502),
        failureKind: message.toLowerCase().includes("timed out") ? "timeout" : "network",
        error: message,
      };
    }
  },

  async probe(provider, settings): Promise<ProbeResult> {
    const started = Date.now();
    const config = configOf(provider);
    try {
      const response = await timedFetch(
        `${provider.baseUrl}${config.searchPath ?? DEFAULT_PATH}`,
        {
          method: "POST",
          headers: requestHeaders(provider, config),
          body: JSON.stringify(payloadFor("web search router health check", config)),
        },
        settings.routing.probeTimeoutMs,
      );
      const fullText = await response.text();
      const text = truncate(fullText, 2_000);
      if (!response.ok) {
        return {
          ok: false,
          statusCode: response.status,
          latencyMs: Date.now() - started,
          body: text,
          error: upstreamError(fullText, response.status),
          hint: hintForStatus(response.status, "OpenCode"),
          failureKind: statusFailureKind(response.status),
        };
      }
      let parsed: { results?: unknown };
      try {
        parsed = JSON.parse(fullText) as { results?: unknown };
      } catch {
        return {
          ok: false,
          statusCode: response.status,
          latencyMs: Date.now() - started,
          body: text,
          error: "OpenCode returned an unexpected payload",
          hint: "Expected a JSON body with a results array.",
          failureKind: "invalid_response",
        };
      }
      if (!Array.isArray(parsed.results)) {
        return {
          ok: false,
          statusCode: response.status,
          latencyMs: Date.now() - started,
          body: text,
          error: "OpenCode returned an unexpected payload",
          hint: "Expected a results array. Check the base URL and search path.",
          failureKind: "invalid_response",
        };
      }
      return {
        ok: true,
        statusCode: response.status,
        latencyMs: Date.now() - started,
        body: text,
        error: null,
        hint: null,
        failureKind: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error";
      return {
        ok: false,
        statusCode: null,
        latencyMs: Date.now() - started,
        body: null,
        error: message,
        hint: "Could not reach the OpenCode web search endpoint.",
        failureKind: message.toLowerCase().includes("timed out") ? "timeout" : "network",
      };
    }
  },
};
