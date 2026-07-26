# AoE2 Coach — Strategic Map Rendering (Design Spec)

**Date:** 2026-06-22
**Status:** Draft for review
**Scope:** Sub-project #7 of the "coach = preprocessing + AI" program. Annotated "military-style"
maps, rendered server-side from the reconstruction, that the coach **agent can SEE** (multimodal
image input).
**Program overview & feasibility map:** `aoe2coach-analysis/5_feasibility_and_design.md`
**Consumes:** #1 `Reconstruction` (`docs/superpowers/specs/2026-06-22-aoe2-reconstruction-core-design.md`)
— specifically its `spatial` and `engagements` blocks, plus the raw `ops` for new path traces.
**Feeds:** #4 Coach v2 (`…/2026-06-22-aoe2-coach-v2-design.md`) — the PNG drops into the coach
workspace; and #5 Frontend viz (`…/2026-06-22-aoe2-frontend-viz-design.md`) — which reuses the same
geometry to draw its web minimap.
**Ships:** **WITH #4**, not deferred like #5. Its whole purpose is to make the coach better *now*.

## Why

The coach is a `claude -p` agent reading files in a per-match workspace (#4), and **Claude reads
images** — a PNG dropped into the cwd becomes multimodal input the agent perceives directly. Today
the only spatial signal it gets is `facts.json` coordinates: a list of `{name, x, y}` triples it
must mentally assemble into "where was my base, did I wall, did I go forward, where did the fights
happen". Models are weak at that mental reconstruction and strong at *seeing* a picture. So
preprocessing renders a **simple annotated strategic map** — base/building layout, walls, forward
buildings, the scout's opening route, army-push vectors, attacks on known enemy buildings,
engagement zones — and the agent looks at it instead of parsing coordinates from text.

The same vectors are JSON, so #5's web minimap reuses them verbatim. One geometry computation, two
renderers (server PNG for the agent, browser SVG for the human).

## THE HONESTY BOUNDARY (the load-bearing constraint)

This is the single most important rule in the spec. **The map draws ONLY what is in the data.** It
is a **strategic / operational** map (where things were, where forces moved, where fights clustered)
— **NOT a tactical battle diagram** (who hit whom, unit-vs-unit choreography). Every layer is tagged
`exact` or `heuristic` in the geometry and in the rendered legend.

| Layer | Drawable? | Tier | Source |
|---|---|---|---|
| Building layout (both bases) | YES | **exact** | `spatial.{me,opp}.buildings[].{name,x,y}` |
| Walls | YES | **exact** | `spatial.me.walls[].{x,y,x_end,y_end}` (`WALL` op) |
| Forward / proxy buildings | YES | **exact** | `spatial.me.forward[]` (already flagged by #1) |
| Base centroids | YES | **exact** | `spatial.{me,opp}.base_centroid` |
| **Scout opening route** | YES | **exact path, heuristic unit-ID** | trace the scout-cavalry `object_id`'s early `MOVE`/`ORDER` coords (new, this spec) |
| **Army-push vectors** | YES | **heuristic** | military `MOVE`/`ATTACK_GROUND`/`PATROL`/`DE_ATTACK_MOVE` coords over time, binned |
| **Attacks on KNOWN opp buildings** | YES | **exact** | `engagements[].building_targets` (treb→castle etc., #1 already resolves these) |
| Engagement zones | YES | **heuristic** | `engagements[].{zone, centroid_xy}` (#1's clustering) |
| **Unit-vs-unit micro** ("skirms hit the spear line, knights flank the archers") | **NO — FABRICATION** | — | we have **no live unit positions and no enemy composition during fights** |
| Live troop counts on the map / who died where | **NO — FABRICATION** | — | deaths are engine-only (#1) |
| Enemy unit movements | **NO — FABRICATION** | — | we only see *our* selected `object_ids`; opp ops are the opp player's, and we don't track their units' live positions |

The "NO" rows must **never** be rendered. A knight-clashes-with-spearman vignette would be the model
hallucinating a battle we have zero positional evidence for — exactly the failure mode the whole
program exists to kill. The map shows **operational intent and pressure**, drawn as arrows and zones,
never a fight cartoon.

### Why scout-route and army-push are honest (and where the honesty edge is)

Every `MOVE`/`ORDER`/`ATTACK_GROUND`/`PATROL`/`DE_ATTACK_MOVE` op carries `x`, `y`, **and the
selected `object_ids`** (verified against `mgz/fast/actions.py`). So:

- **Scout route** is *exact as a path*: pick the scout-cavalry unit's `object_id` (see below), then
  draw the polyline of its `MOVE`/`ORDER` destinations in chronological order. The waypoints are
  real clicks. The **heuristic part is identifying *which* `object_id` is the scout** (the rec gives
  us no unit-type-by-id table for spawned units) — so we resolve it by a documented heuristic and
  *label the layer accordingly* ("opening scout route — inferred from the most-moved early unit").
- **Army-push vectors** are *heuristic by construction*: we know our military commands had
  destination coords at time T, so "force was directed toward (x,y) around T" is real. We do **not**
  know how many units actually arrived, whether they fought, or what they met. So a push is drawn as
  a **direction-and-time arrow** ("army directed toward enemy base ~22:00"), never as a unit count or
  an outcome. The arrow says *intent and vector*, which the commands prove; it says nothing about
  result, which they don't.

## New extraction over #1: `mapviz/geometry.py` (pure functions)

Lands in the standalone **`aoe2coach`** package, a new sub-package **`aoe2coach/mapviz/`** with
`geometry.py` (pure) and `render.py` (imperative, isolated — see next section). Geometry functions
are pure over `ops` + the already-computed `Reconstruction` (no Django/DB/network), Python 3.12,
ruff line-length 120.

`geometry.py` builds a single JSON-serializable **`MapGeometry`** dict. It **consumes** #1's
`spatial` and `engagements` (does not recompute them) and **adds** two new traces from the raw ops:

### New functions

- **`scout_route(ops, me_number, spatial) -> dict | None`** — *exact path / heuristic unit*.
  1. Restrict to ops in the early game (config `SCOUT_WINDOW_S`, default first 300s) issued by
     player `me_number`, of type `MOVE`/`ORDER` (these are the scouting clicks).
  2. Group by `object_id` (single-unit selections only — `len(object_ids) == 1` — a scouting player
     micro-moves the lone scout). Pick the `object_id` with the most distinct early waypoints that
     also travels the greatest cumulative distance away from `spatial.me.base_centroid` (a scout
     ranges; a villager does not). Tie-break: earliest first move.
  3. Emit `{object_id, tier: "exact_path_heuristic_unit", waypoints:[{x,y,t_s}], reaches_opp: bool}`
     where `reaches_opp` is true if any waypoint lands within `OPP_BASE_RADIUS` of
     `spatial.opp.base_centroid` (lets the renderer label "scout reached enemy base at MM:SS").
  4. Returns `None` (no layer drawn) if no qualifying unit — never fabricate a route.

- **`army_push_vectors(ops, me_number, spatial) -> list[dict]`** — *heuristic*.
  1. Take **military-movement** ops (`MOVE`/`ATTACK_GROUND`/`PATROL`/`DE_ATTACK_MOVE`/`ORDER` with
     `len(object_ids) > MIN_GROUP`, default 3 — a group move, not a single villager) after the early
     window.
  2. Bin by time (config `PUSH_BIN_S`, default 120s) and average the destination `(x,y)` per bin to
     a push centroid. For each bin produce a vector **from `spatial.me.base_centroid` → push
     centroid**, tagged with the dominant `zone` (reuse #1's centroid-based zone classifier:
     near-own / center / near-opp).
  3. Emit `[{t_start_s, t_end_s, from_xy, to_xy, zone, n_commands, tier:"heuristic"}]`. `n_commands`
     is the count of commands in the bin (a crude intensity proxy for stroke weight) — **explicitly
     not a unit count**, named `n_commands` so it can never be mislabeled as army size.

### Derived annotation layer (from spatial + engagements, no new op mining)

- **`annotations(spatial, engagements, scout, pushes) -> list[dict]`** — assembles the human-readable
  arrow/label layer the renderer draws, each with `kind` ∈
  `{scout_route, army_push, attack_on_building, engagement_zone, forward_marker, wall, base}`, a
  `tier`, geometry (point / polyline / vector / segment / circle), and a short `label`
  (e.g. `"scout → enemy base 2:40"`, `"army push → center 22:00"`,
  `"treb on enemy Castle 31:10"`, `"engagement (heuristic) — center 24:00"`). Attack-on-building
  annotations come straight from `engagements[].building_targets` (exact); engagement-zone circles
  from `engagements[].centroid_xy` (heuristic).

### `MapGeometry` shape

```
{
  "map":     {name, size_tiles, extent:{minX,minY,maxX,maxY}},  # extent = bbox over all drawn coords + margin
  "me":      {color_role:"me", base_centroid:[x,y],
              buildings:[{name,x,y,t_s}], forward:[{name,x,y}], walls:[{x,y,x_end,y_end}]},
  "opp":     {color_role:"opp", base_centroid:[x,y], buildings:[{name,x,y}]},   # key buildings only (#1)
  "scout_route":  {object_id, tier, waypoints:[{x,y,t_s}], reaches_opp} | null,
  "army_pushes":  [{t_start_s, t_end_s, from_xy, to_xy, zone, n_commands, tier}],
  "annotations":  [{kind, tier, geom, label, t_s?}],
  "legend":  [{layer, tier, swatch}],   # drives both the PNG legend strip and #5's web legend
}
```

Every coordinate is in **AoE2 tile units** (the native `BUILD`/`MOVE` coordinate space). `extent` is
the auto-fit bounding box (mirrors #5's `fitMapViewBox`). All functions **guard missing/zero coords**
(skip a building with `x==0 and y==0`, return empty layers rather than raise) — same discipline as
#1's spatial guards.

## When to render (trigger scope — Nam's call)

Rendering is **engagement-triggered, not one static whole-game image.** Combat/skirmish is the
moment a map earns its thousand words, so the renderer keys off #1's `engagements`:

- **One macro map per significant detected engagement window** — the bases + buildings/walls as the
  fixed backdrop, plus the arrows/vectors active in that window (army pushes into the zone, scout
  presence, attacks on known buildings). Macro only (per the honesty boundary — no unit-vs-unit
  micro).
- **Plus one whole-game overview map** (build layout + scout route + all engagement zones) for
  orientation.
- Significance filter (avoid one map per stray click): an engagement window qualifies if it has ≥ a
  threshold of committed units / attack-orders or targets a building — calibrated on the real recs.
- The coach (#4) receives the overview always, and the per-engagement maps for the windows it's
  discussing — fed into its workspace; it Reads the relevant one(s) on demand (progressive
  disclosure, same spirit as the reference library).

## Renderer: `mapviz/render.py` (geometry → annotated PNG)

Keep the geometry pure and **isolate all imperative drawing here.** `render.py` takes a `MapGeometry`
dict and writes a PNG; it contains no game logic, only coordinate transforms + drawing calls.

**Player color convention (Nam's call, program-wide): ME = blue, OPP = red** — fixed, regardless of
in-game player colors, matching the #5 web viz so "blue is you" is instant for the coach reading the
image.

- **Library:** **Pillow** (`PIL.ImageDraw`). Rationale: it draws lines/polygons/text to a raster with
  no display server, no SVG-rasterizer toolchain, and no heavyweight scientific stack — the map is
  schematic (squares, line segments, arrows, a legend strip), not a chart. (matplotlib is heavier and
  pulls a backend; an SVG→PNG path needs cairosvg/a headless browser. Pillow is the lightest fit and
  is trivially pip-installable. **Open decision** if a font/AA limitation bites — but the shapes here
  are simple enough that Pillow is the call.) A small TrueType font is bundled or the PIL default is
  used for labels.
- **Coordinate transform** (`tile_to_px`): map `extent` (tile bbox) → an N×N pixel canvas (config
  `CANVAS_PX`, default 900) with a fixed margin, **preserving aspect ratio** (square AoE2 maps stay
  square; letterbox otherwise). One pure helper, unit-tested independently of any drawing
  (`tile_to_px(x, y, extent, canvas_px, margin) -> (px, py)`).
- **Orientation:** AoE2's `(x,y)` increases toward the bottom-right of the played map; the engine
  renders it diamond-rotated, but a **square axis-aligned schematic is the honest and simplest
  choice** (we are not reproducing the in-game diamond camera — that's cosmetic and risks implying
  precision we don't have). Note the orientation in the legend ("schematic, north = low y"). Flip y
  for image space (image y grows downward) inside `tile_to_px` so the picture matches intuition.
- **Map size handling:** `size_tiles` comes from the rec where available; if absent, the canvas is
  sized purely from the data `extent` (auto-fit) — the map is *relative*, which is all the coach
  needs ("forward building is 80% of the way to the enemy"), not absolute tile grid lines.
- **Layer draw order (back → front):** faint grid/backdrop → walls → buildings (me = a chosen accent,
  opp = muted) → forward-building rings → base-centroid markers → engagement-zone circles (dashed,
  heuristic) → army-push arrows (dashed = heuristic) → scout route polyline → attack-on-building
  arrows (solid = exact) → labels → **legend strip** along the bottom.
- **Honesty in pixels (mirrors #5's tier treatment):** **exact** layers = solid strokes, full
  opacity; **heuristic** layers = **dashed** strokes, reduced opacity, and the word "(heuristic)" in
  their label. The legend strip names every drawn layer and its tier, so the agent sees the
  provenance *in the image itself*, not just in prose.
- **Guards:** empty geometry (no buildings) → render a near-empty canvas with a "no spatial data"
  label rather than crash; a `None` scout route simply omits that layer.

Entry point: `render_map(geometry: dict, out_path: str) -> str` (writes PNG, returns path). A
convenience `build_map(reconstruction, ops, out_path)` composes `geometry.*` then `render_map`.

## Coach integration (#4)

#7 plugs into #4's `build_workspace` (the per-match temp dir). After #4 writes `facts.json` etc., it
also calls `build_map(reconstruction, ops, workspace/"strategic_map.png")` and writes a short
**`map_legend.md`**:

```
<workspace>/
  facts.json
  salient.log
  candidates.md
  references/
  strategic_map.png      # NEW — the annotated strategic map (this spec)
  map_legend.md          # NEW — one-paragraph legend + the exact/heuristic disclaimer
  TASK.md
```

- **`map_legend.md`** restates the honesty boundary in words the agent must echo: which layers are
  exact (buildings, walls, forward, attacks on known buildings), which are heuristic (scout-unit
  identity, army-push vectors, engagement zones), and that **the map shows operational movement and
  pressure, not unit-vs-unit combat** — the agent must not describe micro the map can't show.
- **`COACH_SYSTEM_V2` (in #4) gains a short clause:** "A `strategic_map.png` is in your cwd. **Read
  it** to see base layout, walls, forward buildings, the scout's opening route, army-push directions,
  and where fights clustered. Treat dashed/heuristic layers as approximate and never describe
  unit-vs-unit combat — the map shows where forces *moved and pushed*, not who beat whom. See
  `map_legend.md`." (Exact wording owned by #4; this spec supplies the constraint.)
- **Multimodal-read assumption — FLAG TO VERIFY.** The whole feature rests on the installed
  `claude_bin` actually **reading a PNG when the agent `Read`s it** (vision-capable model +
  image-supporting `Read` tool in `-p` mode). This is the same "verify against the installed CLI"
  posture #4 already takes for permission flags. **Verification step (pin at implementation):** run
  `claude -p "Describe strategic_map.png"` with `--allowedTools Read` in a workspace containing the
  PNG and confirm the response references *drawn content* (e.g. mentions the legend text or a
  building cluster). If the binary is `klaude`/OpenRouter-on-a-text-only-model and **cannot** see
  images, the map degrades cleanly: the PNG is still written (for #5/web + debugging), `map_legend.md`
  stays, and **`facts.json` already carries every coordinate** — so the coach loses the *picture* but
  loses **no facts**. #7 must therefore be **strictly additive** to #4: never the sole source of any
  datum, only a perception aid.

## Shared geometry for #5 (frontend viz)

`MapGeometry` is the contract #5's web minimap consumes. #5 already plans `fitMapViewBox`,
`mapCoordToSvg`, and tier-driven solid/dashed strokes (`tierStroke`) — those map 1:1 onto this
object's `extent`, tile coords, and per-layer `tier`. Concretely:

- **#5 reuses the *vectors*, renders its own SVG** (interactive, accent-themed) rather than embedding
  the PNG. The PNG is for the agent (a flat image it can see); the browser gets the structured
  geometry and draws live SVG with hover/tooltips — same numbers, two presentations.
- The new `scout_route` and `army_pushes` layers are a **free enrichment** for #5's V1 building-map:
  it can overlay the opening scout polyline and push arrows on its minimap, with the same
  exact/heuristic styling. #5's spec already gates only on #1; this adds optional layers it can pick
  up once #7 ships.
- **Where the geometry is computed:** in `aoe2coach` (this package), persisted by nam-website
  alongside `reconstruction` (e.g. a `map_geometry` key inside the existing
  `reconstruction` JSONField, or a sibling — decided with #5's persistence). The PNG itself is a
  build artifact for the coach workspace and is **not** persisted to the DB (it's regenerable from
  geometry, and #5 doesn't need it).

## Scheduling

Ships **with #4**, in the same iteration — not deferred to the #5 "maybe later" bucket. The map's
reason to exist is improving coach quality, so it is wired into the coach workspace as part of #4's
rollout. #5's reuse of the geometry is a later, free pickup.

## Testing

`aoe2coach` stays pure + offline-testable; ruff line-length 120; PostToolUse ruff hook strips
not-yet-used imports.

- **Geometry pure-function tests on synthetic ops** (dicts faithful to `mgz.fast.parse_action`
  shapes, per house convention):
  - `scout_route`: synthetic early `MOVE`s for one `object_id` ranging away from base → returns that
    id with ordered waypoints and `reaches_opp` correct; a villager-like jitterer near base is **not**
    picked; no qualifying unit → `None` (never fabricates).
  - `army_push_vectors`: grouped military `MOVE`s in two time bins → two vectors from base centroid to
    the right push centroids, correct `zone`, `n_commands` counts; single-unit moves excluded.
  - `annotations`: given a `spatial`+`engagements` fixture, asserts every `building_target` becomes an
    exact `attack_on_building` annotation and every zone becomes a heuristic circle; **no annotation
    is emitted for any unit-vs-unit interaction** (there is no input that could produce one — a
    structural guarantee, asserted by the absence of such a `kind`).
  - `tile_to_px`: pure transform — corners of `extent` map to canvas corners (minus margin), aspect
    ratio preserved, y flipped; guards `extent` of zero area.
- **Fidelity test** (bytes → `mgz.fast.parse_action`) confirming `MOVE`/`ORDER`/`ATTACK_GROUND`
  carry `object_ids` + `x` + `y` as assumed (so synthetic fixtures can't drift from reality).
- **Real-rec render + visual-by-description sanity check** on the calibration game
  `aoe2coach-analysis/game.aoe2record`: run `build_map(...)`, then assert *structural* properties of
  the geometry (non-empty buildings for both players, a scout route present, ≥1 push vector, attack
  annotations matching `engagements.building_targets`) and that `render_map` writes a non-trivial PNG
  (file exists, > a size floor, decodes via Pillow to the expected canvas dimensions). The
  human/visual confirmation ("does the picture look like the game") is a manual eyeball of that
  rendered PNG during implementation — described, not asserted pixel-wise.
- **No-fabrication test:** assert the geometry contains **no** layer kind outside the allowed set, and
  that no function emits live counts or combat outcomes (the `army_push` field is `n_commands`, never
  `n_units`; no `kind == "combat_micro"` exists in the codebase).
- **Render isolation:** geometry tests need no Pillow; only `render.py`'s few tests import it
  (keeps the heavy import out of the pure layer and lets geometry tests run if Pillow is absent).

## Open decisions to flag

1. **Multimodal read against the installed binary** — *the* gating assumption. Confirm `claude -p`
   + `Read` actually ingests the PNG as vision; if the configured `claude_bin`/model can't, #7 stays
   additive (facts unaffected) and the PNG becomes a web-only artifact. (Shares #4's "verify the CLI"
   posture.)
2. **Renderer library** — Pillow is the recommendation (lightest, no backend). Revisit only if label
   quality / anti-aliasing proves inadequate for legibility at `CANVAS_PX`; SVG→PNG (cairosvg) is the
   fallback if so.
3. **Scout-unit heuristic robustness** — "most-moved early single-selected unit ranging from base"
   is a heuristic; validate the picked `object_id` on the calibration rec looks like the real scout.
   If it misfires often, either tighten (require `reaches_opp` or a min range) or **drop the scout
   layer rather than draw a wrong route** (honesty > coverage).
4. **Opp-side detail** — #1 stores only opp **key buildings**; the map's opp side is sparse by
   design. Confirm that's acceptable (it is honest — we genuinely have little opp spatial data).
5. **Geometry persistence shape** — sub-key of `reconstruction` vs sibling field; resolve jointly
   with #5's persistence section (purely a storage detail).
6. **Time framing on the static map** — v1 renders an end-state map with time *labels* on
   arrows/route ("→ enemy base 2:40"). A multi-frame / time-slider PNG set is out of scope (parallels
   #5's static-first decision); flag as a possible fast-follow only if the agent struggles to read
   time from labels.

## What this sub-project deliberately does NOT do

- **No unit-vs-unit / tactical combat rendering.** No "skirms vs spears", no troop icons clashing, no
  flank arrows between armies, no per-unit casualties. We have no live unit positions and no enemy
  composition during fights — drawing it would be fabrication. The map is operational, full stop.
- **No live state on the map** — no live army size, no "units alive here", no resource overlay. (#1
  proved deaths/live-counts are engine-only.)
- **No enemy unit tracking** — we only see *our own* selected `object_ids`; opponent unit movements
  are not recoverable, so no enemy scout route, no enemy push arrows.
- **No new game facts** — #7 renders #1's `spatial`/`engagements` plus two new *movement traces* over
  the same ops; it does not estimate resources (#2), classify the build (#3), or invent anything not
  in the command stream.
- **No tileset / game-art map** — a clean schematic (squares, lines, arrows, a legend), matching #5's
  "schematic, not a CaptureAge pixel replica" decision. Art licensing + weight, and a pretty replica
  would imply precision we don't have.
- **Not a hard dependency of the coach** — strictly additive perception aid. If the binary can't see
  images, the coach still has every coordinate in `facts.json`; it just loses the picture.

## Relationship to #1 / #4 / #5

- **#1 (Reconstruction core)** — the **data source**. #7 consumes `spatial` (buildings, walls,
  forward, base_centroid) and `engagements` (zones, building_targets) verbatim, and mines the same
  raw `ops` for the two new movement traces (scout route, army pushes). #7 adds **no** new field to
  `Reconstruction` itself; it produces a separate `MapGeometry` derived from it.
- **#4 (Coach v2)** — the **consumer**. #7 writes `strategic_map.png` + `map_legend.md` into #4's
  workspace and adds the "Read the map" clause to `COACH_SYSTEM_V2`. Ships in the same iteration as
  #4. Degrades cleanly if the binary can't read images.
- **#5 (Frontend viz)** — **shares the geometry**. #5 renders its own interactive SVG from the same
  `MapGeometry` (scout route + push arrows become optional overlays on its V1 minimap), reusing its
  planned `fitMapViewBox` / `mapCoordToSvg` / `tierStroke` helpers. #5 stays "maybe later"; #7's
  geometry is ready for it whenever it lands.
