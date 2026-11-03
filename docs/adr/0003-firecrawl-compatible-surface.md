# ADR 0003 — Firecrawl-compatible proxy with normalized non-Firecrawl search

- **Status:** Accepted
- **Date:** 2026-11-03
- **Related:** [0001](./0001-priority-health-routing.md), [0002](./0002-database-config-and-secrets.md)

## Context

The previous router was a transparent Firecrawl reverse proxy: every endpoint was assumed to expose `/v1/*` and `/v2/*`, accept `Authorization: Bearer`, and return Firecrawl-shaped bodies. Supporting DeepSeek and generic search APIs requires different request/response shapes while preserving the existing client contract. Firecrawl v1 and v2 also differ: v1 search returns `data: []`, v2 returns `data.web[]`.

## Decision

**Pass Firecrawl paths through unchanged; normalize non-Firecrawl search into the version of the incoming path; expose `/api/search` as a v2-shaped unified endpoint.**

Implementation rules:

- `firecrawl` adapters passthrough `/v1/*` and `/v2/*` with native status, body, and content type. Unknown paths are `proxy` capability.
- Other adapters support `search` only. The router builds a provider-specific search request from `{query, limit, ...extra}` and receives a `SearchResponse`.
- `buildFirecrawlSearchResponse()` serializes the normalized result set as:
  - v1: `{ success, id, data: [...] }`
  - v2: `{ success, id, data: { web: [...] }, creditsUsed }`
- `/api/search` always uses the v2 shape and adds a top-level `router` object with provider, attempts, latency, and request ID.
- Candidate filtering happens before health: a provider that does not support the operation is never called and cannot be marked unhealthy by an unsupported request.
- If no enabled provider supports the operation, return `501` with a clear message.

## Consequences

- Existing Firecrawl clients keep their native `v1`/`v2` response shapes, including `creditsUsed` and `id`.
- DeepSeek/generic results are usable by Firecrawl-shaped clients without client-side translation.
- `/api/search` callers get a consistent v2 envelope and routing metadata; Firecrawl callers on that route receive Firecrawl’s native v2 body because the bridge passes it through.
- A provider’s capability list is authoritative: search-only providers never receive scrape/crawl requests.
- New provider types must implement an adapter and declare capabilities; adding a type does not require changes to the routing engine or the public route table.
