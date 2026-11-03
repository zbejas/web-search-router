# Providers — Adapters and Configuration

## Overview

A provider is one upstream that can serve some or all of the router's capabilities. Each provider has a `type` that selects an adapter, a base URL, optional encrypted API key, priority, enabled flag, health state, and adapter-specific JSON config. The router filters providers by capability before ordering them, so a search-only provider is never sent a scrape request.

The adapter registry is the only place that knows about provider-specific HTTP shapes. Adding a provider type means implementing one `ProviderAdapter` and registering it; routing, health, UI metadata, and secret handling stay unchanged.

## Key files

| File | Purpose |
|---|---|
| `src/providers/types.ts` | `ProviderAdapter`, `AdapterMetadata`, `AdapterExecution`, `AdapterPreset` contracts. |
| `src/providers/registry.ts` | Maps `ProviderType` to adapter instances and exposes metadata to the UI. |
| `src/providers/shared.ts` | Shared search-body parsing, status classification, timed fetch, error hints. |
| `src/providers/firecrawl.ts` | Firecrawl passthrough, `/api/search` bridge, readiness/credit probes. |
| `src/providers/deepseek.ts` | DeepSeek `/v1/tools/search` adapter. |
| `src/providers/generic.ts` | Config-driven REST search adapter and presets. |
| `src/providers/search.ts` | Firecrawl v1/v2 search response builders. |
| `src/providers/store.ts` | Provider CRUD, validation, encryption, health transitions, events. |
| `src/client/components/ProviderForm.tsx` | Dashboard form: type selection, metadata, presets, JSON config. |
| `tests/integration/adapters.test.ts` | Adapter request/response and auth contract tests. |
| `tests/integration/providers-api.test.ts` | Provider CRUD, secret masking, reorder, test, delete. |

## How it works

### Provider shape

```ts
interface Provider {
  id: string;                 // slug, immutable after creation
  name: string;
  type: "firecrawl" | "deepseek" | "generic";
  baseUrl: string;            // scheme + host, no /v1 or /v2 suffix
  apiKeySet: boolean;         // secret never returned by the API
  apiKeyHint: string | null;  // last 4 characters
  priority: number;           // higher wins
  enabled: boolean;           // manual routing switch
  health: "healthy" | "unhealthy" | "unknown";
  consecutiveFailures: number;
  capabilities: Capability[];
  config: Record<string, unknown>;
  probeIntervalSeconds: number | null; // per-provider override
  creditsRemaining: number | null;     // Firecrawl credit snapshot
  creditsPlan: number | null;
  creditsPeriodEnd: string | null;
  creditsCheckedAt: string | null;
  // lastCheckedAt, lastHealthyAt, lastError, lastStatusCode, lastLatencyMs,
  // requestCount, successRate, avgLatencyMs, createdAt, updatedAt
}
```

Create/update payloads accept `id`, `name`, `type`, `baseUrl`, `apiKey`, `priority`, `enabled`, `config`, `probeIntervalSeconds`. On update, omit `apiKey` to keep it, send `""` to clear it, or send a value to replace it.

### Capabilities

| Type | Capabilities | Routing behavior |
|---|---|---|
| `firecrawl` | `search`, `scrape`, `crawl`, `map`, `extract`, `batch_scrape`, `proxy` | `/v1/*` and `/v2/*` passthrough; `/api/search` bridged to `/v2/search`. |
| `deepseek` | `search` | Same search paths. |
| `generic` | `search` | Same search paths. |

`proxy` covers unrecognized `/v1/*` or `/v2/*` paths such as `/v1/team/credit-usage`. Only Firecrawl supports it. A request for an operation no enabled provider supports returns `501` with a message naming the operation.

### Firecrawl

```json
{
  "probeMode": "auto"
}
```

- `probeMode`: `"auto"` (default), `"readiness"`, or `"credit"`.
  - `auto` uses `/v2/team/credit-usage` when an API key is configured, otherwise `/v0/health/readiness`.
  - `credit` forces the credit endpoint; `404` falls back to readiness for older/self-hosted builds.
  - `readiness` always uses `/v0/health/readiness`.
- The credit probe reads `data.remainingCredits`, `data.planCredits`, and `data.billingPeriodEnd`, persists them on the provider, and exposes them in the dashboard. A zero or negative balance is a `quota` probe failure, so a provider disabled for exhausted credits stays unhealthy until the balance recovers. An unparseable credit response is an `invalid_response` failure.
- Firecrawl providers with an API key in `auto`/`credit` mode are probed on the normal health interval even while healthy, so their credit snapshot stays current without enabling `routing.probeHealthy` for every provider type.
- Auth is `Authorization: Bearer <key>` when a key is set. Omit the key for self-hosted instances with `USE_DB_AUTHENTICATION=false` and for Firecrawl keyless endpoints.
- Base URL: `https://api.firecrawl.dev` for Cloud, `http://localhost:3002` for the official self-host quickstart. Do not include `/v1` or `/v2`.
- Passthrough preserves the upstream status, body, and content type. v1 and v2 shapes are not translated.

### DeepSeek

```json
{
  "searchPath": "/v1/tools/search",
  "needContent": true,
  "probeMode": "search"
}
```

- Calls `POST https://api.deepseek.com/v1/tools/search` with `Authorization: Bearer <key>`.
- Request body: `{ query, count: limit, need_content }`, plus `ori_question`/`localization` when supplied by the caller.
- Response fields map to: `url`, `title`, `description` (`snippet` or `summary`), `content` (`content` or `summary`), `siteName`, `publishedAt`, `score` (`rerank_score`).
- `probeMode`: `"search"` (default) issues a one-result search; `"models"` uses `GET /models` for a cheaper auth/liveness check.
- DeepSeek bills successful search requests. Probes are not free.

### Generic REST

```json
{
  "auth": {
    "type": "bearer"
  },
  "search": {
    "method": "POST",
    "path": "/search",
    "body": {
      "query": "{{query}}",
      "max_results": "{{limit}}"
    },
    "resultsPath": "results",
    "fields": {
      "title": "title",
      "url": "url",
      "content": "content",
      "description": "content"
    }
  },
  "probe": {
    "method": "GET",
    "path": "/usage",
    "expectStatus": [200]
  }
}
```

#### `auth`

| Type | Behavior |
|---|---|
| `"none"` | No auth. |
| `"bearer"` | `Authorization: Bearer <key>`. |
| `"header"` | `<headerName>: <prefix><key>`; `headerName` defaults to `X-API-Key`. |
| `"query"` | `<queryParam>=<key>`; `queryParam` defaults to `api_key`. |
| `"basic"` | `Authorization: Basic base64(<username>:<key>)`; `username` defaults to `user`. |

#### `search`

| Key | Meaning |
|---|---|
| `method` | `"GET"` or `"POST"`; default `POST`. |
| `path` | Path appended to `baseUrl`; default `/search`. |
| `queryParam` | GET query parameter for the search text; default `q`. |
| `limitParam` | GET query parameter for the limit; optional. |
| `extraQuery` | Static query parameters, e.g. `{"format":"json"}` for SearXNG. |
| `body` | POST template. `{{query}}` and `{{limit}}` are substituted; exact `{{limit}}` becomes a number. |
| `headers` | Extra request headers. |
| `resultsPath` | Dot path to the results array; default `results`. |
| `fields` | Dot paths for `title`, `url`, `description`, `content`, `markdown`, `siteName`, `publishedAt`, `score`. |

The URL field is required per result; items without one are dropped. Arrays in content fields are joined with blank lines.

#### `probe`

| Key | Meaning |
|---|---|
| `method` | `GET`, `POST`, or `HEAD`; default `GET`. |
| `path` | Path appended to `baseUrl`. |
| `body` | POST probe body template. |
| `headers` | Extra probe headers. |
| `expectStatus` | Accepted status codes; default `[200]`. |
| `expectJsonPath` | Dot path that must exist in the response JSON. |

If `probe` is omitted entirely, the adapter issues a one-result search and verifies `resultsPath` is an array. That tests the search path but may cost credits.

#### Presets

`GET /api/providers/types` returns the generic presets the UI uses:

| Preset | Search | Auth | Probe |
|---|---|---|---|
| `tavily` | `POST /search`, `results` | Bearer | `GET /usage` |
| `brave` | `GET /res/v1/web/search`, `web.results` | `X-Subscription-Token` header | one-result search |
| `searxng` | `GET /search?format=json`, `results` | none | `GET /healthz` |
| `exa` | `POST /search`, `results` | Bearer | one-result search |
| `serper` | `POST /search`, `organic` | `X-API-KEY` header | one-result search |
| `duckduckgo` | `GET /`, related topics | none | HTTP 200 |
| `google-cse` | `GET /customsearch/v1`, `items` | `key` query | one-result search |
| `serpapi` | `GET /search.json`, `organic_results` | `api_key` query | one-result search |
| `searchapi` | `GET /api/v1/search`, `organic_results` | `api_key` query | one-result search |
| `scrapingdog` | `GET /google`, `organic_results` | `api_key` query | one-result search |
| `valueserp` | `GET /search`, `organic_results` | `api_key` query | one-result search |
| `zenserp` | `GET /api/v2/search`, `organic` | `apikey` query | one-result search |
| `kagi` | `GET /api/v0/search`, `data` | `Authorization: Bot` header | one-result search |
| `youcom` | `GET /v1/search`, `hits` | `X-API-Key` header | one-result search |
| `newsapi` | `GET /v2/everything`, `articles` | `X-Api-Key` header | one-result search |
| `gnews` | `GET /api/v4/search`, `articles` | `apikey` query | one-result search |
| `hackernews` | `GET /api/v1/search`, `hits` | none | one-result search |
| `github` | `GET /search/repositories`, `items` | optional Bearer | `GET /rate_limit` |
| `stackexchange` | `GET /2.3/search/advanced`, `items` | optional `key` query | `GET /2.3/info` |
| `reddit` | `GET /search.json`, `data.children` | none | one-result search |
| `crossref` | `GET /works`, `message.items` | none | one-result search |
| `semantic-scholar` | `GET /graph/v1/paper/search`, `data` | optional `x-api-key` | one-result search |
| `google-books` | `GET /books/v1/volumes`, `items` | optional `key` query | one-result search |
| `custom` | `POST /search`, `results` | none | one-result search |

SearXNG instances must enable JSON output (`search.formats: [html, json]`); otherwise `/search?format=json` returns `403`. Google Programmable Search also needs a `cx` Search Engine ID in both the search `extraQuery` and the probe path. DuckDuckGo is the Instant Answer API only; it returns related topics, not a full web result page. Reddit public JSON may be rate-limited or blocked. Presets that probe with a one-result search can consume credits.

### Adding an adapter

1. Add a value to `ProviderType` in `src/types.ts`.
2. Create `src/providers/<type>.ts` exporting a `ProviderAdapter`.
3. Implement `metadata`, `supports()`, `validate()`, `execute()`, and `probe()`.
4. Register it in `src/providers/registry.ts`.
5. Add a `ProviderTypeMark` icon mapping in `src/client/components/status.tsx`.
6. Add integration tests in `tests/integration/adapters.test.ts` using the mock upstream.
7. Add a row to the provider matrix in [`../README.md`](../README.md) and this doc.

The adapter contract:

```ts
interface ProviderAdapter {
  metadata: AdapterMetadata;
  supports(provider: ProviderRecord, operation: Operation): boolean;
  validate(input: ProviderInput): string[];
  execute(
    provider: ProviderRecord,
    request: Request,
    body: ArrayBuffer | null,
    operation: Operation,
    settings: Settings,
  ): Promise<AdapterExecution>;
  probe(provider: ProviderRecord, settings: Settings): Promise<ProbeResult>;
}
```

- `execute()` may return a raw upstream `Response` (Firecrawl passthrough) or a normalized `searchResponse` for the router to serialize into v1/v2.
- `probe()` must consume its response body and return `failureKind` so the health state machine can classify auth, quota, rate-limit, server, and network failures.
- Never log or return the decrypted provider key.

## Gotchas & invariants

- **Base URLs never include `/v1` or `/v2`.** Paths are appended by the adapter or preserved from the incoming request. Trailing slashes are stripped by the provider store.
- **Firecrawl self-hosted may not expose team/billing routes.** `probeMode: "auto"` falls back to `/v0/health/readiness` when credit usage returns `404`.
- **Firecrawl probes do not validate auth in readiness mode.** Use `probeMode: "auto"`/`"credit"` with a Cloud key so the credit endpoint validates the key; a bad key will fail the probe.
- **DeepSeek probes cost money.** A one-result search is billed if successful. Use `probeMode: "models"` if you prefer auth-only liveness at the cost of not testing the search path.
- **Generic preset mapping is path-based, not schema-based.** If a provider changes its response shape, update `resultsPath`/`fields`; no code change is needed.
- **A generic provider with no `search` config is rejected.** Use the `custom` preset or send a complete `search` object.
- **Capabilities are derived from the adapter, not from config.** Changing `config` does not make a search-only provider handle scrape.
- **Provider keys are encrypted, but the adapter receives plaintext.** Keep `execute()`/`probe()` free of logging; use `src/utils.ts` redaction helpers if you add diagnostics.
- **`apiKey` is optional in validation for every type.** The adapter will send an unauthenticated request; the provider will usually return `401`, and the health state machine will auto-disable it after the configured threshold.
- **Changing a provider's type resets capabilities to the new adapter's metadata.** The old config JSON is replaced by the form's default when the UI changes type; review it before saving.

## Related docs

- [`architecture.md`](architecture.md) — routing and health state machine.
- [`api.md`](api.md) — provider management endpoints and proxy auth.
- [`testing.md`](testing.md) — mock upstream and adapter tests.
- [`../README.md`](../README.md) — provider matrix and quick start.
