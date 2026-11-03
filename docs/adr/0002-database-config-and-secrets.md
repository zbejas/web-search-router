# ADR 0002 — SQLite configuration, no `.env`, encrypted provider secrets

- **Status:** Accepted
- **Date:** 2026-11-03
- **Related:** [0001](./0001-priority-health-routing.md), [0003](./0003-firecrawl-compatible-surface.md)

## Context

The previous service read settings from `data/settings.json`, seeded but ignored SQLite settings, accepted endpoint keys as plaintext in JSON, logged `authorization`/`cookie`/`x-api-key` headers, and documented an `.env` contract it did not actually enforce. There was no password-change endpoint and test runs could mutate production data.

## Decision

**Use SQLite as the single source of application configuration, remove `.env`, encrypt provider keys at rest, and redact secrets in logs.**

Implementation rules:

- `data/router.db` owns providers, settings, users, sessions, API keys, provider events, and request logs.
- `SettingsService` validates a typed schema; unknown keys, wrong types, and out-of-range numbers return `400` with `issues`. Grouped and flat patches are accepted.
- The only CLI/runtime inputs are `--port`, `--host`, and `--data-dir`. Host/port are deployment concerns; everything else is dashboard-editable.
- Provider keys are AES-256-GCM encrypted with `data/master.key`. The plaintext key exists in memory only during an operation or probe.
- The API never returns a provider key; it returns `apiKeySet` and `apiKeyHint`.
- Logs redact sensitive headers and JSON keys, truncate bodies, and store one row per routed request instead of one per attempt.
- First-run auth is disabled. Enabling auth requires an admin account; when enabled, dashboard APIs require a session and proxy traffic requires a router API key.
- Provider data, settings, and legacy keys are migrated from `proxy.db`, `endpoints.json`, and `settings.json` on first start.

## Consequences

- No deployment needs an `.env` file; Docker Compose uses a named data volume.
- Losing `master.key` makes existing provider keys unreadable. The data directory must be backed up as a unit.
- Operators can change policy, keys, rate limits, and auth entirely from the browser.
- Settings and provider changes are transactional SQLite writes, not JSON rewrites on every request.
- Existing plaintext endpoint keys are re-encrypted during migration.
- The dashboard exposes an “auth off” warning because the default is intentionally open on first run.
