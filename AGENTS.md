# Agent Routing Map

Web Search Router is a Bun/Elysia + React + SQLite service. Read the owner doc before changing a subsystem.

## Task routing

| If the task is… | Read first | Then |
|---|---|---|
| Add/change a provider adapter | [`docs/providers.md`](docs/providers.md) | `src/providers/types.ts`, `src/providers/registry.ts`, `tests/integration/adapters.test.ts` |
| Change priority, failover, health, or recovery | [`docs/architecture.md`](docs/architecture.md), [ADR 0001](docs/adr/0001-priority-health-routing.md) | `src/router.ts`, `src/health.ts`, `src/providers/store.ts`, `tests/integration/routing.test.ts` |
| Change proxy/search routes or response shape | [`docs/api.md`](docs/api.md), [ADR 0003](docs/adr/0003-firecrawl-compatible-surface.md) | `src/app.ts`, `src/router.ts`, `src/providers/search.ts` |
| Change settings, secrets, or first-run config | [`docs/architecture.md`](docs/architecture.md), [ADR 0002](docs/adr/0002-database-config-and-secrets.md) | `src/settings.ts`, `src/crypto.ts`, `src/db.ts` |
| Change the dashboard | [`docs/ui.md`](docs/ui.md), [`docs/design.md`](docs/design.md) | `src/client/`, `tests/e2e/dashboard.spec.ts` |
| Change auth, users, or API keys | [`docs/api.md`](docs/api.md#authentication) | `src/auth.ts`, `src/apikeys.ts`, `src/app.ts` |
| Change logs or observability | [`docs/architecture.md`](docs/architecture.md#logging) | `src/logger.ts`, `src/client/pages/Logs.tsx` |
| Upgrade an old deployment | [`docs/migration.md`](docs/migration.md) | `src/db.ts`, `src/migration.ts` |
| Add or debug tests | [`docs/testing.md`](docs/testing.md) | `tests/helpers/`, `tests/unit/`, `tests/integration/`, `tests/e2e/` |

## Gates

```bash
bun run typecheck
bun test tests/unit tests/integration
bun run test:e2e
```

Run all three before reporting a code change. E2E uses fixed ports `4310` and `4311`.

## Conventions

- No `.env`. Configuration is SQLite + dashboard. Host/port are CLI flags.
- Provider keys are encrypted with `data/master.key`; never log or return plaintext keys.
- Higher `priority` wins. Manual disable is permanent; health auto-disable is recoverable.
- Firecrawl `/v1/*` and `/v2/*` responses are passthrough; non-Firecrawl search is normalized per version.
- Tests use isolated temp directories; never write to repository `data/`.
- Docs live in `docs/`; update the owner doc and [`docs/README.md`](docs/README.md) with behavior changes.

## Canonical facts

| Fact | Owner |
|---|---|
| CLI flags, install, provider matrix | [`README.md`](README.md) |
| Routing/health state machine | [`docs/architecture.md`](docs/architecture.md) |
| Provider types/config/probes | [`docs/providers.md`](docs/providers.md) |
| HTTP routes/auth/errors | [`docs/api.md`](docs/api.md) |
| Dashboard structure/tokens | [`docs/ui.md`](docs/ui.md), [`docs/design.md`](docs/design.md) |
| Test commands/isolation | [`docs/testing.md`](docs/testing.md) |
| Legacy migration | [`docs/migration.md`](docs/migration.md) |
