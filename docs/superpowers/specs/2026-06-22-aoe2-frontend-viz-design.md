# AoE2 Coach — Frontend Visualization (Design Spec)

**Date:** 2026-06-22
**Status:** Draft for review — **"maybe later"** in the program (§6 of the feasibility map).
**Scope:** Sub-project #5 of the "coach = preprocessing + AI" program. A CaptureAge-style
match-analysis view on nam-website that lets the user *see* the reconstruction.
**Program overview & feasibility map:** `aoe2coach-analysis/5_feasibility_and_design.md`
**Depends on:** #1 (Reconstruction core — the data source) shipping first, and ideally #2
(Economy model) for the estimate curves. Builds on the existing **Empires tab**
(`2026-06-21-aoe2-plays-tab-design.md`).

## Why

The existing Empires tab (#0, the plays-tab spec) shows a match as **text**: an age-up ladder,
metric readouts, and the coach prose. #1 produces a far richer `Reconstruction` object —
a **spatial building map with x/y**, full tech/production timelines, milestones, and real APM —
that text can't do justice to. This sub-project renders that object: the headline being a 2D
minimap drawn from exact `BUILD` coordinates, the single highest-value exact visualization in the
whole program. It is **additive**: same page, same endpoints, same cyan accent — richer detail
panels for a selected match.

**This spec gates on #1.** Until `Reconstruction` is persisted and served, there is nothing to
draw. #2's economy curves are an *optional enrichment* (the estimate views degrade to "unavailable"
if #2 hasn't shipped). It is explicitly the *last* sub-project; spec it now as a coherent future
deliverable so #1/#2's data contracts are designed with the viz in mind.

## The hard rule: visual honesty (program-wide)

Every pixel must be honest about its provenance. Three tiers, three visual treatments:

| Tier | Source | Visual treatment |
|---|---|---|
| **Exact** (Tier A) | command-derived `Reconstruction` fields (building x/y, age/tech/production times, APM, idle, `*_produced` counts) | **solid** strokes, full-opacity fills, no badge. `*_produced` counts get the literal word "produced" in their label (never "villagers", always "villagers produced"). |
| **Estimate** (Tier B) | #2 economy curves (vils-per-resource, resources-collected) | **dashed** strokes, reduced fill opacity, an **`~est` badge** on the panel header + a tooltip ("estimated from gather-rate model; no ground-truth total to calibrate against"). |
| **Unavailable** (Tier C) | engine-only stats: true resources, units killed/lost, conversions, **% map explored** | **omitted**, or shown as an explicit greyed **"not recoverable from a replay"** placeholder with a one-line why. **Never faked, never interpolated to look exact.** |

A small shared `<DataBadge tier="exact|est|unavailable">` component (below) is the single
enforcement point: any panel sourcing estimate data renders it; a Tier-C stat the user might
*expect* (because it's in the in-game Statistics screen) is shown with the "unavailable" badge so
its absence is explained, not silently dropped.

## Views to build (prioritized)

### V1 — Building-map minimap **(headline, exact)**
A 2D top-down minimap rendered from `Reconstruction.spatial` — every building plotted at its exact
`(x, y)`, both players overlaid (me = accent cyan, opp = muted amber/grey). This is the
single highest-value exact visualization: it makes "where did I build, did I wall, did I go
forward" *visible* in a way no text ladder can.

- **Data (#1, exact):** `spatial.me.{base_centroid, buildings:[{name,x,y,t_s}], forward:[...],
  walls:[{x,y,x_end,y_end}]}` and `spatial.opp` (key buildings only).
- **Rendering:** an inline `<svg viewBox>` sized to the map's coordinate extent (AoE2 map coords
  are tile units; auto-fit a bounding box over all buildings + a margin). Buildings = small
  squares/icons keyed by `name`; **walls = line segments** from `(x,y)→(x_end,y_end)`;
  **forward buildings highlighted** (the `forward` list) with a ring/glow; base centroids marked.
  No tileset art (licensing + weight) — a clean schematic, house cyber-schematic style.
- **Time control (optional, see open decisions):** a slider over `t_s` that fades in buildings as
  they were placed (each `BUILD` has `t_s`). v1 can ship **static** (all buildings, end-state);
  the slider is the natural first interactive upgrade.
- **Honesty:** entirely exact → solid, no badge. The minimap is *placements*, not live state — a
  razed building still shows (we can't know it died). Footnote: "shows where things were *built*,
  not what survived."

### V2 — Timeline **(exact)**
A horizontal time axis (0 → `duration_s`) with stacked lanes: **Ages** (Feudal/Castle/Imperial
arrival markers), **Tech** (eco / military / university lanes from `techs`), **Production
milestones** (`production.milestones`: first military building, first siege, first treb,
first-of-each-unit). This is the richer successor to the current vertical age-up ladder.

- **Data (#1, exact):** `ages.{feudal,castle,imperial}_arrival_s`, `techs.{eco,military,
  university}:[{name,t_s}]`, `production.milestones`, `production.produced_units:[{name,t_s}]`.
- **Rendering:** SVG/flex lanes; markers are dots/ticks at `t_s` with hover tooltips (name + mm:ss
  via `formatUptime`). Age arrivals are vertical guide-lines across all lanes.
- **Honesty:** all exact → solid. Production markers labeled by *queue* time (first time it was
  trained), which is exact.

### V3 — Efficiency panel **(exact)**
Compact readouts: **TC idle** (`tc_idle_s`, `longest_villager_gap_s`), **APM split** (`apm_eco`
vs `apm_military` vs `apm_total`) as a small stacked bar or donut.

- **Data (#1, exact):** `efficiency.{tc_idle_s, longest_villager_gap_s, villager_gaps_s,
  apm_total, apm_eco, apm_military}`.
- **Rendering:** number tiles + a two-segment APM bar (eco / mil). Villager-gap list optional.
- **Honesty:** exact → solid. (Note: TC idle is derived from villager-queue gaps — exact per #1's
  definition, not an estimate.)

### V4 — Economy curves **(estimate, flagged — gated on #2)**
Line charts over time: **vils-per-resource** (food/wood/gold/stone allocation) and
**resources-collected** trend, from #2's `~estimate`-flagged curves.

- **Data (#2, estimate):** the eco-model output (shape TBD by #2; assume
  `economy.{vils_per_resource:[{t_s, food, wood, gold, stone}], resources_collected:[{t_s,...}],
  is_estimate:true}`).
- **Rendering:** dashed lines, reduced-opacity area fills, **`~est` badge** + tooltip on the panel.
- **Honesty:** the entire panel is Tier-B. If #2 hasn't shipped (no `economy` key), render the
  panel as **Tier-C "unavailable — estimate model not yet built"** rather than hiding it, so the
  intent is visible.

### V5 — Produced-counts strip **(exact-but-careful)**
Largest *produced* army + villagers *produced*, from `counts`. **Always labeled "produced"** — an
upper bound on live counts (the #1 validation showed 126 queued vs 107 live). Combat deaths are not
in the file → we never show "live army" or "units killed".

- **Data (#1, exact-as-queued):** `counts.{villagers_produced, army_produced:[{name,amount}]}`.
- **Honesty:** solid, but the word "produced" is mandatory in every label, with a tooltip
  explaining queued ≠ alive. "Units killed/lost", "largest *live* army", "% map explored" sit here
  too — as **Tier-C unavailable placeholders** so the gap vs the in-game Statistics screen is owned.

### Coach narrative **(reuse existing)**
The #4 coach v2 write-up (`coach_analysis`) renders alongside, exactly as the current Empires tab
does — no change beyond placing it in the new detail layout.

**v1 cut line (recommendation):** ship **V1 + V2 + V3 + V5** (all exact, all from #1) as the first
deliverable. **V4** lands when #2 ships. Interactive time-scrubbing (V1 slider) is a fast-follow,
not v1. See open decisions.

## Component structure (follows existing nam-website patterns)

Next.js App Router, React 19, Tailwind v4 layout + **inline styles for accent-colored elements**
(per CLAUDE.md). All viz is rendered inside the existing match-detail accordion of
`components/Aoe2Tab.tsx` (already exists on `feat/aoe2-tab` / `feat/aoe2-coach-standalone`) — we add
detail panels, we do **not** add a route or a tab.

```
components/
  Aoe2Tab.tsx                  (existing — extend the expanded-row detail to mount the viz panels)
  aoe2/                        (new subfolder for match-viz components)
    Aoe2BuildingMap.tsx        V1 — SVG minimap; props: { spatial, accent }
    Aoe2Timeline.tsx           V2 — lanes; props: { ages, techs, production, durationS }
    Aoe2EfficiencyPanel.tsx    V3 — tiles + APM bar; props: { efficiency }
    Aoe2EconomyChart.tsx       V4 — dashed line charts; props: { economy | null }
    Aoe2ProducedStrip.tsx      V5 — produced counts + Tier-C placeholders
    DataBadge.tsx              shared tier badge: { tier: "exact"|"est"|"unavailable", label? }
```

- **Reuse:** `frontend/src/lib/aoe2.ts` helpers already shipped (`formatDuration`, `formatUptime`,
  `resultLabel`, `openingColor`, `clipEmbedUrl`). The cyan accent `#06b6d4` is already wired for
  `/plays`. Optionally reuse `components/CyberGrid.tsx` (needs a unique `prefix`) as a faint
  minimap backdrop to match the codes/reads house schematic look.
- **Styling:** inline styles for accent strokes/fills; Tailwind for layout; `.corner-*` and `.tag`
  shared classes from `globals.css`; `fadeUp` keyframe for panel entrance. Dashed vs solid SVG
  strokes via `strokeDasharray` driven by tier.
- **No new charting dependency.** Build the minimap, timeline, and APM bar as plain inline SVG
  (the codebase has no chart lib and the shapes are simple). The economy line chart (V4) is also
  hand-rolled SVG polylines — keeps the bundle light and self-contained.
- **Lazy-mount:** the building-map SVG and economy chart mount **only for the currently expanded
  match** (the accordion already mounts the clip iframe only when selected — same discipline), so
  the list stays light.

## Data / API additions

The viz needs `Reconstruction` (and #2's economy) reaching the browser. **Additive only** — extend
the existing `Aoe2Match` model + `GET /api/aoe2/<id>/` detail endpoint; no new routes, no new auth.

### Persistence (Django)
- **`#1` writes `Reconstruction` into a new JSON field** on `Aoe2Match`:
  `reconstruction = models.JSONField(default=dict, blank=True)`. This is the natural home — #4
  already plans to serialize the same object for the coach, so persisting it costs nothing extra.
  Populated in `analyze_match` (`website/tasks.py`) right after `reconstruct(rec)` is added by #1.
- **`#2` writes its estimate output** into the same field under an `economy` key (or a sibling
  `economy = models.JSONField(...)`), carrying `is_estimate: true`. Decided in #2; this spec only
  requires that the served object distinguishes it.
- Existing `timeline` / `metrics` / `coach_analysis` fields stay (back-compat for the current text
  tab while the viz rolls out). The viz prefers `reconstruction` when present and falls back to the
  flat `metrics` for older matches.

### Serving (frontend)
- **`GET /api/aoe2/<id>/`** (existing detail endpoint, `website/views/aoe2.py::aoe2_detail`) adds a
  `reconstruction` key (and `economy` once #2 ships) to its JSON response — the full object the viz
  consumes. No change to the **list** endpoint (still lightweight summaries; the heavy
  reconstruction loads only on row expand, matching the existing detail-on-select pattern).
- **`frontend/src/lib/aoe2.ts`** gains a `Reconstruction` TS type mirroring #1's shape and a
  `Aoe2MatchDetail` type extended with `reconstruction?` / `economy?` (optional → old matches and
  pre-#2 matches degrade gracefully). Existing summary type unchanged.

### Size note
The full `Reconstruction` (hundreds of buildings with coords) is a few KB of JSON — fine to embed
in the detail response. No pagination needed. If it ever bloats, a dedicated
`GET /api/aoe2/<id>/reconstruction/` sub-endpoint is the escape hatch (not needed for v1).

## Testing (house convention)

Pure logic goes in `frontend/src/lib/aoe2.ts` (already the established home), tested with **vitest**
in `frontend/src/lib/__tests__/aoe2.test.ts` (already exists). Components themselves are *thin SVG
renderers over pure helpers* — keep all math in helpers so it's unit-testable without a DOM:

- `fitMapViewBox(buildings, walls, margin)` → `{minX, minY, width, height}` (minimap auto-fit;
  guards empty/zero coords like #1's spatial guards).
- `mapCoordToSvg(x, y, viewBox, svgSize)` → pixel position.
- `timelineX(t_s, durationS, width)` → marker x-position; clamps to range.
- `apmSplitSegments(apm_eco, apm_military, apm_total)` → bar segment widths (handles
  uncategorized = total − eco − mil; guards divide-by-zero).
- `tierStroke(tier)` → `{ strokeDasharray, opacity }` (the single source of solid-vs-dashed).
- Edge cases that must be tested: missing/empty `spatial`, a match with no `reconstruction` (old
  row → falls back, no crash), an estimate panel with `economy` absent (renders unavailable).

No backend test changes beyond #1/#2 (which test the `Reconstruction`/economy producers); the
detail endpoint addition gets one assertion that `reconstruction` is present in the response when
the field is populated (extend `website/tests/test_aoe2.py`).

Manual: `pnpm dev` + Playwright screenshots of the building map + timeline on a real analyzed match
before pushing (per CLAUDE.md UI-verify rule).

## What this sub-project deliberately does NOT do

- **No engine simulation / live state.** No live army size, no units killed/lost, no true
  resources, no conversions, no % map explored — these are Tier-C and shown as honest
  "unavailable" placeholders, never drawn.
- **No tileset / game-art rendering** of the map — a clean schematic, not a CaptureAge pixel
  replica (art licensing + bundle weight). Buildings are simple keyed glyphs.
- **No new page, route, tab, or nav-wheel entry** — strictly additive detail panels inside the
  existing Empires tab; no accent-color change.
- **No new data extraction.** It renders #1's `Reconstruction` and #2's economy verbatim; it does
  not compute new game facts. If a stat isn't in those objects, the viz doesn't invent it.
- **No replay scrubbing of unit positions** — only `BUILD` carries reliable coords; we cannot
  reconstruct unit movement paths, so there is no "watch the game back" unit playback. (The
  building-map *time slider* fading in placements is the closest honest analog.)

## Relationship to #1 / #2 / #4

- **#1 (Reconstruction core)** — the **exact data source**. This spec draws V1/V2/V3/V5 directly
  from its `spatial` / `ages` / `techs` / `production` / `efficiency` / `counts` fields and gates
  on it shipping + persisting `reconstruction`.
- **#2 (Economy model)** — supplies V4's estimate curves. Optional: V4 degrades to a Tier-C
  "unavailable" panel until #2 ships. (#2's spec is being written in parallel and is not yet on
  disk; this design is against the program overview's Tier-B description.)
- **#4 (Coach v2)** — its narrative renders beside the viz unchanged. #4 already serializes
  `Reconstruction` for the prompt, so persisting it (this spec's only backend ask) is shared work.
- **#0 (Empires tab,** `2026-06-21-aoe2-plays-tab-design.md`**)** — the host. This is the visual
  upgrade of its match-detail accordion; the stats header, list, clips, and admin controls are
  untouched.

## Open decisions to flag for the user

1. **v1 scope.** Recommend **V1 building-map + V2 timeline + V3 efficiency + V5 produced-strip**
   (all exact, all from #1) as the first cut, with **V4 economy** deferred to when #2 ships.
   Confirm, or is the headline minimap *alone* a sufficient first slice?
2. **Interactive time-scrubbing.** Is a time slider on the building map (fade buildings in by
   `t_s`) in scope for v1, or is a **static end-state minimap** enough first? (Static is simpler
   and lower-risk; the slider is a clean fast-follow since every `BUILD` already has `t_s`.)
3. **Opponent detail.** #1 stores opp **key buildings only** (not the full base). Show opp on the
   minimap as a sparse overlay, or focus the headline view on "my" base only and treat opp as a
   secondary toggle?
4. **Map art.** Confirm the **schematic** (no tileset) direction — cleaner + lighter + matches house
   style, but less "CaptureAge-pretty". Acceptable?
5. **Timing.** This is the program's "maybe later." Build it after #1 (and ideally #2) land and have
   earned trust, or pull it forward as a motivating demo once #1 ships? (It needs *only* #1 for the
   exact views, so a #1-only v1 is viable the moment #1 is in.)
