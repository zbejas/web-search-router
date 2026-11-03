# Routing and Health — Architecture

## Overview

Web Search Router is a Bun/Elysia service that fronts multiple web search providers. It exposes Firecrawl-compatible `/v1/*` and `/v2/*` paths plus a unified `/api/search` endpoint, selects a provider by priority and health, fails over on provider-caused errors, and keeps a SQLite record of every attempt. A browser dashboard edits the same state the router reads on the next request.

The router is deliberately state-based, not connection-based: provider health, priorities, configuration, auth, and policy all live in SQLite. The only in-memory state is the rate-limit window and the probe scheduler's in-flight guard.

## Key files

| File | Purpose |
|---|---|
| `src/index.tsx` | CLI entry; parses `--port`, `--host`, `--data-dir`; starts the app and background jobs; handles shutdown. |
| `src/app.ts` | `createRuntime()` and `createApp()`; HTTP routes, auth middleware, proxy handler, management API, static assets. |
| `src/config.ts` | CLI parsing, runtime paths, version, data-directory creation. |
| `src/db.ts` | SQLite schema creation, in-place migrations, legacy `proxy.db` copy. |
| `src/types.ts` | Shared provider, routing, log, settings, auth, and adapter result types. |
| `src/settings.ts` | Typed settings schema, defaults, validation, grouped/flat patch handling, persistence. |
| `src/crypto.ts` | `SecretBox` AES-256-GCM encryption and key hints. |
| `src/migration.ts` | Imports legacy `endpoints.json` and `settings.json`; renames migrated files. |
| `src/router.ts` | Operation detection, candidate ordering, adapter execution, failover, response materialization, request logging. |
| `src/health.ts` | Probe scheduling, due-provider selection, bounded concurrency, manual tests, recovery transitions. |
| `src/logger.ts` | Redacted request/response logging, query filters, stats, time series, retention cleanup. |
| `src/auth.ts` | Users, sessions, login/logout, password changes, setup, cookie handling. |
| `src/apikeys.ts` | Router API key generation, SHA-512 hashing, scope validation, revocation. |
| `src/ratelimit.ts` | In-memory sliding-window limiter keyed by API key or client IP. |
| `src/providers/registry.ts` | Adapter map and metadata used by the UI/API. |
| `src/providers/store.ts` | Provider CRUD, secret encryption/decryption, health transitions, event history, request stats. |
| `src/providers/types.ts` | `ProviderAdapter` contract and adapter metadata/result types. |
| `src/providers/shared.ts` | Shared adapter helpers: search parsing, status classification, timed fetch, hints. |
| `src/providers/firecrawl.ts` | Firecrawl passthrough, `/api/search` bridge, readiness/credit probes. |
| `src/providers/deepseek.ts` | DeepSeek `POST /v1/tools/search` adapter. |
| `src/providers/generic.ts` | Configurable REST search adapter with presets and probe config. |
| `src/providers/search.ts` | Firecrawl v1/v2 search response normalization. |

## How it works

### Startup

```text
src/index.tsx
  parseArgs()
  createRuntimeConfig()
  createRuntime():
    openDatabase()          -> copy proxy.db to router.db if needed, migrate schema
    SecretBox.open()        -> read or create data/master.key (0600)
    SettingsService()       -> seed defaults, load persisted settings
    migrateLegacySettings()
    ProviderStore()
    migrateLegacyProviders()
    Logger / AuthService / KeyService / RateLimitService
    RouterService / HealthService
  createApp(runtime)
  app.listen()
  startBackgroundJobs()     -> health.start(), hourly log cleanup
```

`createRuntime()` is exported so tests can construct an isolated runtime against a temp directory. `createApp()` is separate so tests can use `app.handle(new Request(...))` without binding a port.

### Request flow

```text
client
  -> Elysia route (/v1/*, /v2/*, /api/search, /search)
  -> derive auth state from cookie(s)
  -> handleProxy():
       parse router API key (Authorization Bearer wsr_/fr_ or x-api-key)
       validate key + operation scope
       require key when auth.enabled
       rate-limit by key or client IP
       enforce 25 MB request body cap
       buffer body once
  -> RouterService.route():
       detectOperation(path)
       load providers, decrypt keys
       orderCandidates(): enabled + capability + priority
       primary phase: health !== unhealthy
       last-resort phase: health === unhealthy (if enabled)
       adapter.execute() with remaining total budget
       success -> recordSuccess(), materialize response
       failure -> recordFailure() when provider-caused, continue or stop
  -> finalize(): buffer response, add x-router-* headers, write one log row
  -> client
```

`detectOperation()` maps `/v1/search`, `/v2/search`, `/v1/scrape`, `/v2/crawl/:id`, `/v2/batch/scrape`, and `/search`/`/api/search` to capabilities. Unknown `/v1/*` and `/v2/*` paths become `proxy`, which only Firecrawl supports.

### Candidate ordering

`orderCandidates(providers, operation)` returns:

| Bucket | Rule | Order |
|---|---|---|
| `primary` | `enabled`, adapter supports operation, health is `healthy` or `unknown` | priority desc, then name |
| `lastResort` | `enabled`, adapter supports operation, health is `unhealthy` | priority desc, then name |
| `supporting` | both buckets combined | priority desc |

Manually disabled providers (`enabled = false`) never enter either bucket. `priority` is higher-wins: `100` is tried before `10`.

### Failure classification

Adapters return a `failureKind`; the router decides whether to count it against the provider and whether to continue.

| Kind | Typical status | Counts against provider | Continues to next provider |
|---|---|---|---|
| `network` | none | yes | yes |
| `timeout` | 408 / abort | yes | yes |
| `auth` | 401, 403 | yes | yes |
| `quota` | 402 | yes | yes |
| `rate_limit` | 429 | yes | yes |
| `server` | 5xx | yes | yes |
| `invalid_response` | 2xx with unusable body | yes | yes |
| `client` | 400, 404, 405, 422 | no | 404/405 yes; other 4xx stops |
| `unsupported` | adapter mismatch | no | no |

A client error is returned to the caller unchanged when it stops the chain. If every provider fails and the last failure is a client error, that upstream response is returned; otherwise the router returns a `502` with `error: "All providers failed"` and the attempt list.

### Health state machine

```text
unknown --success--> healthy
healthy --failureThreshold consecutive failures--> unhealthy
unhealthy --successful probe (autoRecoverEnabled)--> healthy
unhealthy --successful manual test (forceRecover)--> healthy
enabled --operator disable--> disabled (enabled = false)
disabled --operator enable--> enabled, health = unknown
```

- `ProviderStore.recordSuccess()` resets `consecutiveFailures`, sets `health = healthy`, and records `lastHealthyAt`.
- `ProviderStore.recordFailure()` increments the counter and marks `unhealthy` when it reaches `failureThreshold`.
- `ProviderStore.recordProbe()` updates `lastCheckedAt`, `lastError`, `lastStatusCode`, `lastLatencyMs`, and any Firecrawl credit snapshot (`creditsRemaining`, `creditsPlan`, `creditsPeriodEnd`, `creditsCheckedAt`); success recovers when `autoRecoverEnabled` or `forceRecover` is true.
- Provider events (`auto_disabled`, `auto_enabled`, `test_ok`, `test_failed`, `manual_disabled`, `manual_enabled`, `created`, `updated`, `migrated`) are written to `provider_events`.
- `HealthService.runDueChecks()` probes enabled providers that are unhealthy/unknown, or all enabled providers when `probeHealthy` is true, and when the per-provider interval has elapsed. Healthy Firecrawl providers with an API key in `auto`/`credit` mode are also probed when due so their credit snapshot stays current. It runs four probes concurrently.
- The scheduler ticks every second and reads the current settings, so changing `healthCheckIntervalSeconds` takes effect without a restart.

### Persistence

`data/router.db` is SQLite in WAL mode. Tables:

| Table | Contents |
|---|---|
| `providers` | Provider config, encrypted key, priority, enabled flag, health state, failure counters, last check metadata, Firecrawl credit snapshot |
| `provider_events` | State transitions and manual tests |
| `settings` | Flat key/value settings (`routing.failureThreshold`, etc.) |
| `users` | Dashboard users, bcrypt hashes, and a hidden `system` API-key owner |
| `sessions` | Session tokens with expiry |
| `api_keys` | SHA-512 key hashes, prefix, scopes, revocation |
| `proxy_logs` | One row per routed request, including `attempts` JSON and redacted bodies |
| `meta` | Schema version |

Provider API keys are encrypted with AES-256-GCM using `data/master.key`. The plaintext key is only held in memory during a provider operation or probe. Losing `master.key` makes existing provider keys unreadable; the provider rows remain but requests will go out without auth.

### Logging

`Logger.log()` receives the final response body, redacts `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-subscription-token`, and `proxy-authorization`, redacts JSON keys matching `api_key`, `authorization`, `cookie`, `password`, `secret`, or `token`, and truncates bodies to `logging.maxBodyChars`. Timestamps are stored as `YYYY-MM-DD HH:MM:SS` UTC for SQLite comparisons.

`Logger.query()` clamps `limit` to 1–500 and `offset` to ≥ 0. The `GET /api/logs/timeseries` route rejects windows that would produce more than 300 buckets.

## Gotchas & invariants

- **Priority is higher-wins.** A provider with `priority: 100` is tried before one with `priority: 50`. The UI labels this as “higher wins”.
- **Manual disable is sticky.** `enabled = false` excludes a provider from primary and last-resort phases; probes do not touch disabled providers. Use enable to bring it back as `unknown`.
- **A successful last-resort request can recover a provider.** `recordSuccess()` is called on any successful request, including last-resort attempts, so the provider becomes healthy and rejoins the primary lane.
- **Firecrawl v1 and v2 search are different shapes.** `/v1/search` returns `data: []`; `/v2/search` returns `data.web[]`. Non-Firecrawl providers are normalized into the version of the incoming path. `/api/search` always uses the v2 shape.
- **Firecrawl passthrough preserves the upstream response.** `/v1/*` and `/v2/*` Firecrawl requests are not re-serialized; the router only adds headers and logs the body.
- **Client 4xx errors do not disable providers.** A `400`/`422` stops the chain and is returned to the caller. `404`/`405` are still failover candidates because they often indicate a wrong base URL.
- **Timeouts are two-layered.** `routing.requestTimeoutMs` is per attempt; `routing.totalTimeoutMs` is the budget for all attempts. Each adapter receives `min(requestTimeoutMs, remaining total budget)`.
- **Probes are provider-specific and may cost money.** Firecrawl uses the free readiness endpoint, plus credit usage when a key is configured; a zero or negative credit balance is a `quota` probe failure, so credit-exhausted providers do not auto-recover before their balance returns. Healthy Firecrawl providers with a key in `auto`/`credit` mode are still probed each interval so the displayed credit snapshot stays current. DeepSeek probes issue a one-result search. Generic probes use the configured probe request or a one-result search.
- **Health state is not scoped to a capability.** A provider that supports search only is never asked to scrape; capability filtering happens before health is consulted.
- **Settings patches validate every key.** Unknown keys, out-of-range numbers, and wrong types return `400` with an `issues` array. There is no silent partial apply.
- **`master.key` is the recovery boundary.** Back up the entire data directory. Copying `router.db` without `master.key` does not preserve usable provider credentials.
- **`dist/` must be built before serving.** `createApp()` serves `/` from `dist/index.html` and assets from `dist/assets`; a missing build returns a “Build missing” page, not a crash.
- **Static asset names are sanitized with `basename()`.** Do not replace this with raw path concatenation.
- **Login rate limiting is not implemented.** The rate limiter applies to proxied requests, not `/api/auth/login`. Put a reverse proxy in front of a public deployment if login brute force is a concern.

## Related docs

- [`providers.md`](providers.md) — adapter contract and provider config.
- [`api.md`](api.md) — request/response shapes and auth rules.
- [`testing.md`](testing.md) — how routing and health are verified.
- [`migration.md`](migration.md) — legacy data and key migration.
- [`design.md`](design.md) — dashboard visual system.
