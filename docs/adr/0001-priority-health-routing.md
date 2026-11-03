# ADR 0001 — Priority routing with automatic health recovery

- **Status:** Accepted
- **Date:** 2026-11-03
- **Related:** [0002](./0002-database-config-and-secrets.md), [0003](./0003-firecrawl-compatible-surface.md)

## Context

The previous router treated an endpoint as permanently quarantined after repeated probe failures, skipped offline endpoints during failover, only probed one endpoint per interval, and counted every upstream `4xx` as an endpoint failure. A bad client request could take every provider offline, and a provider that recovered could stay quarantined indefinitely. Manual “set online” also left failure counters and cooldowns intact.

## Decision

**Route by strict priority, auto-disable on provider-caused failures, probe on a schedule, and re-enable on success. Keep manual disable separate.**

Implementation rules:

- Higher `priority` is tried first.
- Primary candidates are enabled providers whose health is `healthy` or `unknown` and whose adapter supports the operation.
- Auto-disabled providers (`health = unhealthy`) are excluded from the primary phase but can be retried as `lastResort` when `routing.lastResortEnabled` is true.
- Manually disabled providers (`enabled = false`) are excluded from every phase and are never probed.
- `ProviderStore.recordFailure()` increments a counter only for `network`, `timeout`, `auth`, `quota`, `rate_limit`, `server`, and `invalid_response`. Client `4xx` errors do not count; `404`/`405` fail over but do not count.
- `routing.failureThreshold` consecutive failures marks a provider `unhealthy`.
- `HealthService` probes unhealthy/unknown providers every `routing.healthCheckIntervalSeconds` (per-provider override allowed). A successful probe marks it healthy when `routing.autoRecoverEnabled` is true.
- Manual tests use `forceRecover` so a successful test repairs health even if automatic recovery is off, but never re-enables `enabled = false`.
- `routing.requestTimeoutMs` bounds each attempt; `routing.totalTimeoutMs` bounds the whole failover chain.
- Every request writes one log row with the attempt chain.

## Consequences

- A provider with exhausted credits is auto-disabled, probed, and re-enabled when credits return; no manual unquarantine step.
- A malformed client request no longer disables providers.
- A provider that recovers only after a manual test can rejoin the primary lane, but operators can still keep it off with manual disable.
- Last-resort requests are real provider calls; a successful one calls `recordSuccess()` and promotes the provider back to healthy.
- The old permanent-quarantine and exponential-probe-backoff settings are intentionally removed.
- Operators must understand that higher numbers win; the UI labels this explicitly.
