# Design System — Web Search Router

## Product surface

Mode: **Operate**. The visitor is an operator completing a task: checking which provider will serve the next request, reacting to a degraded route, editing policy, or issuing a key. Familiarity, scanability, and truthful state outrank expression. The brand lives in the precision of the route board, not in decoration.

## Visual direction

**A live operations board fused with an airport departure board.** The page is a set of ruled modules on a graphite ground. Priority rows rerank in place; status is carried by line, weight, and a text label as well as color. The accent behaves like a signal light: it marks the live lane, the current navigation item, and focus, never decoration.

The category default this rejects: a uniform SaaS card grid with a gradient hero, rounded blobs, and decorative charts. This surface is a control room; the route chain is the first viewport thesis.

## Color

| Role | Dark | Light | Use |
|---|---|---|---|
| Ground | `#0a0b0c` | `#f3f1ea` | Page background |
| Panel | `#111315` | `#fbfaf6` | Module surface |
| Raised | `#16191c` | `#ffffff` | Dialog / toast |
| Rail | `#070809` | `#e9e6dd` | Sidebar |
| Ink | `#f2f0e9` | `#17191b` | Primary text |
| Muted | `#a0a4a9` | `#5b6064` | Secondary text |
| Dim | `#858a90` | `#6b7075` | Labels, hints |
| Line | `rgba(242,240,233,.08)` | `rgba(22,24,26,.10)` | Hairlines |
| Accent | `#f0b35a` | `#8a5204` | Live lane, focus, active nav, primary hover |
| Healthy | `#5dd39e` | `#167a56` | Healthy status |
| Warning | `#e8b04b` | `#8a5800` | Unverified / caution |
| Danger | `#f06d65` | `#b03a31` | Auto-disabled / destructive |
| Info | `#83b9ff` | `#2c6cb5` | Neutral informational badges |

Color strategy: **Restrained**. Neutrals carry the surface; semantic colors are reserved for state. The accent is a signal, not a fill. The light theme is warm paper, not pure white; the dark theme is graphite, not pure black.

## Typography

| Role | Face | Size / treatment |
|---|---|---|
| UI / headings | Manrope Variable | Page title 26px, panel title 11px uppercase, body 12–14px |
| Metrics / IDs / code | JetBrains Mono Variable | Tabular numbers, 9–12px labels, letter-spacing 0.08–0.18em |
| Labels | JetBrains Mono | 10px uppercase, tracked |
| Table headers | JetBrains Mono | 9px uppercase, 0.12em tracking |

Fixed rem scale; no fluid display type. Page titles use tight tracking (`-0.03em`) and heavy weight. Data is monospaced so columns align and latency/priority read as quantities, not prose. No display serif, no decorative font pairing.

## Layout

- `app-shell`: 248px sticky rail + fluid main column. Max content width 1480px, 28px page padding.
- Top bar: 62px sticky, blurred ground, page title/description, command palette, date badge.
- Panel: 4px radius, 1px hairline, 46px header, 16px body.
- Stats: two columns on mobile, four on desktop.
- Overview: route board + health envelope in the first content row; traffic + events in the second.
- Route row: 42px priority column, vertical hairline spine, provider identity, right-aligned metrics, health badge. Primary lane above a labeled standby divider.
- Mobile: rail is a drawer; route rows collapse to two columns and the health badge moves below the provider identity; tables scroll horizontally.

## Components

- **Button** — 3px radius, 34px min height. Primary is bone fill with dark text; hover turns amber. Secondary is outline; ghost is text-only; danger is red outline/fill on hover. Icon buttons are 32px.
- **Input/Select/Textarea** — 3px radius, dark field on panel ground, amber focus ring (`0 0 0 3px accent-soft`). Textarea is mono for JSON.
- **Badge** — 2px radius, 21px high, mono 9px uppercase; semantic tinted border/background; optional 5px dot.
- **Panel** — ruled module; header carries a mono eyebrow and title; body is free-form.
- **Route row** — signature component; priority box, live badge, provider mark, base URL, request/success/avg metrics, health badge. Standby rows are labeled and muted.
- **Provider mark** — 26–28px outline square with a type icon (Firecrawl flame, DeepSeek waves, generic globe).
- **Dialog** — Radix portal; overlay blur; 680px default, 860px wide; title + description + body + footer.
- **Toggle** — 38×22px track; amber when on; dark field when off.
- **Toast** — bottom-right, 360px max, semantic icon, 4.5s auto-dismiss.
- **Empty state** — icon tile, short title, one explanatory sentence, one next action.

## State and motion

- Every interactive component has default, hover, focus-visible, active, disabled, and loading states. Buttons show a spinner while loading.
- Status is never color-only. Badges include text; route rows include a live/standby label.
- Motion is functional: 150–250ms color/border transitions; row entrance 200ms; healthy dot pulse 2.4s; toast 220ms. No page-load choreography.
- `prefers-reduced-motion` disables animation and transition durations.

## Voice and content

- Direct, operational, honest. “Higher numbers are tried first.” “A successful probe moves an auto-disabled provider back to healthy.”
- No marketing superlatives, invented benchmarks, or false availability claims.
- Provider limitations are stated in the UI and docs: DeepSeek probes cost money, and generic mappings depend on the upstream JSON shape.
- Numbers use tabular figures and localized formatting; dates are relative where recency matters (`just now`, `30s ago`) and absolute in logs.

## Implementation

- Tokens live in `src/client/index.css` under `:root` and `[data-theme="light"]`; Tailwind theme aliases map them to utility names (`bg-panel`, `text-ink`, `border-line`, `text-accent`).
- Fonts are bundled through `@fontsource-variable/manrope` and `@fontsource-variable/jetbrains-mono`; no external font request.
- This document is the durable visual contract; the dashboard page structure and data flow are documented in [`ui.md`](ui.md).

## Do not

- Add rounded-pill cards, gradient hero shells, or decorative glow blobs.
- Use the accent as a background for inactive states or as decoration.
- Hide status behind color alone.
- Use display fonts for labels, buttons, or data.
- Add page-load animation sequences; operators are in flow.
- Invent provider capabilities or benchmark claims.
