# Dashboard — UI Structure and Design System

## Overview

The dashboard is a React 18 single-page app served from `dist/` by the same Elysia server that proxies search traffic. It is an operator surface: the route chain, provider health, and request history are the primary content, not marketing copy. The visual system is a graphite control room with ruled panels, monospace data labels, a single amber signal color, and a live departure-board route chain.

The UI has no separate router dependency; it uses hash navigation (`#/overview`, `#/providers`, …) and same-origin `fetch`. Authentication state is derived from `/api/auth/state`; when auth is disabled, the UI acts as the system admin.

## Key files

| File | Purpose |
|---|---|
| `src/client/main.tsx` | React root, font imports, global CSS import. |
| `src/client/App.tsx` | Provider composition, splash/login gate, tab switch, command palette, toasts. |
| `src/client/index.css` | Tailwind 4 tokens, base styles, component classes, animations, responsive rules. |
| `src/client/lib/api.ts` | Typed API client, `ApiError`, all endpoint wrappers. |
| `src/client/lib/format.ts` | Date, relative time, duration, interval, number, percent, status, SQLite datetime helpers. |
| `src/client/lib/random.ts` | Secure-context-safe IDs for client-side toasts. |
| `src/client/hooks/useAuth.tsx` | Auth state, login/logout, refresh, `isAdmin`. |
| `src/client/hooks/useToast.tsx` | Toast queue and auto-dismiss. |
| `src/client/hooks/useTheme.tsx` | Dark/light theme with `localStorage` persistence. |
| `src/client/hooks/useHashRoute.ts` | Tab type, hash parsing, navigation, scroll reset. |
| `src/client/components/Layout.tsx` | Sidebar rail, top bar, mobile drawer, theme/user controls. |
| `src/client/components/CommandPalette.tsx` | ⌘K/Ctrl+K page jump dialog. |
| `src/client/components/ToastContainer.tsx` | Bottom-right toast stack. |
| `src/client/components/ui.tsx` | Button, Input, Select, Textarea, Badge, Panel, Field, Toggle, Skeleton, EmptyState, ErrorNotice, Dialog, ConfirmDialog. |
| `src/client/components/status.tsx` | Health badge, credit badge, status dot, provider type marks. |
| `src/client/components/RouteBoard.tsx` | Primary/standby route chain with priority, health, credits, requests, success, latency. |
| `src/client/components/ProviderForm.tsx` | Add/edit provider dialog, type cards, presets, JSON config editor. |
| `src/client/pages/Login.tsx` | Login and first-run admin setup. |
| `src/client/pages/Overview.tsx` | Metrics, route board, health envelope, traffic chart, events, provider ledger. |
| `src/client/pages/Providers.tsx` | Provider table, filters, reorder, test, enable/disable, delete. |
| `src/client/pages/Routing.tsx` | Priority chain, recovery policy, last-resort toggle, time budget. |
| `src/client/pages/Logs.tsx` | Filtered request log, expandable attempt chain and redacted bodies. |
| `src/client/pages/Access.tsx` | Users tab, API keys tab, create/reset/revoke flows. |
| `src/client/pages/Settings.tsx` | Auth toggle/setup, password change, rate limit, logging, deployment info, reset. |

## How it works

### Boot and auth gate

```text
main.tsx
  ThemeProvider -> AuthProvider -> ToastProvider -> Shell
Shell:
  useAuth() -> GET /api/auth/state
  loading -> Splash
  enabled && !user -> LoginPage (needsSetup when no users)
  otherwise -> Layout + active tab
```

`AuthProvider.refresh()` runs after login, logout, setup, auth enable/disable, and settings reset. `isAdmin` is true when auth is disabled (system admin) or the session user has role `admin`.

### Navigation

`useHashRoute()` reads `window.location.hash`, accepts only the tabs in `TABS`, and falls back to `overview`. Add a page by updating all of:

1. `TABS` in `src/client/hooks/useHashRoute.ts`.
2. `NAV_ITEMS` in `src/client/components/Layout.tsx`.
3. The `tab === ...` switch in `src/client/App.tsx`.
4. The command palette `ITEMS` in `src/client/components/CommandPalette.tsx`.

The sidebar is fixed above 980 px and becomes a drawer at 980 px and below. The closed drawer is `inert` and `aria-hidden`; the hamburger exposes `aria-expanded`/`aria-controls`, opening moves focus to the first nav item, Escape closes the drawer, and focus returns to the hamburger. The top bar shows the active page title, description, a command-palette button, and a date badge.

### Data loading

- Overview polls `/api/overview` every 8 seconds and pauses when `document.hidden`.
- Providers polls every 10 seconds.
- Logs polls every 10 seconds only when no row is expanded.
- Routing and Settings load once and after saves.
- The traffic chart fetches 1h (5-minute buckets), 24h (60-minute buckets), or 7d (daily buckets).
- All fetch helpers throw `ApiError` with `status` and `issues`; forms show `ErrorNotice` with the issue list.
- A failed initial load renders `LoadError` with Retry, never an empty state or an endless skeleton. Empty states are reserved for successful zero-result responses.
- Overview counts only `health === "healthy"` as healthy. Unverified and auto-disabled providers are reported separately; zero-traffic rates and latencies render as `—`, not `0%`/`0ms`.
- Firecrawl providers expose a credit snapshot from the `/v2/team/credit-usage` probe. `CreditBadge` shows remaining credits in the route board and provider table; the badge tooltip carries the plan size, reset date, and last check time. Zero credits render as bad; the last tenth of the plan renders as a warning.

### Design system

| Token | Dark | Light |
|---|---|---|
| Page ground | `#0a0b0c` | `#f3f1ea` |
| Panel | `#111315` | `#fbfaf6` |
| Raised panel | `#16191c` | `#ffffff` |
| Rail | `#070809` | `#e9e6dd` |
| Ink | `#f2f0e9` | `#17191b` |
| Muted | `#a0a4a9` | `#5b6064` |
| Dim | `#858a90` | `#6b7075` |
| Line | `rgba(242,240,233,.08)` | `rgba(22,24,26,.10)` |
| Accent | `#f0b35a` | `#8a5204` |
| Healthy | `#5dd39e` | `#167a56` |
| Warning | `#e8b04b` | `#8a5800` |
| Danger | `#f06d65` | `#b03a31` |

- Typography: Manrope Variable for UI; JetBrains Mono Variable for labels, metrics, IDs, and code. Fixed rem sizes; no fluid display type.
- Panels are ruled rectangles with 4 px radius, hairline borders, and a small uppercase header label. Avoid large rounded cards.
- Accent is reserved for the live lane, current navigation, focus, and primary-action hover. Status colors are semantic only.
- Status is never color-only: health badges include text (`healthy`, `auto-disabled`, `unverified`, `disabled`) and a dot.
- Motion is state-driven: 150–250 ms transitions, a one-time row entrance, live pulse on healthy dots, toast entrance. Reduced-motion media query disables all animation.
- Responsive: route rows collapse to two columns under 640 px; sidebar becomes a drawer under 980 px; filters wrap; tables scroll horizontally.

### Component conventions

- `Button` variants: `primary` (bone fill), `secondary` (outline), `ghost`, `danger`; sizes `sm`, `md`, `icon`.
- `Panel` owns the ruled module: header + body; use `bodyClassName="p-0"` for tables/route rows.
- `Dialog` uses Radix Dialog with overlay, title, description, body, footer; `wide` for provider/log detail.
- `Field` wraps label, control, and help text; inputs use `.input`, `.select`, `.textarea`.
- `ProviderTypeMark` is the only place that maps type → icon.
- `RouteBoard` is the signature element: priority box, provider identity, live badge, metrics, Firecrawl credit badge, health badge; standby lane below a labeled divider. Primary rows expose reorder controls, standby rows expose a probe action, and the empty-primary warning states whether last-resort failover is on.
- `LoadError` is the failed-initial-load state. It carries `role="alert"` and a Retry action; do not use `ErrorNotice` as a substitute for a missing surface.
- Toggle buttons use `aria-pressed`; Access tabs use `role="tablist"`/`role="tab"` with `aria-selected`.
- Empty states teach the next action (add provider, send a request) instead of saying “nothing here”. Overview’s add-provider actions open the provider form, not just the Providers page.

## Gotchas & invariants

- **`dist/` is the served UI.** The backend watch mode does not rebuild the dashboard. Run `bun run build` or `bun run build:watch` after UI changes.
- **Hash navigation must be updated in four places.** Adding a page only to `App.tsx` leaves it unreachable from the rail and command palette.
- **Auth disabled means system admin, not no auth.** The UI shows an open control plane banner; mutations still work. Enabling auth requires an admin account.
- **The theme is stored in `localStorage` under `wsr-theme`.** Browser `prefers-color-scheme` is only the first-run default.
- **`crypto.randomUUID` is secure-context-only.** A dashboard served over plain HTTP on a LAN does not have it, even though `localhost` does. Client IDs go through `src/client/lib/random.ts`, which falls back to `getRandomValues` and then a time/random suffix. Do not call `crypto.randomUUID` directly in browser code.
- **Provider config is raw JSON in the form.** Type changes replace the config with the new adapter’s default; review the JSON before saving. Invalid JSON is rejected client-side and by the API.
- **Per-provider probe interval is a first-class form field.** It is a top-level `probeIntervalSeconds`, not part of the JSON config. Blank means use the global health interval; DeepSeek probes can bill.
- **Disabling authentication is a confirmed downgrade.** The Settings toggle opens a confirmation dialog and keeps the toggle on until the user confirms.
- **The first Access user defaults to Admin.** Creating a read-only first account would make Settings refuse to enable authentication. The empty state and dialog label the first account as the admin setup path.
- **API keys created while auth is off belong to the hidden `system` owner.** The Access dialog states this instead of showing an owner picker; those keys remain valid after authentication is enabled.
- **A provider secret is shown only once.** `apiKeySet`/`apiKeyHint` identify a saved key; clearing requires the “Clear saved key” checkbox, which sends `apiKey: ""`.
- **Reorder uses the full sorted provider list, not the filtered table.** Moving a row while a filter is active still computes order across all providers.
- **Logs are already redacted by the server.** Do not add client-side secret rendering; the body shown is what SQLite stored.
- **Overview chart empty state is expected on a fresh database.** Send a search or proxy request to populate it.
- **Credit data is a probe snapshot, not live billing.** `creditsCheckedAt` states its age. Firecrawl `readiness` mode never populates credits; use `auto`/`credit` with an API key.
- **`formatDate()` treats space-separated timestamps as UTC.** SQLite stores `YYYY-MM-DD HH:MM:SS`; the helper appends `T`/`Z` before parsing.
- **The mobile drawer uses a fixed rail and a backdrop.** Do not set `overflow: hidden` on a parent of the rail; the dialog/topbar layering depends on the existing z-index order. Keep the closed rail `inert`; otherwise its controls remain in the tab order while off-screen.
- **E2E selectors rely on accessible names.** Buttons use `aria-label` with provider names (`Test <name>`, `Disable <name>`), switches have labels, and page headings are level 2. Keep those names stable.

## Related docs

- [`screenshots/README.md`](screenshots/README.md) — screenshot provenance and capture method.
- [`design.md`](design.md) — durable visual system and component language.
- [`api.md`](api.md) — management endpoints used by the UI.
- [`architecture.md`](architecture.md) — routing state the UI renders.
- [`testing.md`](testing.md) — Playwright coverage and selectors.
