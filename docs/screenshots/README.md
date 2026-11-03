# Screenshot Evidence

These PNGs are evidence of the dashboard at a specific build, not design source files. The visual contract lives in [`../design.md`](../design.md) and [`../ui.md`](../ui.md).

## Provenance

| Field | Value |
|---|---|
| Captured | 2026-11-03T17:12:53Z |
| Source | v0.1.2 working tree (captured before the release commit) |
| Build | `bun run build`; served from `dist/` |
| `dist/index.html` SHA-256 | `8a1e64b9a8b01cab69a3f6844acbfabb91cf3bea0ff22bbb1fc6bd4f8f5f81f4` |
| `dist/assets/index-FQ05WyrU.css` SHA-256 | `1628c1e6d8d1d741a9d7e8bbdc0032efa234e7518a7c72dae03d3984cc600d56` |
| `dist/assets/index-DsJXoy3l.js` SHA-256 | `565ebb0fc9fcce0c2654514a486c1ff316ce47d3a02ce260dc323d2820374084` |
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

## Data

The screenshots use the local demo database at `/tmp/opencode/wsr-ui-data`, not production data:

- `Firecrawl Cloud` contains one real live smoke-test search. The API key is not shown; only the masked hint appears.
- `Retired gateway` is a deliberately unreachable synthetic provider (`127.0.0.1:9999`) used to show auto-disabled standby state.
- `Local Firecrawl test` points at a local mock upstream; `SearXNG fallback` and `DeepSeek Search` are manually disabled demo rows.
- Request logs and provider events are demo traffic. The `2/3` healthy count reflects two healthy enabled providers and one auto-disabled provider at capture time.
- Authentication is disabled, so the Access page shows the first-admin empty state.

Do not treat names, counts, latencies, or event timestamps as production benchmarks.

## Recapturing

1. Build the dashboard: `bun run build`.
2. Serve the same `dist/` with the current server and open the pages against it.
3. Use a 1440 × 1000 viewport for desktop and 390 × 844 for mobile; set `localStorage["wsr-theme"]` to `dark` or `light` before load.
4. Wait for fonts and initial API data, then screenshot with animations disabled.
5. Update the build hashes, capture time, and file table above.

`overview-dark.png`, `overview-desktop.png`, and `overview-mobile.png` are full-page. The remaining desktop pages are viewport captures so tables stay at their designed density.

## Related docs

- [`../ui.md`](../ui.md) — dashboard structure and responsive rules.
- [`../design.md`](../design.md) — visual system.
- [`../testing.md`](../testing.md) — E2E suite and selectors.
