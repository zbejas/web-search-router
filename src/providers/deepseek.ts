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

interface DeepSeekConfig {
  searchPath?: string;
  needContent?: boolean;
  probeMode?: "search" | "models";
  language?: string;
}

function configOf(provider: ProviderRecord): DeepSeekConfig {
  return (provider.config ?? {}) as DeepSeekConfig;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeResults(payload: unknown): SearchResult[] {
  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((item): SearchResult | null => {
      if (!item || typeof item !== "object") return null;
      const value = item as Record<string, unknown>;
      const url = asString(value.url);
      if (!url) return null;
      return {
        url,
        title: asString(value.title),
        description: asString(value.snippet) ?? asString(value.summary),
        content: asString(value.content) ?? asString(value.summary),
        siteName: asString(value.site_name),
        publishedAt: asString(value.date),
        score: typeof value.rerank_score === "number" ? value.rerank_score : undefined,
        metadata: {
          authority: value.authority,
          siteIcon: value.site_icon,
        },
      };
    })
    .filter((item): item is SearchResult => item !== null);
}

export const deepseekAdapter: ProviderAdapter = {
  metadata: {
    type: "deepseek",
    label: "DeepSeek Search",
    shortLabel: "DeepSeek",
    description:
      "DeepSeek's standalone Search API. Returns ranked web results with optional page content.",
    defaultBaseUrl: "https://api.deepseek.com",
    docsUrl: "https://api-docs.deepseek.com/guides/search/",
    auth: {
      required: true,
      label: "DeepSeek API key",
      placeholder: "sk-...",
      hint: "Sent as Authorization: Bearer <key> to api.deepseek.com.",
    },
    capabilities: ["search"],
    notes: [
      "Search costs $0.75 per 1,000 successful requests according to DeepSeek's docs.",
      "Health probes issue a one-result search with need_content=false.",
    ],
  },

  supports(_provider, operation) {
    return operation === "search";
  },

  validate(input: ProviderInput): string[] {
    const issues: string[] = [];
    if (!isHttpUrl(input.baseUrl)) issues.push("Base URL must be a valid http(s) URL");
    const config = (input.config ?? {}) as DeepSeekConfig;
    if (config.searchPath !== undefined && !config.searchPath.startsWith("/")) {
      issues.push("Search path must start with /");
    }
    return issues;
  },

  async execute(provider, request, body, operation, settings): Promise<AdapterExecution> {
    if (operation !== "search") {
      return {
        ok: false,
        response: jsonResponse(
          { success: false, error: "DeepSeek supports search only" },
          501,
        ),
        failureKind: "unsupported",
        error: "DeepSeek supports search only",
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
    const payload: Record<string, unknown> = {
      query: parsed.query,
      count: parsed.limit,
      need_content: config.needContent ?? true,
    };
    if (typeof parsed.extra.ori_question === "string") {
      payload.ori_question = parsed.extra.ori_question;
    }
    if (typeof parsed.extra.localization === "string") {
      payload.localization = parsed.extra.localization;
    }
    if (config.language && typeof payload.localization !== "string") {
      payload.localization = config.language;
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;

    const url = `${provider.baseUrl}${config.searchPath ?? "/v1/tools/search"}`;
    try {
      const response = await timedFetch(
        url,
        { method: "POST", headers, body: JSON.stringify(payload) },
        settings.routing.requestTimeoutMs,
      );
      if (!response.ok) {
        const text = await response.clone().text();
        return upstreamFailure(
          response,
          statusFailureKind(response.status),
          errorMessageFromBody(text, `DeepSeek returned ${response.status}`),
        );
      }
      const payloadJson = (await response.clone().json()) as unknown;
      const searchResponse: SearchResponse = {
        results: normalizeResults(payloadJson),
        raw: payloadJson,
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
    const timeout = settings.routing.probeTimeoutMs;

    if (config.probeMode === "models") {
      try {
        const response = await timedFetch(
          `${provider.baseUrl}/models`,
          {
            method: "GET",
            headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
          },
          timeout,
        );
        const text = truncate(await response.text(), 2_000);
        return {
          ok: response.ok,
          statusCode: response.status,
          latencyMs: Date.now() - started,
          body: text,
          error: response.ok ? null : `Models endpoint returned ${response.status}`,
          hint: response.ok ? null : hintForStatus(response.status, "DeepSeek"),
          failureKind: response.ok ? null : statusFailureKind(response.status),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Network error";
        return {
          ok: false,
          statusCode: null,
          latencyMs: Date.now() - started,
          body: null,
          error: message,
          hint: "Could not reach the DeepSeek models endpoint.",
          failureKind: message.toLowerCase().includes("timed out") ? "timeout" : "network",
        };
      }
    }

    try {
      const response = await timedFetch(
        `${provider.baseUrl}${config.searchPath ?? "/v1/tools/search"}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
          },
          body: JSON.stringify({
            query: "web search router health check",
            count: 1,
            need_content: false,
          }),
        },
        timeout,
      );
      const text = truncate(await response.text(), 2_000);
      if (!response.ok) {
        return {
          ok: false,
          statusCode: response.status,
          latencyMs: Date.now() - started,
          body: text,
          error: `Search endpoint returned ${response.status}`,
          hint: hintForStatus(response.status, "DeepSeek"),
          failureKind: statusFailureKind(response.status),
        };
      }
      const parsed = JSON.parse(text) as { results?: unknown };
      if (!Array.isArray(parsed.results)) {
        return {
          ok: false,
          statusCode: response.status,
          latencyMs: Date.now() - started,
          body: text,
          error: "Search endpoint returned an unexpected payload",
          hint: "Expected a results array. Check the base URL and API version.",
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
        hint: "Could not reach the DeepSeek search endpoint.",
        failureKind: message.toLowerCase().includes("timed out") ? "timeout" : "network",
      };
    }
  },
};


