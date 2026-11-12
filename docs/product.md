# Product

## Platform

web

## Users

Self-hosters and small teams who run a shared web-search gateway for their own tools and agents. The primary operator is comfortable with Docker, Bun, and API keys, but wants to manage providers, priorities, health, and access from a browser rather than editing files on a server. Secondary users are developers pointing Firecrawl-compatible clients at the router and automation that consumes the unified search endpoint.

## Product Purpose

Web Search Router sends search and Firecrawl-compatible requests to the highest-priority healthy provider, fails over when a provider breaks, automatically disables failed providers, probes them on a schedule, and re-enables them after a successful check. Success means a request is served by the right provider without operator intervention, and the operator can see exactly what happened.

## Positioning

A provider-agnostic routing layer with a Firecrawl-compatible surface, not a Firecrawl-only reverse proxy. It combines strict priority routing, an explicit health state machine with automatic recovery, capability-aware adapters, and a no-.env control plane in one small self-hosted service.

## Operating Context

Operators run the service with Bun or Docker Compose, open a browser dashboard, and configure providers, keys, rate limits, auth, and health policy there. Clients call `/v1/*` or `/v2/*` for Firecrawl compatibility or `/api/search` for a provider-neutral search response. Runtime state lives in SQLite under the data directory. The listening host and port are CLI flags; everything else is editable in the web UI.

## Capabilities and Constraints

- Provider adapters: Firecrawl Cloud and self-hosted, DeepSeek `POST /v1/tools/search`, OpenCode Console hosted web search, and a configurable generic REST adapter with a broad preset library: Tavily, Brave, SearXNG, Exa, Serper, DuckDuckGo, Google CSE, SerpAPI, SearchApi, ScrapingDog, ValueSERP, Zenserp, Kagi, You.com, NewsAPI, GNews, Hacker News, GitHub, Stack Exchange, Reddit, Crossref, Semantic Scholar, and Google Books.
- Firecrawl v1 and v2 response shapes are preserved for passthrough. Non-Firecrawl search results are normalized into the matching v1 or v2 shape.
- Higher priority numbers win. Manual disable is separate from automatic unhealthy state. Manually disabled providers are never routed to.
- Failed providers are auto-disabled after a configurable number of consecutive failures. Probes run on a configurable interval. Successful probes re-enable them. Healthy providers are not probed by default.
- If no healthy provider works, auto-disabled providers can be tried as a last resort; the operator can turn this off.
- Provider API keys are encrypted at rest and never returned by the API. Request logs redact credentials.
- Authentication is disabled on first run. Enabling it requires an admin account. Proxy traffic then requires a router API key.
- DeepSeek search is billed per successful request. Firecrawl health probes use the free readiness endpoint; credit checks validate the key, surface the remaining balance in the dashboard, and keep credit-exhausted providers out of rotation until the balance returns.
- The old project's data migrates in place: `proxy.db`, `endpoints.json`, and `settings.json` are imported, old `fr_` keys remain valid, and new keys use the `wsr_` prefix.
- There is no `.env` requirement. Configuration is stored in SQLite and edited in the dashboard.
- Runtime: Bun, Elysia, React, Vite, Tailwind, SQLite, Playwright for browser tests.

## Brand Commitments

Name: Web Search Router. Voice: precise, operational, calm, and honest about provider limitations. The interface should feel like a control room, not a marketing site. No invented provider benchmarks, customer claims, or availability guarantees.

## Evidence on Hand

No production screenshots, testimonials, or benchmarks are provided. Test and demo data is synthetic and must be labeled as such. Provider behavior is based on public documentation checked on 2026-11-03.

## Product Principles

1. Route on truth: health, capability, and priority decide where a request goes, and the UI shows the same state the router uses.
2. Recover automatically: a failed provider is a temporary condition, not a manual quarantine.
3. Keep the operator in control: every policy and credential is visible and editable in the UI, with manual disable always respected.
4. Be honest about surfaces: preserve Firecrawl shapes, normalize other providers carefully, and document what each adapter can and cannot do.
5. Make failures legible: every request records its attempts, provider, latency, and failure kind, with secrets redacted.

## Accessibility & Inclusion

Keyboard-operable controls, visible focus states, sufficient contrast in both themes, reduced-motion support, and responsive layouts down to a narrow mobile viewport. Status is never conveyed by color alone; icons and text labels accompany provider health.
