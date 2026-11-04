# Testing — Unit, Integration, and Browser E2E

## Overview

The test strategy has three layers:

1. **Unit** — pure logic and services: settings validation, secret encryption, routing selection, auth, key hashing, logger redaction, and timeseries bounds.
2. **Integration** — the real Elysia app against real SQLite and a local mock upstream, covering routing, failover, recovery, adapters, auth enforcement, rate limiting, migration, and management APIs.
3. **Browser E2E** — Playwright against a built dashboard and a seeded server, covering provider CRUD, policy persistence, reorder, logs, command palette, mobile overflow and drawer focus behavior, and the auth enable/login/disable flow including the disable confirmation.

Every layer uses an isolated data directory. No test reads or writes `data/` in the repository.

## Key files

| File | Purpose |
|---|---|
| `tests/helpers/runtime.ts` | `createTestContext()`: temp dir, runtime, app, cleanup; `request()`, `json()`, `cookieFrom()`. |
| `tests/helpers/upstream.ts` | `startMockUpstream(port?)`: Bun server returning Firecrawl v1/v2, DeepSeek, generic, health, and usage shapes; mutable failure modes. |
| `tests/unit/*.test.ts` | Crypto, settings, router selection, keys, auth, logger. |
| `tests/integration/routing.test.ts` | Priority, failover, auto-disable, recovery, last resort, manual disable, client errors, quota. |
| `tests/integration/adapters.test.ts` | Firecrawl v1/v2, DeepSeek, generic GET/POST, Tavily preset, unsupported operation, invalid JSON. |
| `tests/integration/auth-api.test.ts` | Auth disabled/open, auth enable, key requirement, scopes, revoke, login/logout, non-admin restrictions, setup guard. |
| `tests/integration/providers-api.test.ts` | Provider CRUD, secret masking/clearing, validation, duplicate IDs, reorder, test, delete, metadata. |
| `tests/integration/settings-logs-api.test.ts` | Settings validation/persistence/reset, log capture/redaction, filters, pagination bounds, timeseries cap, health endpoint. |
| `tests/integration/health.test.ts` | Probe failure/recovery, Firecrawl credit exhaustion and refresh, no re-probe of healthy providers, manual test on disabled provider, DeepSeek probe. |
| `tests/integration/ratelimit.test.ts` | Per-key sliding window, headers, reset, disabled behavior. |
| `tests/integration/migration.test.ts` | Legacy `endpoints.json`/`settings.json`, encrypted keys, old `proxy.db` copy, legacy `fr_` key. |
| `tests/e2e/server.ts` | Builds `.e2e-data`, seeds three providers, starts mock on 4311 and app on 4310. |
| `tests/e2e/dashboard.spec.ts` | Serial Playwright suite for the dashboard. |
| `playwright.config.ts` | Chrome channel, desktop viewport, single worker, webServer command. |

## How it works

### Commands

```bash
bun run typecheck                 # tsc --noEmit
bun test tests/unit tests/integration
bun run test:e2e                 # playwright test
bun run test:all                 # bun test + playwright
```

CI runs [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) on pushes to `main` and pull requests: typecheck, unit/integration, build, and a separate Playwright E2E job. Bumping `version` in `package.json` on `main` runs [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml), which repeats the cheap gates, tags `v<version>`, publishes a multi-arch image to GHCR, and creates the GitHub release — each step skipped when it already exists.

The E2E webServer command is:

```text
bun run build && bun run tests/e2e/server.ts
```

Playwright waits for `http://127.0.0.1:4310/_router/health`. The server seeds:

| ID | Type | Priority | State |
|---|---|---|---|
| `primary` | Firecrawl | 100 | healthy after startup probe |
| `secondary` | Firecrawl | 50 | healthy after startup probe |
| `disabled-fallback` | Generic | 10 | manually disabled |

The mock upstream on `127.0.0.1:4311` returns Firecrawl v1/v2, DeepSeek, generic, readiness, and usage responses. Integration tests use the same helper on a random port.

### Isolation

`createTestContext()`:

```ts
const dir = mkdtempSync(join(tmpdir(), "wsr-test-"));
const config = createRuntimeConfig({ dataDir: dir, port: 0 });
const runtime = await createRuntime(config);
const app = createApp(runtime);
return { dir, runtime, app, close };
```

- Each context gets its own `router.db`, `master.key`, and settings rows.
- `close()` stops background jobs, closes SQLite, and removes the temp directory.
- `createRuntime()` does not start the health scheduler; tests call `runtime.health.runDueChecks()` explicitly.
- Integration requests use `app.handle(new Request(...))`; no port binding and no shared server state.
- `tests/helpers/upstream.ts` tracks every request and exposes `setMode()`/`setHealthMode()` for failure injection.

### Failure modes in the mock

| Mode | Behavior |
|---|---|
| `ok` | Normal provider response |
| `fail400` | 400 client error |
| `fail401` | 401 auth error |
| `fail402` | 402 quota error |
| `fail429` | 429 with `retry-after: 30` |
| `fail500` | 500 server error |
| `timeout` | Waits 2 seconds; tests set a short request timeout |
| `invalid` | 200 with HTML, triggering `invalid_response` |

The mock credit endpoint returns `data.remainingCredits` from a mutable balance plus fixed plan and billing-period metadata. Integration tests call `upstream.setCredits(0)` to reproduce Firecrawl's real exhausted-credit behavior: HTTP 200 with a zero balance, which the credit probe must treat as a quota failure that disables the provider on the first probe even with the default `failureThreshold` of 3. Out-of-process E2E runs change the balance over HTTP with `POST http://127.0.0.1:4311/__mock/credits` and `{ "remaining": n }`; the spec sets it to zero, checks the probe dialog and the provider row, then restores `1000` and re-probes so later tests start healthy. The E2E seed gives both Firecrawl providers an API key and `auto` probe mode so the credit badge is exercised in the browser.

### E2E flow

Tests run serially with one worker because they share the seeded database. The last test enables authentication, signs out, signs in, and disables authentication again. If you add tests, keep state-changing auth tests at the end or reset `.e2e-data`.

Selectors rely on accessible names:

- Page headings are `h2`; use `getByRole("heading", { level: 2 })` to avoid the top-bar `h1`.
- Provider actions use `aria-label`: `Test <name>`, `Edit <name>`, `Disable <name>`, `Enable <name>`, `Delete <name>`.
- Switches use labels such as `Require authentication` and `Enabled in routing`.
- Dialogs use `getByRole("dialog")`; the header close and footer close can both be named “Close”, so use `.last()` when targeting the footer.
- Disabling authentication now opens a confirmation dialog; the test must click `Disable authentication` inside it.
- The mobile test asserts the closed rail is inert/`aria-hidden`, opening focuses the first nav item, and closing restores focus to the hamburger.

### Optional live smoke test

Automated tests never call a real provider. For a manual live check:

1. Add a Firecrawl provider in the UI with a real `fc-` key and `baseUrl: https://api.firecrawl.dev`.
2. Probe it once; a healthy result confirms `/v2/team/credit-usage` accepted the key.
3. Send a one-result search:

```bash
curl -D - -X POST http://localhost:8123/v2/search \
  -H 'content-type: application/json' \
  -d '{"query":"web search router smoke test","limit":1}'
```

4. Confirm `x-router-provider: <id>` and a real result body. This consumes Firecrawl credits.

Do not store a live key in the repository. Provider keys belong in the encrypted SQLite store.

### What is not covered

- Real provider outages, rate limits, or billing changes.
- CORS, reverse-proxy TLS termination, or login brute-force protection.
- Firecrawl crawl/extract/batch status polling beyond passthrough shape.
- DeepSeek live behavior; its adapter is tested against mock shapes from public docs.
- Load/concurrency testing of SQLite under sustained traffic.

## Gotchas & invariants

- **Run `bun test tests/unit tests/integration`, not bare `bun test`,** if you want to avoid Playwright `.spec.ts` files being picked up by Bun’s test discovery. The package script already scopes the paths.
- **No test writes to repository `data/`.** If you see `data/proxy.db` created during a test, a test is using the old singleton pattern; fix it to use `createTestContext()`.
- **E2E has fixed ports 4310/4311.** Stop any other server on those ports before `bun run test:e2e`.
- **E2E deletes `.e2e-data` on startup and shutdown.** Do not put manual data there.
- **The health scheduler is off in integration tests.** `HealthService.runDueChecks({ force: true })` is the deterministic trigger; do not wait on wall-clock intervals.
- **Time-sensitive tests set `failureThreshold: 1`.** The default of 3 means one failed probe leaves the provider `healthy` (or `unknown` before its first success), not `unhealthy`. Quota probe failures are the exception: they disable immediately, so a zero-credit test does not need a lower threshold.
- **The mock’s `timeout` mode waits 2 seconds.** Set `routing.requestTimeoutMs` below that in the test, or the test will be slow.
- **Playwright uses `channel: "chrome"`.** If Chrome is not installed, change `playwright.config.ts` to the bundled Chromium or add an `executablePath`.
- **The auth E2E test must stay last in the serial file.** It changes the global auth setting and the session state for the seeded server.
- **Live smoke tests cost credits.** Firecrawl and DeepSeek probes/search can bill the provider; the mock suite never does.
- **`master.key` is per temp context.** Copying a test database without its key will not decrypt provider keys; integration helpers always create both.

## Related docs

- [`architecture.md`](architecture.md) — routing and health behavior under test.
- [`providers.md`](providers.md) — adapter contracts and probe modes.
- [`api.md`](api.md) — management and proxy endpoints used by tests.
- [`migration.md`](migration.md) — legacy data migration cases.
