import type {
  ProbeResult,
  ProviderInput,
  ProviderRecord,
  SearchResponse,
  SearchResult,
  Settings,
} from "../types";
import {
  getPath,
  isHttpUrl,
  renderTemplate,
  safeJsonParse,
  truncate,
} from "../utils";
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

interface GenericSearchConfig {
  method?: "GET" | "POST";
  path?: string;
  queryParam?: string;
  limitParam?: string;
  extraQuery?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  resultsPath?: string;
  fields?: {
    url?: string;
    title?: string;
    description?: string;
    content?: string;
    markdown?: string;
    siteName?: string;
    publishedAt?: string;
    score?: string;
  };
}

interface GenericAuthConfig {
  type?: "none" | "bearer" | "header" | "query" | "basic";
  headerName?: string;
  prefix?: string;
  queryParam?: string;
  username?: string;
}

interface GenericProbeConfig {
  method?: "GET" | "POST" | "HEAD";
  path?: string;
  body?: unknown;
  headers?: Record<string, string>;
  expectStatus?: number[];
  expectJsonPath?: string;
}

interface GenericConfig {
  search?: GenericSearchConfig;
  auth?: GenericAuthConfig;
  probe?: GenericProbeConfig;
}

function configOf(provider: ProviderRecord | ProviderInput): GenericConfig {
  return (provider.config ?? {}) as GenericConfig;
}

function authParts(
  provider: ProviderRecord | ProviderInput,
  config: GenericConfig,
): { headers: Record<string, string>; query: URLSearchParams } {
  const headers: Record<string, string> = {};
  const query = new URLSearchParams();
  const auth = config.auth ?? { type: "none" };
  const key = provider.apiKey ?? "";
  if (!key || auth.type === "none" || !auth.type) {
    return { headers, query };
  }

  if (auth.type === "bearer") {
    headers.Authorization = `Bearer ${key}`;
  } else if (auth.type === "header") {
    headers[auth.headerName ?? "X-API-Key"] = `${auth.prefix ?? ""}${key}`;
  } else if (auth.type === "query") {
    query.set(auth.queryParam ?? "api_key", key);
  } else if (auth.type === "basic") {
    headers.Authorization = `Basic ${Buffer.from(`${auth.username ?? "user"}:${key}`).toString("base64")}`;
  }
  return { headers, query };
}

function asText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(asText).filter((item): item is string => Boolean(item));
    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeResults(
  payload: unknown,
  config: GenericConfig,
  limit: number,
): SearchResult[] {
  const search = config.search ?? {};
  const results = getPath(payload, search.resultsPath ?? "results");
  if (!Array.isArray(results)) return [];
  const fields = search.fields ?? {};
  return results
    .slice(0, limit)
    .map((item): SearchResult | null => {
      if (!item || typeof item !== "object") return null;
      const url = asText(getPath(item, fields.url ?? "url"));
      if (!url) return null;
      const content = asText(getPath(item, fields.content ?? "content"));
      const description =
        asText(getPath(item, fields.description ?? "description")) ??
        asText(getPath(item, fields.content ?? "content"));
      const markdown = asText(getPath(item, fields.markdown ?? "markdown"));
      return {
        url,
        title: asText(getPath(item, fields.title ?? "title")),
        description,
        content,
        markdown,
        siteName: asText(getPath(item, fields.siteName ?? "site_name")),
        publishedAt: asText(getPath(item, fields.publishedAt ?? "date")),
        score: asNumber(getPath(item, fields.score ?? "score")),
        metadata: {},
      };
    })
    .filter((item): item is SearchResult => item !== null);
}

function buildSearchRequest(
  provider: ProviderRecord,
  config: GenericConfig,
  input: { query: string; limit: number; extra: Record<string, unknown> },
  headers: Record<string, string>,
  authQuery: URLSearchParams,
): { url: string; init: RequestInit } {
  const search = config.search ?? {};
  const method = search.method ?? "POST";
  const path = search.path ?? "/search";
  const url = new URL(`${provider.baseUrl}${path}`);

  for (const [key, value] of authQuery) url.searchParams.set(key, value);
  for (const [key, value] of Object.entries(search.extraQuery ?? {})) {
    url.searchParams.set(key, value);
  }

  const requestHeaders: Record<string, string> = {
    ...headers,
    ...(search.headers ?? {}),
  };

  if (method === "GET") {
    url.searchParams.set(search.queryParam ?? "q", input.query);
    if (search.limitParam) {
      url.searchParams.set(search.limitParam, String(input.limit));
    }
    return { url: url.toString(), init: { method: "GET", headers: requestHeaders } };
  }

  const bodyTemplate = search.body ?? {
    query: "{{query}}",
    limit: "{{limit}}",
  };
  const body = renderTemplate(bodyTemplate, {
    query: input.query,
    limit: input.limit,
    ...input.extra,
  });
  requestHeaders["content-type"] = "application/json";
  return {
    url: url.toString(),
    init: { method: "POST", headers: requestHeaders, body: JSON.stringify(body) },
  };
}

export const genericAdapter: ProviderAdapter = {
  metadata: {
    type: "generic",
    label: "Generic REST search",
    shortLabel: "Generic",
    description:
      "Configurable REST search adapter with presets for web, news, research, and developer search APIs. Use Custom for anything else.",
    defaultBaseUrl: "",
    auth: {
      required: false,
      label: "API key",
      placeholder: "Provider API key",
      hint: "Injected according to the auth config: bearer, header, query parameter, or basic.",
    },
    capabilities: ["search"],
    presets: [
      {
        id: "tavily",
        label: "Tavily",
        description: "POST /search with Bearer auth. Best simple bootstrap provider.",
        baseUrl: "https://api.tavily.com",
        apiKeyHint: "tvly-...",
        config: {
          auth: { type: "bearer" },
          search: {
            method: "POST",
            path: "/search",
            body: {
              query: "{{query}}",
              max_results: "{{limit}}",
              search_depth: "basic",
            },
            resultsPath: "results",
            fields: { title: "title", url: "url", content: "content", description: "content" },
          },
          probe: { method: "GET", path: "/usage", expectStatus: [200] },
        },
      },
      {
        id: "brave",
        label: "Brave Search",
        description: "GET /res/v1/web/search with an X-Subscription-Token header.",
        baseUrl: "https://api.search.brave.com",
        apiKeyHint: "BSA...",
        config: {
          auth: { type: "header", headerName: "X-Subscription-Token", prefix: "" },
          search: {
            method: "GET",
            path: "/res/v1/web/search",
            queryParam: "q",
            limitParam: "count",
            resultsPath: "web.results",
            fields: { title: "title", url: "url", description: "description" },
          },
          probe: {
            method: "GET",
            path: "/res/v1/web/search?q=health&count=1",
            expectStatus: [200],
          },
        },
      },
      {
        id: "searxng",
        label: "SearXNG",
        description: "Self-hosted metasearch. JSON format must be enabled on the instance.",
        baseUrl: "http://localhost:8080",
        config: {
          auth: { type: "none" },
          search: {
            method: "GET",
            path: "/search",
            queryParam: "q",
            extraQuery: { format: "json" },
            resultsPath: "results",
            fields: { title: "title", url: "url", content: "content", description: "content" },
          },
          probe: { method: "GET", path: "/healthz", expectStatus: [200] },
        },
      },
      {
        id: "exa",
        label: "Exa",
        description: "POST /search with neural search results and optional page text.",
        baseUrl: "https://api.exa.ai",
        apiKeyHint: "exa-...",
        config: {
          auth: { type: "bearer" },
          search: {
            method: "POST",
            path: "/search",
            body: {
              query: "{{query}}",
              numResults: "{{limit}}",
              contents: { text: true },
            },
            resultsPath: "results",
            fields: { title: "title", url: "url", content: "text", description: "text" },
          },
          probe: {
            method: "POST",
            path: "/search",
            body: { query: "health", numResults: 1 },
            expectStatus: [200],
          },
        },
      },
      {
        id: "serper",
        label: "Serper",
        description: "Google SERP results via POST /search with an X-API-KEY header.",
        baseUrl: "https://google.serper.dev",
        apiKeyHint: "Serper API key",
        config: {
          auth: { type: "header", headerName: "X-API-KEY", prefix: "" },
          search: {
            method: "POST",
            path: "/search",
            body: { q: "{{query}}", num: "{{limit}}" },
            resultsPath: "organic",
            fields: { title: "title", url: "link", description: "snippet" },
          },
          probe: {
            method: "POST",
            path: "/search",
            body: { q: "health", num: 1 },
            expectStatus: [200],
          },
        },
      },
      {
        id: "duckduckgo",
        label: "DuckDuckGo Instant Answer",
        description: "Keyless Instant Answer API. Returns related topics, not the full web result page.",
        baseUrl: "https://api.duckduckgo.com",
        config: {
          auth: { type: "none" },
          search: {
            method: "GET",
            path: "/",
            queryParam: "q",
            extraQuery: { format: "json", no_html: "1", skip_disambig: "1" },
            resultsPath: "RelatedTopics",
            fields: { title: "Text", url: "FirstURL", description: "Text" },
          },
          probe: {
            method: "GET",
            path: "/?q=health&format=json&no_html=1",
            expectStatus: [200],
          },
        },
      },
      {
        id: "google-cse",
        label: "Google Programmable Search",
        description: "Google Custom Search JSON API. Set your Search Engine ID (cx) in the advanced config.",
        baseUrl: "https://www.googleapis.com",
        apiKeyHint: "Google API key",
        config: {
          auth: { type: "query", queryParam: "key" },
          search: {
            method: "GET",
            path: "/customsearch/v1",
            queryParam: "q",
            limitParam: "num",
            extraQuery: { cx: "YOUR_SEARCH_ENGINE_ID" },
            resultsPath: "items",
            fields: { title: "title", url: "link", description: "snippet" },
          },
          probe: {
            method: "GET",
            path: "/customsearch/v1?q=health&num=1&cx=YOUR_SEARCH_ENGINE_ID",
            expectStatus: [200],
            expectJsonPath: "items",
          },
        },
      },
      {
        id: "serpapi",
        label: "SerpAPI",
        description: "Google SERP results. One-result probes consume SerpAPI searches.",
        baseUrl: "https://serpapi.com",
        apiKeyHint: "SerpAPI key",
        config: {
          auth: { type: "query", queryParam: "api_key" },
          search: {
            method: "GET",
            path: "/search.json",
            queryParam: "q",
            limitParam: "num",
            extraQuery: { engine: "google" },
            resultsPath: "organic_results",
            fields: { title: "title", url: "link", description: "snippet" },
          },
          probe: {
            method: "GET",
            path: "/search.json?engine=google&q=health&num=1",
            expectStatus: [200],
            expectJsonPath: "organic_results",
          },
        },
      },
      {
        id: "searchapi",
        label: "SearchApi.io",
        description: "Google SERP results. One-result probes consume SearchApi credits.",
        baseUrl: "https://www.searchapi.io",
        apiKeyHint: "SearchApi key",
        config: {
          auth: { type: "query", queryParam: "api_key" },
          search: {
            method: "GET",
            path: "/api/v1/search",
            queryParam: "q",
            limitParam: "num",
            extraQuery: { engine: "google" },
            resultsPath: "organic_results",
            fields: { title: "title", url: "link", description: "snippet" },
          },
          probe: {
            method: "GET",
            path: "/api/v1/search?engine=google&q=health&num=1",
            expectStatus: [200],
            expectJsonPath: "organic_results",
          },
        },
      },
      {
        id: "scrapingdog",
        label: "ScrapingDog",
        description: "Google SERP results. One-result probes consume ScrapingDog credits.",
        baseUrl: "https://api.scrapingdog.com",
        apiKeyHint: "ScrapingDog API key",
        config: {
          auth: { type: "query", queryParam: "api_key" },
          search: {
            method: "GET",
            path: "/google",
            queryParam: "query",
            limitParam: "num",
            resultsPath: "organic_results",
            fields: { title: "title", url: "link", description: "snippet" },
          },
          probe: {
            method: "GET",
            path: "/google?query=health&num=1",
            expectStatus: [200],
            expectJsonPath: "organic_results",
          },
        },
      },
      {
        id: "valueserp",
        label: "ValueSERP",
        description: "Google SERP results. One-result probes consume ValueSERP searches.",
        baseUrl: "https://api.valueserp.com",
        apiKeyHint: "ValueSERP API key",
        config: {
          auth: { type: "query", queryParam: "api_key" },
          search: {
            method: "GET",
            path: "/search",
            queryParam: "q",
            limitParam: "num",
            resultsPath: "organic_results",
            fields: { title: "title", url: "link", description: "snippet" },
          },
          probe: {
            method: "GET",
            path: "/search?q=health&num=1",
            expectStatus: [200],
            expectJsonPath: "organic_results",
          },
        },
      },
      {
        id: "zenserp",
        label: "Zenserp",
        description: "Google SERP results. One-result probes consume Zenserp searches.",
        baseUrl: "https://app.zenserp.com",
        apiKeyHint: "Zenserp API key",
        config: {
          auth: { type: "query", queryParam: "apikey" },
          search: {
            method: "GET",
            path: "/api/v2/search",
            queryParam: "q",
            limitParam: "num",
            resultsPath: "organic",
            fields: { title: "title", url: "url", description: "description" },
          },
          probe: {
            method: "GET",
            path: "/api/v2/search?q=health&num=1",
            expectStatus: [200],
            expectJsonPath: "organic",
          },
        },
      },
      {
        id: "kagi",
        label: "Kagi Search",
        description: "Kagi Search API with Bot authorization. Requires a Kagi API plan.",
        baseUrl: "https://kagi.com",
        apiKeyHint: "Kagi API token",
        config: {
          auth: { type: "header", headerName: "Authorization", prefix: "Bot " },
          search: {
            method: "GET",
            path: "/api/v0/search",
            queryParam: "q",
            limitParam: "limit",
            resultsPath: "data",
            fields: { title: "title", url: "url", description: "snippet" },
          },
          probe: {
            method: "GET",
            path: "/api/v0/search?q=health&limit=1",
            expectStatus: [200],
            expectJsonPath: "data",
          },
        },
      },
      {
        id: "youcom",
        label: "You.com",
        description: "You.com Search API. Requires a You.com API key.",
        baseUrl: "https://ydc-index.io",
        apiKeyHint: "You.com API key",
        config: {
          auth: { type: "header", headerName: "X-API-Key", prefix: "" },
          search: {
            method: "GET",
            path: "/v1/search",
            queryParam: "query",
            resultsPath: "hits",
            fields: { title: "title", url: "url", description: "description", content: "snippets" },
          },
          probe: {
            method: "GET",
            path: "/v1/search?query=health",
            expectStatus: [200],
            expectJsonPath: "hits",
          },
        },
      },
      {
        id: "newsapi",
        label: "NewsAPI",
        description: "News articles only. The developer plan has query and environment restrictions.",
        baseUrl: "https://newsapi.org",
        apiKeyHint: "NewsAPI key",
        config: {
          auth: { type: "header", headerName: "X-Api-Key", prefix: "" },
          search: {
            method: "GET",
            path: "/v2/everything",
            queryParam: "q",
            limitParam: "pageSize",
            resultsPath: "articles",
            fields: { title: "title", url: "url", description: "description" },
          },
          probe: {
            method: "GET",
            path: "/v2/everything?q=health&pageSize=1",
            expectStatus: [200],
            expectJsonPath: "articles",
          },
        },
      },
      {
        id: "gnews",
        label: "GNews",
        description: "News articles only. Free-tier query limits apply.",
        baseUrl: "https://gnews.io",
        apiKeyHint: "GNews API key",
        config: {
          auth: { type: "query", queryParam: "apikey" },
          search: {
            method: "GET",
            path: "/api/v4/search",
            queryParam: "q",
            limitParam: "max",
            extraQuery: { lang: "en" },
            resultsPath: "articles",
            fields: { title: "title", url: "url", description: "description" },
          },
          probe: {
            method: "GET",
            path: "/api/v4/search?q=health&max=1&lang=en",
            expectStatus: [200],
            expectJsonPath: "articles",
          },
        },
      },
      {
        id: "hackernews",
        label: "Hacker News",
        description: "Keyless Algolia Hacker News search. Stories without URLs are skipped.",
        baseUrl: "https://hn.algolia.com",
        config: {
          auth: { type: "none" },
          search: {
            method: "GET",
            path: "/api/v1/search",
            queryParam: "query",
            limitParam: "hitsPerPage",
            resultsPath: "hits",
            fields: { title: "title", url: "url", description: "story_text", content: "story_text" },
          },
          probe: {
            method: "GET",
            path: "/api/v1/search?query=health&hitsPerPage=1",
            expectStatus: [200],
            expectJsonPath: "hits",
          },
        },
      },
      {
        id: "github",
        label: "GitHub",
        description: "Repository search. Unauthenticated requests are rate-limited; a token is optional.",
        baseUrl: "https://api.github.com",
        apiKeyHint: "GitHub token (optional)",
        config: {
          auth: { type: "header", headerName: "Authorization", prefix: "Bearer " },
          search: {
            method: "GET",
            path: "/search/repositories",
            queryParam: "q",
            limitParam: "per_page",
            headers: {
              Accept: "application/vnd.github+json",
              "User-Agent": "web-search-router",
            },
            resultsPath: "items",
            fields: { title: "full_name", url: "html_url", description: "description", content: "description" },
          },
          probe: {
            method: "GET",
            path: "/rate_limit",
            headers: {
              Accept: "application/vnd.github+json",
              "User-Agent": "web-search-router",
            },
            expectStatus: [200],
            expectJsonPath: "rate",
          },
        },
      },
      {
        id: "stackexchange",
        label: "Stack Exchange",
        description: "Stack Overflow and Stack Exchange search. Body fields contain HTML.",
        baseUrl: "https://api.stackexchange.com",
        apiKeyHint: "Stack Apps key (optional)",
        config: {
          auth: { type: "query", queryParam: "key" },
          search: {
            method: "GET",
            path: "/2.3/search/advanced",
            queryParam: "q",
            limitParam: "pagesize",
            extraQuery: { order: "desc", sort: "relevance", site: "stackoverflow" },
            resultsPath: "items",
            fields: { title: "title", url: "link", description: "body", content: "body" },
          },
          probe: {
            method: "GET",
            path: "/2.3/info?site=stackoverflow",
            expectStatus: [200],
            expectJsonPath: "items",
          },
        },
      },
      {
        id: "reddit",
        label: "Reddit public JSON",
        description: "Public Reddit search JSON. May be rate-limited or blocked; no OAuth flow.",
        baseUrl: "https://www.reddit.com",
        config: {
          auth: { type: "none" },
          search: {
            method: "GET",
            path: "/search.json",
            queryParam: "q",
            limitParam: "limit",
            headers: { "User-Agent": "web-search-router/1.0" },
            resultsPath: "data.children",
            fields: {
              title: "data.title",
              url: "data.url",
              description: "data.selftext",
              content: "data.selftext",
            },
          },
          probe: {
            method: "GET",
            path: "/search.json?q=health&limit=1",
            headers: { "User-Agent": "web-search-router/1.0" },
            expectStatus: [200],
            expectJsonPath: "data.children",
          },
        },
      },
      {
        id: "crossref",
        label: "Crossref",
        description: "Scholarly metadata search. Keyless; results point to DOI landing pages.",
        baseUrl: "https://api.crossref.org",
        config: {
          auth: { type: "none" },
          search: {
            method: "GET",
            path: "/works",
            queryParam: "query",
            limitParam: "rows",
            resultsPath: "message.items",
            fields: { title: "title", url: "URL", description: "abstract", content: "abstract" },
          },
          probe: {
            method: "GET",
            path: "/works?query=health&rows=1",
            expectStatus: [200],
            expectJsonPath: "message.items",
          },
        },
      },
      {
        id: "semantic-scholar",
        label: "Semantic Scholar",
        description: "Paper search. Unauthenticated requests are rate-limited; an API key is optional.",
        baseUrl: "https://api.semanticscholar.org",
        apiKeyHint: "Semantic Scholar API key (optional)",
        config: {
          auth: { type: "header", headerName: "x-api-key", prefix: "" },
          search: {
            method: "GET",
            path: "/graph/v1/paper/search",
            queryParam: "query",
            limitParam: "limit",
            resultsPath: "data",
            fields: { title: "title", url: "url", description: "abstract", content: "abstract" },
          },
          probe: {
            method: "GET",
            path: "/graph/v1/paper/search?query=health&limit=1",
            expectStatus: [200],
            expectJsonPath: "data",
          },
        },
      },
      {
        id: "google-books",
        label: "Google Books",
        description: "Book volume search. Basic use is keyless; an API key is optional.",
        baseUrl: "https://www.googleapis.com",
        apiKeyHint: "Google API key (optional)",
        config: {
          auth: { type: "query", queryParam: "key" },
          search: {
            method: "GET",
            path: "/books/v1/volumes",
            queryParam: "q",
            limitParam: "maxResults",
            resultsPath: "items",
            fields: {
              title: "volumeInfo.title",
              url: "volumeInfo.infoLink",
              description: "volumeInfo.description",
              content: "volumeInfo.description",
            },
          },
          probe: {
            method: "GET",
            path: "/books/v1/volumes?q=health&maxResults=1",
            expectStatus: [200],
            expectJsonPath: "items",
          },
        },
      },
      {
        id: "custom",
        label: "Custom",
        description: "Point at any JSON search endpoint and map the result fields.",
        baseUrl: "",
        config: {
          auth: { type: "none" },
          search: {
            method: "POST",
            path: "/search",
            body: { query: "{{query}}", limit: "{{limit}}" },
            resultsPath: "results",
            fields: { title: "title", url: "url", description: "description", content: "content" },
          },
        },
      },
    ],
    notes: [
      "GET requests use queryParam/limitParam. POST requests send the body template with {{query}}, {{limit}}, and extra request fields substituted.",
      "Results are read from resultsPath, then each item is mapped with fields.* dot paths.",
      "Google Programmable Search requires a Search Engine ID (cx) in the advanced JSON config.",
      "Some presets probe with a one-result search; those checks can consume provider credits.",
      "DuckDuckGo is the Instant Answer API, not full web results. Reddit public JSON may be rate-limited or blocked.",
    ],
  },

  supports(_provider, operation) {
    return operation === "search";
  },

  validate(input: ProviderInput): string[] {
    const issues: string[] = [];
    if (!isHttpUrl(input.baseUrl)) issues.push("Base URL must be a valid http(s) URL");
    const config = configOf(input);
    const search = config.search;
    if (!search) {
      issues.push("Search configuration is required");
      return issues;
    }
    if (search.path !== undefined && !search.path.startsWith("/")) {
      issues.push("Search path must start with /");
    }
    if (search.method && search.method !== "GET" && search.method !== "POST") {
      issues.push("Search method must be GET or POST");
    }
    if (search.resultsPath !== undefined && search.resultsPath.length === 0) {
      issues.push("Results path cannot be empty");
    }
    if (config.auth?.type === "header" && !config.auth.headerName) {
      issues.push("Auth header name is required for header authentication");
    }
    if (config.auth?.type === "query" && !config.auth.queryParam) {
      issues.push("Auth query parameter is required for query authentication");
    }
    return issues;
  },

  async execute(provider, request, body, operation, settings): Promise<AdapterExecution> {
    if (operation !== "search") {
      return {
        ok: false,
        response: jsonResponse(
          { success: false, error: "Generic providers support search only" },
          501,
        ),
        failureKind: "unsupported",
        error: "Generic providers support search only",
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
    const { headers, query } = authParts(provider, config);
    const built = buildSearchRequest(provider, config, parsed, headers, query);

    try {
      const response = await timedFetch(
        built.url,
        built.init,
        settings.routing.requestTimeoutMs,
      );
      if (!response.ok) {
        const text = await response.clone().text();
        return upstreamFailure(
          response,
          statusFailureKind(response.status),
          errorMessageFromBody(text, `Upstream returned ${response.status}`),
        );
      }
      const payloadText = await response.clone().text();
      const payload = safeJsonParse(payloadText);
      if (payload === null) {
        return {
          ok: false,
          response: jsonResponse(
            { success: false, error: "Upstream returned invalid JSON" },
            502,
          ),
          failureKind: "invalid_response",
          error: "Upstream returned invalid JSON",
        };
      }
      const results = normalizeResults(payload, config, parsed.limit);
      const searchResponse: SearchResponse = { results, raw: payload };
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
    const { headers, query } = authParts(provider, config);
    const timeout = settings.routing.probeTimeoutMs;
    const probe = config.probe;

    try {
      let url: string;
      let init: RequestInit;
      let expectStatus = probe?.expectStatus ?? [200];
      let expectJsonPath = probe?.expectJsonPath;

      if (probe) {
        const target = new URL(`${provider.baseUrl}${probe.path ?? "/"}`);
        for (const [key, value] of query) target.searchParams.set(key, value);
        url = target.toString();
        const requestHeaders = { ...headers, ...(probe.headers ?? {}) };
        const method = probe.method ?? "GET";
        init = { method, headers: requestHeaders };
        if (method === "POST") {
          requestHeaders["content-type"] = "application/json";
          init.body = JSON.stringify(renderTemplate(probe.body ?? {}, {}));
        }
      } else {
        const built = buildSearchRequest(
          provider,
          config,
          { query: "web search router health check", limit: 1, extra: {} },
          headers,
          query,
        );
        url = built.url;
        init = built.init;
        expectStatus = [200];
        expectJsonPath = undefined;
      }

      const response = await timedFetch(url, init, timeout);
      const text = truncate(await response.text(), 2_000);
      const statusOk = expectStatus.includes(response.status);
      if (!statusOk) {
        return {
          ok: false,
          statusCode: response.status,
          latencyMs: Date.now() - started,
          body: text,
          error: `Probe returned ${response.status}`,
          hint: hintForStatus(response.status, "provider"),
          failureKind: statusFailureKind(response.status),
        };
      }

      if (expectJsonPath) {
        const parsed = safeJsonParse(text);
        if (parsed === null || getPath(parsed, expectJsonPath) === undefined) {
          return {
            ok: false,
            statusCode: response.status,
            latencyMs: Date.now() - started,
            body: text,
            error: `Expected JSON path "${expectJsonPath}" in probe response`,
            hint: "Update the provider probe configuration.",
            failureKind: "invalid_response",
          };
        }
      }

      if (!probe) {
        const parsed = safeJsonParse(text);
        const results = getPath(parsed, config.search?.resultsPath ?? "results");
        if (!Array.isArray(results)) {
          return {
            ok: false,
            statusCode: response.status,
            latencyMs: Date.now() - started,
            body: text,
            error: "Search probe returned an unexpected payload",
            hint: "Check resultsPath and the search response mapping.",
            failureKind: "invalid_response",
          };
        }
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
        hint: "Could not reach the provider probe endpoint.",
        failureKind: message.toLowerCase().includes("timed out") ? "timeout" : "network",
      };
    }
  },
};
