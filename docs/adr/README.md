# ADR Index

Architecture decisions for Web Search Router. ADRs are immutable; supersede one with a new number rather than editing history.

| ADR | Status | Date | Decision |
|---|---|---|---|
| [0001](0001-priority-health-routing.md) | Accepted | 2026-11-03 | Priority routing with auto-disable, scheduled probes, and last-resort fallback |
| [0002](0002-database-config-and-secrets.md) | Accepted | 2026-11-03 | SQLite configuration, no `.env`, encrypted provider secrets |
| [0003](0003-firecrawl-compatible-surface.md) | Accepted | 2026-11-03 | Firecrawl passthrough plus normalized non-Firecrawl search |

## Related docs

- [`../README.md`](../README.md) — documentation index.
- [`../architecture.md`](../architecture.md) — current routing behavior.
- [`../providers.md`](../providers.md) — adapter contract.
