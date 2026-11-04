# Screenshot Evidence

These PNGs are evidence of the dashboard at a specific build, not design source files. The visual contract lives in [`../design.md`](../design.md) and [`../ui.md`](../ui.md).

## Provenance

| Field | Value |
|---|---|
| Captured | 2026-11-04T16:15:52Z for `overview-dark.png`; 2026-11-03T17:12:53Z for the other files |
| Source | v0.1.4 working tree for `overview-dark.png` (full-height rail with the footer anchored to the page bottom); v0.1.2 working tree for the other files |
| Build | `bun run build`; served from `dist/` |
| `dist/index.html` SHA-256 | `56c87a045f8789e2f362baef4b1e13d81474fc9da4ffa203290926afba8219d0` (v0.1.4) / `8a1e64b9a8b01cab69a3f6844acbfabb91cf3bea0ff22bbb1fc6bd4f8f5f81f4` (v0.1.2) |
| `dist/assets/index-*.css` SHA-256 | `91531fc1895d75b5fa2a5fd4ccae83a3cec1d511eceec319af2c62f1fd3b43a8` (v0.1.4) / `1628c1e6d8d1d741a9d7e8bbdc0032efa234e7518a7c72dae03d3984cc600d56` (v0.1.2) |
| `dist/assets/index-*.js` SHA-256 | `67d42697a578493adbe8ed757a99b7f2357b83d31490f625e36fe03920a95de1` (v0.1.4) / `565ebb0fc9fcce0c2654514a486c1ff316ce47d3a02ce260dc323d2820374084` (v0.1.2) |
| Browser | Playwright, Chrome channel (same as E2E) |
| Theme | Per file below; `localStorage["wsr-theme"]` set before load |
| Motion | Screenshot mode disables CSS animations/transitions |

## Files

| File | Theme | Viewport | Capture |
|---|---|---|---|
| `overview-dark.png` | Dark | 1440 × 1000 | Full page (1440 × 1234) |
| `overview-desktop.png` | Light | 1440 × 1000 | Full page (1440 × 1234) |
| `overview-mobile.png` | Dark | 390 × 844 | Full page (390 × 2277) |
| `providers-desktop.png` | Dark | 1440 × 1000 | Viewport |
| `routing-desktop.png` | Dark | 1440 × 1000 | Full page (1440 × 1018) |
| `logs-desktop.png` | Dark | 1440 × 1000 | Viewport |
| `access-desktop.png` | Dark | 1440 × 1000 | Viewport |
| `settings-desktop.png` | Dark | 1440 × 1000 | Viewport |

`overview-dark.png` is the README hero and has been recaptured at v0.1.4. The other files still show the v0.1.2 build captured on 2026-11-03, including the old rail that stopped at the viewport height; refresh them with the same steps when the dashboard changes need to be reflected everywhere.

## Data

`overview-dark.png` was captured from a seeded copy of the local demo database. The other files still reflect the original 2026-11-03 demo data.

- The original demo data lives at `/tmp/opencode/wsr-ui-data`; the recapture copied it to `/tmp/wsr-shots/data` so the original stayed untouched.
- Demo traffic in the last hour (156 seeded `POST /v2/search` rows) is attributed to `local-firecrawl`, the local Firecrawl mock on `127.0.0.1:9001`. It is illustrative traffic, not live upstream calls.
- `Firecrawl Cloud` keeps the single real live smoke-test search from the earlier demo data. The API key is not shown; only the masked hint appears.
- `Retired gateway` is a deliberately unreachable synthetic provider (`127.0.0.1:9999`) used to show auto-disabled standby state. Its failure count and event timestamps were set for the capture.
- `Local Firecrawl test` points at the local mock upstream; `SearXNG fallback` and `DeepSeek Search` are manually disabled demo rows.
- Provider events were moved into the last hour and scheduled probes were paused with a per-provider `probe_interval_seconds` override, so the board keeps its demo state while the capture runs.
- The `2/3` healthy count reflects two healthy enabled providers and one auto-disabled provider at capture time.
- Authentication is disabled, so the Access page shows the first-admin empty state.

Do not treat names, counts, latencies, or event timestamps as production benchmarks.

## Recapturing

1. Build the dashboard: `bun run build`.
2. Serve the same `dist/` with the current server and open the pages against it.
3. Use a 1440 × 1000 viewport for desktop and 390 × 844 for mobile; set `localStorage["wsr-theme"]` to `dark` or `light` before load.
4. Wait for fonts and initial API data, then screenshot with animations disabled.
5. For the overview, seed traffic inside the last hour and pause scheduled probes first, or the chart stays empty and the board changes state mid-capture.
6. Update the build hashes, capture time, and file table above.

`overview-dark.png`, `overview-desktop.png`, and `overview-mobile.png` are full-page. The remaining desktop pages are viewport captures so tables stay at their designed density.

## Related docs

- [`../ui.md`](../ui.md) — dashboard structure and responsive rules.
- [`../design.md`](../design.md) — visual system.
- [`../testing.md`](../testing.md) — E2E suite and selectors.
