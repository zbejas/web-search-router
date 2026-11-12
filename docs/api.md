# HTTP API — Proxy, Search, and Management

## Overview

The router exposes three surfaces:

1. **Firecrawl-compatible proxy** — `/v1/*` and `/v2/*`, including `/v1/search`, `/v2/search`, scrape, crawl, map, extract, batch scrape, and Firecrawl passthrough paths.
2. **Unified search** — `POST /api/search` and `GET /api/search?q=...`, returning a v2-shaped envelope with router metadata.
3. **Management API** — providers, settings, auth, users, keys, logs, health, and overview data used by the dashboard.

All JSON. All responses include `cache-control: no-store` on management/proxy paths. Proxied responses include `x-router-*` headers. Authentication rules are described below.

## Key files

| File | Purpose |
|---|---|
| `src/app.ts` | All HTTP routes, auth middleware, proxy handler, static assets. |
| `src/router.ts` | Proxy operation detection, failover, response headers, request logging. |
| `src/providers/search.ts` | v1/v2 search response envelopes. |
| `src/providers/firecrawl.ts` | Firecrawl passthrough and `/api/search` bridge. |
| `src/apikeys.ts` | Key validation, scopes, revocation. |
| `src/auth.ts` | Sessions, login, setup, password changes. |
| `src/ratelimit.ts` | Sliding-window limiter and headers. |
| `src/logger.ts` | Log query filters and stats. |
| `tests/integration/auth-api.test.ts` | Auth/key enforcement contract. |
| `tests/integration/settings-logs-api.test.ts` | Management API and log contract. |

## How it works

### Authentication

| State | Dashboard APIs | Proxy/search |
|---|---|---|
| `auth.enabled = false` | Open; requests act as `system` admin | Anonymous allowed; a supplied router key is still validated |
| `auth.enabled = true` | Session cookie required; mutations require `admin` | Valid router API key required |

Session cookie: `wsr_session` (legacy `fc_session` is accepted). Cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` when the request is HTTPS or `x-forwarded-proto: https`.

Router key headers:

```http
Authorization: Bearer wsr_...
x-api-key: wsr_...
```

Legacy `fr_` keys continue to validate. New keys are `wsr_` plus 48 hex characters. Keys are hashed with SHA-512; the plaintext is returned only once at creation.

Scopes:

| Scope | Allows |
|---|---|
| `*` | Every operation |
| `search` | Search paths |
| `scrape` | Scrape paths |
| `crawl` | Crawl paths |
| `map` | Map paths |
| `extract` | Extract paths |
| `batch_scrape` | Batch scrape paths |

`proxy` operations (unrecognized Firecrawl paths) require `scrape` or `crawl`, or `*`. Scope is checked before rate limiting and routing.

### Search and proxy routes

| Route | Operation | Response shape |
|---|---|---|
| `POST /v1/search` | `search` | Firecrawl v1: `{ success, data: [...] }` |
| `POST /v2/search` | `search` | Firecrawl v2: `{ success, data: { web: [...] }, creditsUsed, id }` |
| `POST /api/search` | `search` | Firecrawl v2 shape plus `router` metadata |
| `GET /api/search?q=...&limit=...` | `search` | Same as `/api/search` |
| `POST /v1/scrape` | `scrape` | Firecrawl passthrough |
| `POST /v2/scrape` | `scrape` | Firecrawl passthrough |
| `POST /v1/crawl`, `GET /v1/crawl/:id` | `crawl` | Firecrawl passthrough |
| `POST /v2/map` | `map` | Firecrawl passthrough |
| `POST /v1/extract`, `GET /v1/extract/:id` | `extract` | Firecrawl passthrough |
| `POST /v2/batch/scrape`, `GET /v2/batch/scrape/:id` | `batch_scrape` | Firecrawl passthrough |
| Any other `/v1/*` or `/v2/*` | `proxy` | Firecrawl passthrough |

Non-Firecrawl providers support `search` only. `search` requests to those providers are normalized into the version of the incoming path; `/api/search` always uses v2. A request for an operation no enabled provider supports returns `501`.

Example:

```bash
curl -X POST http://localhost:8123/api/search \
  -H 'content-type: application/json' \
  -d '{"query":"web search routing","limit":5}'
```

```json
{
  "success": true,
  "id": "uuid",
  "data": {
    "web": [
      {
        "url": "https://example.com",
        "title": "Example",
        "description": "Result description",
        "position": 1,
        "markdown": "Optional content",
        "metadata": { "sourceURL": "https://example.com" }
      }
    ]
  },
  "creditsUsed": 0,
  "router": {
    "providerId": "deepseek",
    "providerType": "deepseek",
    "attempts": [
      {
        "providerId": "deepseek",
        "providerType": "deepseek",
        "priority": 100,
        "phase": "primary",
        "ok": true,
        "statusCode": 200,
        "latencyMs": 412,
        "error": null,
        "failureKind": null
      }
    ],
    "latencyMs": 415,
    "requestId": "uuid"
  }
}
```

Firecrawl passthrough responses are not re-serialized. A `/v2/search` request sent to Firecrawl returns Firecrawl's exact body, including `creditsUsed` and `id`.

### Router response headers

| Header | Meaning |
|---|---|
| `x-router-request-id` | UUID for this routed request; matches the log row. |
| `x-router-provider` | Provider ID that served the response (or last attempted on failure). |
| `x-router-provider-type` | Provider type. |
| `x-router-attempts` | Number of provider attempts. |
| `x-router-latency-ms` | Total router time including failover. |
| `x-ratelimit-limit` | Requests/minute limit. |
| `x-ratelimit-remaining` | Remaining in the current window. |
| `x-ratelimit-reset` | Unix seconds when the window resets. |

### Error responses

Router-generated errors are JSON:

```json
{
  "success": false,
  "error": "All providers failed",
  "attempts": [ ... ]
}
```

| Status | Meaning |
|---|---|
| `400` | Invalid request body, query, provider payload, or settings. |
| `401` | Missing/invalid/revoked router key, expired session, or missing authentication. |
| `403` | Valid key/session but insufficient scope/role. |
| `404` | Management resource not found, or upstream client error passthrough. |
| `409` | Auth setup required or duplicate provider ID. |
| `413` | Request body larger than 25 MB. |
| `429` | Router rate limit exceeded. |
| `501` | No enabled provider supports the operation. |
| `502` | All providers failed with provider-caused errors. |
| `503` | No providers configured/enabled, or no healthy providers with last-resort disabled. |

Client errors from upstream (`400`, `422`, etc.) are returned unchanged when they stop the chain. `404`/`405` are tried against the next provider first; if every provider returns them, the last upstream response is returned.

### Management endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/_router/health` | public | Router status and sanitized provider health; `503` when down |
| `GET` | `/api/auth/state` | public | Auth enabled, users exist, current user, needs setup |
| `POST` | `/api/auth/login` | public | Login; sets session cookie |
| `POST` | `/api/auth/logout` | public | Clear session |
| `POST` | `/api/auth/setup` | public if no users | Create first admin; optional `enableAuth` |
| `POST` | `/api/auth/enable` | admin | Enable/disable auth; creates admin when no users exist; with existing users requires valid admin credentials and does not enable on failure |
| `POST` | `/api/auth/password` | user | Change own password |
| `GET` | `/api/users` | admin | List users |
| `POST` | `/api/users` | admin | Create user |
| `POST` | `/api/users/:id/password` | admin | Reset a user's password |
| `DELETE` | `/api/users/:id` | admin | Delete a user (last admin protected) |
| `GET` | `/api/providers/types` | user | Adapter metadata and generic presets |
| `GET` | `/api/providers` | user | List providers with stats, no secrets |
| `POST` | `/api/providers` | admin | Create provider |
| `GET` | `/api/providers/:id` | user | Get provider |
| `PUT`/`PATCH` | `/api/providers/:id` | admin | Update provider; omit `apiKey` to keep, `""` to clear |
| `DELETE` | `/api/providers/:id` | admin | Delete provider and its events |
| `POST` | `/api/providers/:id/test` | admin | Run a provider-specific probe |
| `POST` | `/api/providers/:id/enable` | admin | Enable manually; health becomes `unknown` |
| `POST` | `/api/providers/:id/disable` | admin | Disable manually; excluded from routing |
| `POST` | `/api/providers/reorder` | admin | Body `{ ids: [...] }` in desired order; rewrites priorities |
| `GET` | `/api/providers/:id/events` | user | Provider state-transition history |
| `GET` | `/api/events` | user | Recent events across providers |
| `GET` | `/api/settings` | user | Full settings object |
| `GET` | `/api/settings/schema` | user | Field schema and defaults |
| `PATCH` | `/api/settings` | admin | Grouped or flat partial update, validated |
| `POST` | `/api/settings/reset` | admin | Restore defaults (auth returns to disabled) |
| `POST` | `/api/health/check` | admin | Probe all due providers immediately |
| `GET` | `/api/meta` | public | Version, port, host, uptime |
| `GET` | `/api/overview` | user | Providers, route, stats, events, settings, meta |
| `GET` | `/api/logs` | user | Paginated request logs |
| `GET` | `/api/logs/stats` | user | Totals, error rate, p50/p95, per provider |
| `GET` | `/api/logs/timeseries` | user | Minute buckets (`minutes`, `bucket`) |
| `GET` | `/api/logs/timeseries/daily` | user | Daily buckets (`days`) |
| `GET` | `/api/logs/timeseries/weekly` | user | Weekly buckets (`weeks`) |
| `GET` | `/api/logs/source-totals` | user | Request totals per provider |
| `GET` | `/api/keys` | admin | All API keys, no hashes |
| `POST` | `/api/keys` | admin | Create key (`name`, optional `user_id`, `scopes`) |
| `DELETE` | `/api/keys/:id` | admin | Revoke key |
| `GET` | `/api/keys/mine` | user | Current user's keys |
| `POST` | `/api/keys/mine` | user | Create key for current user |
| `DELETE` | `/api/keys/mine/:id` | user | Revoke own key |

### Provider payload

```json
{
  "id": "deepseek",
  "name": "DeepSeek Search",
  "type": "deepseek",
  "baseUrl": "https://api.deepseek.com",
  "apiKey": "sk-...",
  "priority": 10,
  "enabled": true,
  "config": { "needContent": true, "probeMode": "search" },
  "probeIntervalSeconds": null
}
```

Responses never include `apiKey`; they include `apiKeySet` and `apiKeyHint` (last four characters). `id` is immutable after creation. Duplicate explicit IDs return `400` with an `issues` array.

Firecrawl providers also include the latest credit snapshot from their health probe: `creditsRemaining`, `creditsPlan`, `creditsPeriodEnd`, and `creditsCheckedAt`. These are `null` until an `auto`/`credit` probe succeeds, and are cleared when a provider stops being Firecrawl or its API key is removed. `POST /api/providers/:id/test` includes the probe's `credits` object.

OpenCode providers include a `billing` snapshot: `balanceUsd`, `availableUsd`, `spendUsd`, `range`, `webSearchRequests`, `webSearchSpendUsd`, `billingMode`, `mode`, and `checkedAt`. Spend requires Usage read; the balance fields stay `null` when the key lacks Billing read. `POST /api/providers/:id/test` includes the probe's `billing` object. The dashboard surfaces only `webSearchSpendUsd` (the spend this service causes); `spendUsd` (the workspace total, including inference) remains in the payload for consumers that want it.

### Settings payload

Grouped:

```json
{
  "routing": { "failureThreshold": 3, "healthCheckIntervalSeconds": 300 },
  "logging": { "retentionDays": 90 },
  "rateLimit": { "enabled": true, "rpm": 60 }
}
```

Flat keys are also accepted:

```json
{ "routing.failureThreshold": 3 }
```

Unknown keys, out-of-range numbers, and wrong types return `400` with `issues`. Enabling auth via this endpoint when no users exist returns `409` with `needsSetup: true`; use `POST /api/auth/enable` with credentials or `POST /api/auth/setup`.

### Logs

`GET /api/logs` query parameters:

| Parameter | Meaning |
|---|---|
| `limit` | 1–500, default 50 |
| `offset` | ≥ 0 |
| `provider_id` | Provider ID |
| `key_id` | Router API key ID |
| `operation` | `search`, `scrape`, `crawl`, `map`, `extract`, `batch_scrape`, `proxy` |
| `status` | Numeric status, or `error` for null/≥400/error rows |
| `search` | Substring match in path/body/response/error |
| `from`, `to` | `YYYY-MM-DD HH:MM:SS` UTC |

Time-series endpoints cap total buckets at 300. `GET /api/logs/timeseries?minutes=1440&bucket=1` returns `400`; use a larger bucket.

## Gotchas & invariants

- **A supplied but invalid router key gets `401` even when auth is disabled.** Anonymous traffic is allowed only when no key is supplied.
- **`Authorization` is never forwarded upstream.** Firecrawl adapters strip `authorization`, `x-api-key`, `cookie`, and hop-by-hop headers, then inject the provider key.
- **`/v1/search` and `/v2/search` are not shape-compatible.** Non-Firecrawl providers are normalized per route; `/api/search` is always v2.
- **`/api/search` with Firecrawl returns Firecrawl’s v2 response, not the unified `router` metadata envelope.** The bridge calls `/v2/search` and returns the upstream body.
- **Management mutations are admin-only when auth is enabled.** Regular users can read providers, settings, logs, and overview, and manage their own keys.
- **Provider deletion leaves request logs.** Logs keep the provider ID after the provider is gone; stats may show IDs with no provider row.
- **Rate limiting happens before routing.** A `429` never reaches an upstream provider. Anonymous callers are keyed by client IP (`ip:<address>`).
- **Request bodies are capped at 25 MB.** The cap is checked from `content-length` and again after buffering.
- **`/api/auth/login` is not rate-limited.** Put a reverse proxy in front of public deployments.
- **CORS is not enabled.** The dashboard is same-origin; browser clients on another origin need a proxy or a CORS layer.
- **`/api/settings/reset` disables auth.** If you reset while relying on auth, re-enable it before leaving.
- **`/api/keys` returns the plaintext key only in the creation response.** No endpoint can retrieve it later.
- **Keys can be created while authentication is off.** They are owned by a hidden `system` user that is excluded from `/api/users` and `hasUsers`. The owner keeps the key valid when authentication is enabled later; it cannot log in.

## Related docs

- [`architecture.md`](architecture.md) — routing and health internals.
- [`providers.md`](providers.md) — provider config and adapter behavior.
- [`testing.md`](testing.md) — API integration tests.
- [`../README.md`](../README.md) — quick start and first search.
