# Migration — From `firecrawl_router`

## Overview

Web Search Router is a rename and behavior change of the old Firecrawl Router. The runtime migrates legacy data in place on first start: it copies `data/proxy.db` to `data/router.db` when needed, imports `data/endpoints.json` into the `providers` table, maps `data/settings.json` into the new settings schema, and keeps legacy `fr_` API keys working. The old files are renamed with a `.migrated` suffix after a successful import.

The migration is stateful and one-way in normal operation. Back up the entire data directory before starting the new version.

## Key files

| File | Purpose |
|---|---|
| `src/db.ts` | `openDatabase()` copies `proxy.db` → `router.db`; schema creation and in-place column migrations. |
| `src/migration.ts` | `migrateLegacyProviders()` imports `endpoints.json`; `migrateLegacySettings()` maps `settings.json`. |
| `src/crypto.ts` | Creates/reads `master.key`; encrypts imported provider keys. |
| `src/providers/store.ts` | New provider model and status mapping. |
| `src/apikeys.ts` | Accepts legacy `fr_` keys; issues `wsr_` keys. |
| `src/auth.ts` | Accepts the legacy `fc_session` cookie; issues `wsr_session`. |
| `tests/integration/migration.test.ts` | Covers legacy provider/settings import and old database copy. |

## How it works

### Startup sequence

```text
createRuntime()
  openDatabase(config)
    if router.db missing and proxy.db exists:
      copy proxy.db -> router.db
    create/migrate schema
  SecretBox.open(data/master.key)       // create if missing
  SettingsService(db)                   // defaults + persisted settings
  migrateLegacySettings(data/settings.json)
  ProviderStore(db, secretBox)
  migrateLegacyProviders(data/endpoints.json)
```

### `proxy.db`

- The old database is copied to `router.db` only when `router.db` does not exist.
- Existing `users`, `sessions`, `api_keys`, and `proxy_logs` rows are preserved.
- Providers with type `opencode` are preserved now that the adapter is supported again. Databases upgraded while the adapter was absent may have already lost those rows; they cannot be recovered.
- Migrations add `api_keys.scopes` (default `["*"]`), `providers.billing` (JSON monetary snapshot), and `proxy_logs` columns (`provider_id`, `provider_type`, `operation`, `attempts`, `request_id`, `query`, `error_kind`, `client_ip`).
- `proxy_logs.provider_id` is backfilled from `endpoint_id`; the old column remains for compatibility.
- Old logs use `YYYY-MM-DD HH:MM:SS` timestamps; new logs use the same SQLite format.

### `endpoints.json`

Imported only when the `providers` table is empty. Each old endpoint becomes a Firecrawl provider:

| Old field/status | New value |
|---|---|
| `id` | Slugified provider ID; name is the original ID |
| `url` | `baseUrl`, trailing slash removed |
| `apiKey` | Encrypted with `master.key`; hint is the last 4 characters |
| `priority` | Same number; higher still wins |
| `online` | `health = healthy`, `enabled = true` |
| `offline` | `health = unhealthy`, `enabled = true` |
| `quarantined` | `health = unhealthy`, `enabled = true` (auto-recovery is now allowed) |
| `unknown` | `health = unknown`, `enabled = true` |
| `lastCheck` | `last_checked_at` |
| `consecutiveFailures` | `consecutive_failures` |

After a successful import, `endpoints.json` is renamed to `endpoints.json.migrated`. Old `lastFailTime`/`retryAfterSeconds` are not carried into the new state machine; the new probe policy decides recovery. Old `MAX_PROBE_FAILURES` and probe-backoff settings are ignored because the permanent quarantine model was removed.

### `settings.json`

Mapped once:

| Old key | New key |
|---|---|
| `MAX_CONSECUTIVE_FAILURES` | `routing.failureThreshold` |
| `PROXY_TIMEOUT_MS` | `routing.requestTimeoutMs` |
| `PROBE_INTERVAL` | `routing.healthCheckIntervalSeconds` |
| `LOG_RETENTION_DAYS` | `logging.retentionDays` |
| `AUTH_ENABLED` | `auth.enabled` |
| `RATE_LIMIT_ENABLED` | `rateLimit.enabled` |
| `RATE_LIMIT_RPM` | `rateLimit.rpm` |

Unknown legacy keys are ignored. After a successful import, `settings.json` is renamed to `settings.json.migrated`.

### Keys and sessions

- New router keys use `wsr_` plus 48 hex characters.
- Existing `fr_` keys remain valid because validation checks both prefixes and hashes the full key.
- Existing API key rows get `scopes = ["*"]`.
- Old `fc_session` cookies are accepted; new logins set `wsr_session`.

### `.env` removal

The old project used `.env` for `PORT`, `FIRECRAWL_API_KEY`, and `MAX_CONSECUTIVE_FAILURES`. The new service reads none of these:

- Port and host are CLI flags: `--port`, `--host`.
- Provider keys are entered in the dashboard and stored encrypted.
- Failure threshold and all other policy live in Settings.

If you have a Firecrawl key in the old `.env`, add it to the Firecrawl provider in the UI (or via `POST /api/providers`) and delete `.env`. The old file is not read.

### Docker volume

The old compose file bind-mounted `./data` into `/app/data`. The new compose file uses the named volume `web-search-router-data`. If you are upgrading an existing Docker deployment:

- Either keep the old bind mount by editing `docker-compose.yml`:

  ```yaml
  volumes:
    - ./data:/app/data
  ```

- Or copy the old data into the named volume before starting:

  ```bash
  docker run --rm -v web-search-router-data:/data -v "$PWD/data":/old alpine \
    sh -c 'cp -a /old/. /data/'
  ```

The volume name depends on the Compose project name. Run `docker volume ls` if it differs.

## Gotchas & invariants

- **Back up `master.key` with the database.** Imported endpoint keys are encrypted on first start. A deleted `master.key` makes them unreadable; the provider rows remain but requests go out with no auth.
- **Migration runs only when the destination is empty.** `endpoints.json` is ignored if `providers` already has rows; `settings.json` is applied as an update even if settings exist. Do not rerun an old import against a populated database.
- **`proxy.db` is copied, not moved.** The old file stays in place. Only `endpoints.json` and `settings.json` are renamed after import.
- **Quarantined endpoints come back as enabled/unhealthy.** The old permanent-quarantine model is gone. A quarantined provider is probed and can recover automatically. If you want it off, disable it manually after migration.
- **Old retry/backoff settings do not carry over.** `RETRY_AFTER_SECONDS`, `MAX_PROBE_FAILURES`, `MAX_PROBE_BACKOFF_SECONDS`, and `QUARANTINE_RETRY_SECONDS` are not part of the new schema.
- **OpenCode providers are supported again.** Startup no longer deletes them. If a database was upgraded while the adapter was absent, those rows are gone and must be re-added.
- **Old `fr_` keys still work but new keys are `wsr_`.** Rotate keys at your own pace; revoking an old key immediately stops it.
- **Old `fc_session` cookies are accepted but not refreshed.** New logins set `wsr_session`; clear old cookies if you see session confusion.
- **The old `.env` is not read.** Copying `.env` into the new deployment does nothing.
- **Docker bind mount vs named volume is a real upgrade trap.** The new compose does not read `./data` unless you change the volume mapping.
- **Rollback requires restoring the old files and removing `router.db`.** Stop the service, restore `proxy.db`/`endpoints.json`/`settings.json`, delete `router.db`, `router.db-wal`, and `router.db-shm`, then start the old version. Changes made after migration are lost.

## Related docs

- [`architecture.md`](architecture.md) — new state machine and persistence.
- [`providers.md`](providers.md) — provider config after migration.
- [`testing.md`](testing.md) — migration test coverage.
- [`../README.md`](../README.md#data-migration) — quick migration summary.
