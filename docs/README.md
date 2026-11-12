# Web Search Router — Knowledge Base

Engineering documentation for the self-hosted web search routing service. The docs are organized by subsystem: product intent, routing and health, providers, HTTP API, dashboard, testing, and migration. Product truth lives in [`product.md`](product.md); visual decisions live in [`design.md`](design.md).

> **How to use this:** start at [`../README.md`](../README.md) for the front door or [`../AGENTS.md`](../AGENTS.md) for task routing. This index maps every engineering doc.

## Layout

| Folder | Covers |
|---|---|
| [`adr/`](adr/README.md) | Durable architecture decisions |
| [`screenshots/`](screenshots/) | Rendered dashboard evidence with [provenance](screenshots/README.md) (not a design source of truth) |

## Docs

| Doc | Covers | Read when… |
|---|---|---|
| [`product.md`](product.md) | Users, purpose, constraints, product principles | You are changing scope or user-facing behavior |
| [`design.md`](design.md) | Visual system, components, responsive rules | You are changing the dashboard |
| [`architecture.md`](architecture.md) | Runtime construction, routing engine, health state machine, persistence, logging | You are changing request flow, provider selection, or health behavior |
| [`providers.md`](providers.md) | Provider model, adapter registry, Firecrawl/DeepSeek/OpenCode/generic config, probe modes, adding an adapter | You are adding or debugging a provider type |
| [`api.md`](api.md) | Proxy routes, unified search, management endpoints, auth, errors, headers, scopes | You are integrating a client or changing an endpoint |
| [`ui.md`](ui.md) | React dashboard structure, pages, data flow, design tokens, responsive behavior | You are changing the dashboard |
| [`testing.md`](testing.md) | Unit, integration, browser E2E, isolation, mock upstream, live smoke tests | You are adding tests or debugging CI |
| [`migration.md`](migration.md) | Upgrade path from `firecrawl_router`, legacy files, key prefixes, master key | You are moving an existing deployment |

## ADRs

| ADR | Decision |
|---|---|
| [`0001-priority-health-routing.md`](adr/0001-priority-health-routing.md) | Priority routing with auto-disable, scheduled probes, last-resort fallback |
| [`0002-database-config-and-secrets.md`](adr/0002-database-config-and-secrets.md) | SQLite configuration, no `.env`, encrypted provider secrets |
| [`0003-firecrawl-compatible-surface.md`](adr/0003-firecrawl-compatible-surface.md) | Preserve Firecrawl v1/v2 shapes while normalizing non-Firecrawl search |

## Reading paths

| If you are… | Read in order |
|---|---|
| New to the project | [`../README.md`](../README.md) → [`architecture.md`](architecture.md) → [`providers.md`](providers.md) |
| Integrating a client | [`api.md`](api.md) → [`../README.md`](../README.md#first-search) |
| Adding a provider type | [`providers.md`](providers.md) → [`architecture.md`](architecture.md) → [`testing.md`](testing.md) |
| Debugging failover | [`architecture.md`](architecture.md#request-flow) → [`architecture.md`](architecture.md#gotchas--invariants) → [`testing.md`](testing.md) |
| Upgrading a deployment | [`migration.md`](migration.md) → [`../README.md`](../README.md) |

## Writing docs

- Follow the five-section shape: Overview, Key files, How it works, Gotchas & invariants, Related docs.
- Verify against source; code wins over prose.
- State cross-cutting facts once. Ports and CLI flags live in [`../README.md`](../README.md#configuration); auth rules live in [`api.md`](api.md#authentication).
- Add a row here and in [`../AGENTS.md`](../AGENTS.md) when a doc changes task routing.

## Related docs

- [`../README.md`](../README.md) — install, first request, provider matrix.
- [`product.md`](product.md) — users, purpose, constraints, product principles.
- [`design.md`](design.md) — visual system and component language.
- [`../AGENTS.md`](../AGENTS.md) — agent task routing.
