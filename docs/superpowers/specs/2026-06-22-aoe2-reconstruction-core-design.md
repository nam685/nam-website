# AoE2 Coach — Reconstruction Core (Design Spec)

**Date:** 2026-06-22
**Status:** Draft for review
**Scope:** Sub-project #1 of the "coach = preprocessing + AI" program.
**Program overview & feasibility map:** `aoe2coach-analysis/5_feasibility_and_design.md`
(raw/denoised log dumps + the calibration game live in that folder).

## Why

The coach today receives a thin, partly-misleading summary and a denoised event log, then
*guesses* the build order and judges against half-remembered benchmarks — producing wrong builds
and bogus timing. The fix is to make **preprocessing do the analysis** and hand the AI honest,
structured facts. This spec is the foundation: a deterministic **`Reconstruction`** object that
captures everything *exactly* derivable from the command stream. Estimates, build classification,
and the new coach prompt are later sub-projects (#2–#4) that consume this object.

**Hard rule: this core emits only EXACT, command-derived facts.** No estimates, no fabricated
numbers, no over-time "live" curves. Cumulative counts are labeled `produced` (see Validation).

### Honesty-tier glossary (program-wide, anchored here)

The whole program labels every datum by how much it can be trusted. Three tiers, named once here so
every downstream spec speaks the same language:

| Tier | Meaning | Aliases used downstream |
|---|---|---|
| **`exact`** | deterministically derived from the command stream; trustworthy as a number | (no alias) |
| **`estimate`** | derived from a model over sparse signals; trend-true, number-shaky; never asserted as fact | `~estimate` / `~est` (#2/#5), `needs-#2` (#6, when the estimate isn't trusted yet) |
| **`unavailable`** | engine-only; not recoverable from a replay; shown as an explained gap, never faked | — |

#2 (`~estimate`), #5 (`exact`/`est`/`unavailable`), #6 (`exact`/`heuristic`/`needs-#2`), and #7
(`exact`/`heuristic`) all use names that map onto these three tiers — `heuristic` is a kind of
`estimate` (timing/location inferred, not measured). This core emits **only `exact`** facts; the
estimate tier begins at #2.

## Validation against ground truth (calibration game)

Game: **Vietnamese (nom) vs Incas (Be_Kaiser)**, Arabia, ranked 1v1, 58:01
(`aoe2coach-analysis/game.aoe2record`; end-game stat screenshots provided by Nam).

| Signal | Parser computed | In-game (CaptureAge) | Verdict |
|---|---|---|---|
| Feudal arrival | 9:34 | 9:34 | exact |
| Castle arrival | 20:53 | 20:55 | exact (±2s, research-timer rounding) |
| Imperial arrival | 40:23 | 40:23 | exact |
| Villagers | 126 *queued* | 107 *max alive* | **queued ≠ live** → label `produced` |
| Army | ~246 *produced* | 53 *army high* | **produced ≠ live** → label `produced` |
| APM | 35 | (far higher) | current APM under-counts → recompute |

**Takeaways baked into this spec:**
1. Age/tech/build *timings and events* are exact and trustworthy → the core's backbone.
2. Any *count* from production commands is `produced` (cumulative queued), an upper bound on live
   counts. The core labels it as such and does **not** emit live counts or over-time curves
   (deferred to the estimate sub-project #2).
3. APM must be a real action-rate, split eco vs military, not the current build/research/queue tally.

## Data facts (game version: save 68.0 / patch 48086 — Nam's current build)

Verified field shapes from the calibration rec (humans = player_id 1 & 2):

| Action | Fields used | Notes |
|---|---|---|
| `BUILD` | `building_id, x, y, t` | 185 ME / 105 OPP. Coords present & reliable. |
| `WALL` | `x, y, x_end, y_end, building_id, t` | wall segments. |
| `DE_QUEUE` | `unit_id, amount, t` | **the** unit-production signal on this patch. |
| `RESEARCH` | `technology_id, t` | ages + all techs. |
| `GATHER_POINT` | `target_id, target_type, x, y, t` | assignment signal (sparse) — for #2, not this core. |
| `DELETE` | `object_ids, t` | self-deletes only (no combat deaths). |

> ⚠️ **Version risk (flagged for #2, not this core):** save 68.0 recs contain **zero `WORK` ops**
> (older save 64.3 had 131k). The economy model (#2) planned to mine `WORK` for villager→resource
> assignment; on the current patch it must use the much sparser `GATHER_POINT` instead. The
> reconstruction core does not depend on `WORK`, so it is unaffected — but the parser's fidelity
> across game versions needs an explicit check before #2.

## Architecture

All code lands in the standalone **`aoe2coach`** package (pure functions over
`ops: list[(clock_ms, action_type, data)]`, no Django/DB/network). nam-website later bumps its git
pin. New/modified modules:

- **`spatial.py`** *(new)* — `base_centroid(ops, player)`, `buildings(ops, player)` list,
  `forward_buildings(...)` (military buildings beyond `FORWARD_DIST` from own centroid),
  `walls(ops, player)` segments. All guard missing/zero coords (never raise).
  **`spatial.opp` includes `base_centroid`** too — computed the same way (centroid of the
  opponent's own `BUILD` coords); this is approximate but feasible from data we already read, and
  #5/#7 hard-require it. Only opponent-relative **frontal vs flank** building classification stays
  **deferred** (it needs the opponent's *start* position, not just its build centroid; calibrate on
  a real rec later).
- **`timeline.py`** *(extend existing)* — keep age clicks+arrivals; add **military/university tech**
  timelines (new `const` maps); surface production commands and **milestones** (first-of-each
  military unit, first military building, first siege, first treb).
- **`efficiency.py`** *(new)* — `tc_idle(...)` (villager-queue gaps over threshold),
  `apm(...)` (real per-minute action rate over **all** ME actions), `apm_split(...)`
  (eco vs military). Classification basis: **eco** = villager `DE_QUEUE`, eco-building `BUILD`,
  eco-tech `RESEARCH`, `GATHER_POINT`, market `BUY`/`SELL`; **military** = non-villager `DE_QUEUE`,
  military-building `BUILD`, military/university-tech `RESEARCH`, army `MOVE`/`ATTACK_GROUND`/
  `STANCE`/`PATROL`/`DELETE`/`ORDER`/`DE_ATTACK_MOVE`; everything else uncategorized but still
  counted in `apm_total`.
  Counts exposed are labeled `produced`.
- **`population.py`** *(new)* — `housing_capacity(ops, player)`: the **exact** pop-room curve from
  `BUILD` (House +5, Town Center +5, Castle +20), clamped at the 200 game cap; `maxed_at_s` (when
  capacity first reaches 200); `housed_flags` (heuristic: capacity plateaus below 200 during active
  production → "possible housed moment", best-effort); `attrition_floor` (= total `produced` − 200,
  a loose lower bound on units lost/deleted, framed as a floor not a count). **Civ caveat:** Huns
  need no houses (free pop room) — guard with a per-civ rule; unknown civs fall back to the standard
  model and the curve is flagged approximate.
- **`combat.py`** *(new)* — `engagements(ops, me, opp, spatial)`: detect **fights, not casualties**.
  Two sources: (a) **exact** — attack-type commands (`ORDER`/`ATTACK_GROUND` with a `target_id`
  matching a known OPP *building* id from `BUILD`) → "attacked opp's <building> at T"; (b)
  **heuristic** — attack/attack-move commands clustered by time + location, classified by zone
  using both base centroids (own + opp). **`zone` is a pinned enum — exactly
  `own_base | center | opp_base`** (#7 reuses these exact values verbatim for its zone classifier).
  Output: list of
  `{t_start_s, t_end_s, zone, centroid_xy, my_units_committed, building_targets}`. Detects
  engagement timing/location/intensity only — never who died. Unit-ownership of arbitrary spawned
  ids is unknown, so non-building targets are inferred spatially and flagged.
- **`reconstruct.py`** *(new)* — `reconstruct(rec) -> Reconstruction`: the assembler that ties the
  modules into one JSON-serializable object. This is the single artifact downstream sub-projects
  consume.
- **`const.py`** *(extend)* — add `MILITARY_TECHS`, `UNIVERSITY_TECHS`, `SIEGE_UNIT_IDS`,
  `tech_name()`; `MILITARY_BUILDINGS` already exists. Ids are best-effort (aoe2techtree),
  validated against the calibration rec.

`compute_metrics` stays (back-compat for current nam-website), derived from / coexisting with
`Reconstruction` so nothing breaks while #4 migrates the coach over.

## The `Reconstruction` object (shape)

JSON-serializable dict (or dataclass with `.to_dict()`). Per-player where it makes sense
(`me` / `opp`). Sketch:

```
{
  "meta":       {map, duration_s, my_civ, opp_civ, result, is_ranked, opp_rating},
  "ages":       {feudal_arrival_s, castle_arrival_s, imperial_arrival_s,  # exact
                 feudal_click_s, ...},
  "techs":      {eco:[{name, t_s}], military:[{name, t_s}], university:[{name, t_s}]},  # ME; OPP key only
  "production": {produced_units:[{name, unit_id, amount, t_s}],            # ME, "produced" = queued
                 milestones:{first_military_building_s, first_siege_s, first_treb_s,
                             first_unit_s:{name:t_s},                      # map of EVERY unit's first-trained time
                             first_military_unit_s, first_military_unit_name}},  # earliest non-villager (see note)
  "counts":     {villagers_produced, army_produced:[{name, amount}]},      # LABELED produced, not live
  "spatial":    {me:{base_centroid, buildings:[{name,x,y,t_s}], forward:[...], walls:[...]},
                 opp:{base_centroid, ... key buildings ...}},   # opp.base_centroid approx from opp BUILD coords
  "efficiency": {tc_idle_s, longest_villager_gap_s, villager_gaps_s,
                 apm_total, apm_eco, apm_military},
  "population":  {housing_capacity:[{t_s, cap}], maxed_at_s,            # cap curve EXACT (civ caveat)
                  housed_flags:[{t_s}], attrition_floor},               # flags heuristic; floor = loose
  "engagements": [{t_start_s, t_end_s, zone, centroid_xy,              # fights DETECTED, not casualties
                   my_units_committed, building_targets:[{name,t_s}]}], # zone enum: own_base|center|opp_base
}
```

**`first_unit_s` vs first-military-unit:** `first_unit_s` is a map `{name: t_s}` of when *each*
unit type was first trained (villagers included). #3's classifier and #4's coach read a single
scalar "first military unit." The core therefore also exposes the derived
`first_military_unit_s` + `first_military_unit_name` = the earliest non-villager entry of
`first_unit_s` (consumers must not re-derive it; this keeps #3/#4 wording consistent and
unambiguous).

Exact fields are unmarked. Estimate-adjacent / inferred values are explicitly marked: `*_produced`
counts carry the word `produced`; `population.housed_flags` + `attrition_floor` are heuristic/loose;
`engagements` describe fights **detected** (timing, location, intensity), never casualties. No field
is a fabricated number, and nothing claims a kill/death count.

## What this core deliberately does NOT do

- No over-time **live** curves (pop/vil/army), **live army size, or true K/D** — deaths are
  engine-only (verified: the rec body carries no kill signal, only an opaque per-tick state
  checksum). `engagements` detect *that* fights happened, not outcomes.
- No **resource** estimates (`WORK` absent on current patch) → sub-project #2.
- No **build-order classification** or Hera reference library → sub-project #3.
- No **coach prompt** changes / facts-block wiring → sub-project #4 (will serialize this object).
- No **frontend** visualization → sub-project #5.

## Testing

- **Synthetic-ops unit tests** for every extractor, with dicts faithful to `mgz.fast.parse_action`
  shapes (existing convention in `tests/`).
- **Fidelity tests** (bytes → `mgz.fast.parse_action`) for any newly consumed action
  (`BUILD` coords, `WALL`, `GATHER_POINT` target fields) so synthetic fixtures can't drift from
  reality.
- **Real-rec golden test** against `game.aoe2record`: age arrivals within ±3s of the known values
  (9:34 / 20:55 / 40:23); building counts ≈ 185 ME / 105 OPP; `villagers_produced ≥ 107`.
- **`const` id validation** on the real rec: common military/university techs resolve to names
  (no `#id`); extend maps if any do.
- Ruff clean (line-length 120). Note the PostToolUse ruff hook strips not-yet-used imports.

## Relationship to the existing `phase2-enrich` plan

This core **supersedes and absorbs** Tasks 1–6 of
`docs/superpowers/plans/2026-06-22-aoe2coach-phase2-enrich.md` (military/university tech maps,
milestones, villager-idle metrics, forward-building detection, the facts assembler), reframing
them as the single `Reconstruction` object and **adding** the spatial building map, wall segments,
and real eco/military APM. That plan's coach v2 (Task 7) becomes **sub-project #4**; its facts
block becomes a thin serialization of `Reconstruction`.

## Downstream consumer requirements (reconciled from the #2–#7 specs)

Breadth-first speccing of the later sub-projects surfaced concrete things the core must provide so
it remains the single contract everything builds on:

- **Starting GAIA objects (for #2 economy):** the parser must expose the header's starting object
  table — `header["players"][0]` is GAIA with ~4,560 objects carrying `class_id`/`object_id`/
  `instance_id`/position. #2 joins `GATHER_POINT`/`ORDER` target ids against it to classify a
  target as wood/food/gold/stone. Surface this on `ParsedRec` (e.g. `rec.gaia_objects`) — additive.
- **Build-classifier signals (for #3):** the `Reconstruction` must explicitly include
  **first military building** (name + `t_s`) and **villagers produced by feudal *click* time**
  (vils-at-click) — #3's deterministic classifier keys on both. Both are derivable from data the
  core already reads (spatial/production + age click); just expose them as named fields.
- **Serialization & persistence (for #4 coach, #5 frontend):** `Reconstruction` must be cleanly
  JSON-serializable. nam-website will persist it in a new additive `JSONField` on `Aoe2Match` and
  return it from the existing match-detail endpoint (shared #4/#5 work; not this package's job, but
  the shape must be stable and self-describing).
- **Mistake-detector inputs (for #6 knowledge base):** #6's deterministic detectors read exact
  fields this core already emits — confirm the core surfaces **`population.housed_flags`** (housing
  detection), **`spatial.walls`** (wall coverage), **`engagements`** (where fights clustered),
  alongside `efficiency.tc_idle_s`, `ages.*_arrival_s`, `techs.eco[]`, and `counts.villagers_produced`.
  No new field — just the guarantee these are present and stable for #6 to lint over.
- **Strategic-map inputs (for #7 map rendering):** #7 mines the same raw `ops` for movement traces
  but consumes two #1 fields directly and **hard-requires** them: the new **`spatial.opp.base_centroid`**
  (for opp-side layout + push-vector targets) and the pinned **`engagements[].zone` enum
  (`own_base | center | opp_base`)** which #7 reuses verbatim for its push-vector zone classifier.
  Both are now committed above (spatial.py / combat.py).

## Open / deferred decisions

- **Frontal vs flank** building classification — needs an opponent-start reference; calibrate on a
  real rec in a later pass.
- **Parser version fidelity** — confirm the parser handles save 64.3 *and* 68.0 (the `WORK`
  divergence) before building #2.
- **`Reconstruction` home for the coach** — whether #4 passes the whole object or a trimmed facts
  view to `claude -p` (decided in #4).
