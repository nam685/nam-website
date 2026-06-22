# AoE2 Coach — Economy Model (Design Spec)

**Date:** 2026-06-22
**Status:** Draft for review
**Scope:** Sub-project #2 of the "coach = preprocessing + AI" program — the Tier-B economy estimate layer.
**Program overview & feasibility map:** `aoe2coach-analysis/5_feasibility_and_design.md`
**Consumes:** the `Reconstruction` object from sub-project #1
(`docs/superpowers/specs/2026-06-22-aoe2-reconstruction-core-design.md`).

## Why

A replay is a **command log, not a state log**: the engine never writes resource stockpiles, gather
rates, or villager-per-resource counts into the file, and (confirmed) the end-game Statistics screen
is *not* embedded. So if the coach wants to say anything about economy — "you were over-collecting
wood", "your gold income stalled in Castle" — it must **estimate** it from the assignment commands
plus known gather rates. This sub-project is that estimator. Everything it emits is an `~estimate`
and is labeled as such; #1 stays purely exact.

## The hard feasibility problem (investigated on the real rec)

The original design assumed `WORK` ops (131k in the old save-64.3 rec) as the villager→resource
assignment firehose. **On the user's current patch this signal is gone.** Verified directly on
`game.aoe2record` (save 68.0 / patch 48086):

```
$ parse_rec(...).ops  →  Counter of action types:
  MOVE 1873  DE_QUEUE 743  ORDER 726  BUILD 290  GATHER_POINT 258
  DE_TRANSFORM 141  RESEARCH 77 ... WORK: 0
```

So the assignment signal must be rebuilt from the **sparse** right-click/gather-point ops. What I
actually found when I dug into them:

### Signal 1 — `GATHER_POINT` (+ `DE_MULTI_GATHERPOINT`)

258 total / **126 for ME (player 1)**. Fields: `{player_id, target_id, target_type, x, y,
object_ids, sequence}`. But **101 of ME's 126 carry `target_type == -1`** (a gather point set to bare
ground, not onto a resource), leaving only **25 ME gather-points with a resolvable resource target.**
`DE_MULTI_GATHERPOINT` (6 ops, all OPP here) has no `target_type` at all.

### Signal 2 — `ORDER` (right-click), the larger signal

387 ME `ORDER` ops. `ORDER` has `target_id` (but **no** `target_type`). Joining `target_id` against
the starting gaia object table (below), **89 ME `ORDER`s land on a starting-gaia resource object** —
i.e. a villager was right-clicked directly onto a sheep / tree / mine. Combined with the 19 joinable
gather-points:

> **~108 resource-assignment events for ME across the full 58-minute game.** Real signal, but two
> orders of magnitude thinner than `WORK` was, and front-loaded (players re-click vils mostly in the
> dark/feudal eco set-up, then leave them).

### The join that makes resource classification possible (key finding)

`mgz.fast.header.parse` does **not** expose a top-level gaia/objects list — but it *does* expose
`header["players"][0]` as **GAIA** (player `number == 0`, `civilization_id == 96`) carrying
**`objects`: 4560 starting map objects**, each `{class_id, object_id, instance_id, position, index}`.

- `object_id` == the `target_type` value seen on `GATHER_POINT` (verified: for joinable gather-points
  `gaia.object_id == op.target_type` in 19/19 cases).
- `instance_id` == the runtime object id that both `GATHER_POINT.target_id` *and* `ORDER.target_id`
  reference (verified: the join lands).
- `class_id` cleanly separates the resource families on this rec:

  | class_id | count | meaning | resource |
  |---|---:|---|---|
  | 20 | 1710 | trees (`object_id` 1902) | **wood** |
  | 70 | 54 | forageable wildlife (sheep/boar/deer/llama: ids 305, 822, 1963, 285, …) | **food (hunt/forage)** |
  | 10 | 2794 | mixed: berry-bush-like (1053, n=99), gold/stone mine piles (66, 102 — small clustered counts), shore/extra trees | **food (berries) / gold / stone / wood** |
  | 30 | 2 | relics (id 69) | (not eco) |

  Class 10 needs a small **curated `object_id → resource` map** (gold-mine ids → gold, stone-mine
  ids → stone, berry ids → food, shore-tree ids → wood) calibrated against this rec; class 20/70 are
  unambiguous. `target_type` values that resolve to *player buildings* (Mill 68, Lumber Camp 562,
  Mining Camp 584, Archery Range 87…) are **drop-points, not resources** — ignore them as
  assignment signal.

### Feasibility verdict

**A trustworthy *continuous* villager-per-resource time series is NOT possible on save 68.0.** ~108
sparse, front-loaded assignment events cannot track ~107 villagers reassigned dozens of times across
58 minutes; the per-second eco split would be mostly interpolation, and the integrated
resources-collected total would compound error badly in late game (no postgame number to re-anchor
against). Presenting either as a number would violate the program's HARD RULE.

**What IS honestly deliverable (the fallback this spec commits to):**

1. **Coarse eco-split *snapshots* at age boundaries** (Dark→Feudal→Castle→Imperial transitions, from
   `Reconstruction.ages`): "around Feudal landing your tasked vils were ~roughly 60% wood / 30% food /
   10% gold (from N assignment events in that window)." Labeled `~estimate`, always with N exposed so
   thin windows self-disclose.
2. **An eco *shape/narrative*, not totals**: which resource the player committed to first, when gold
   mining started, whether food shifted from hunt→berries→farms (farms are inferred from `Farm`
   `BUILD` ops + `Horse Collar`/`Heavy Plow` techs, which #1 already has exactly).
3. **A *bounded* resources-collected estimate, clearly an estimate** (§ Resources-collected), emitted
   **only** when it lands inside the validation band (below). If it doesn't, the model **suppresses
   the number** and emits only the qualitative shape. Never a bare number presented as fact.

This is a downgrade from the original "vils-per-resource curve + collected totals" ambition, and the
spec says so plainly. The exact, trustworthy economy facts (Farm builds, all eco-tech timings, eco
APM share) live in #1 already; #2 adds *estimated allocation*, flagged, on top.

## Architecture

Code lands in the standalone **`aoe2coach`** package, pure functions over the same
`ops: list[(clock_ms, action_type, data)]` plus the parsed **gaia objects** and the `Reconstruction`
object. No Django/DB/network. New modules:

- **`gaia.py`** *(new)* — `gaia_objects(header) -> dict[instance_id, GaiaObj]` and
  `resource_class(gaia_obj) -> "food"|"wood"|"gold"|"stone"|None`. Wraps the curated
  `object_id → resource` map + `class_id` fallback. Pure; never raises on unknown ids (returns
  `None`). **Requires** the parser to surface the GAIA `objects` list — see Dependency on #1.
- **`econ.py`** *(new)* — the estimator. Pure functions:
  - `assignment_events(ops, player, gaia) -> list[AssignEvent]` — fuse `GATHER_POINT` (target_type
    direct) and `ORDER` (target_id→gaia join), drop `target_type == -1`, drop building targets,
    classify each to a resource. Each event = `{t_s, resource, n_vils}` where `n_vils =
    len(object_ids)` (the group size in that command — an approximation of how many vils that click
    moved).
  - `eco_split_steps(events) -> list[StepPoint]` — a **step function** of estimated vils-per-resource:
    each event updates the running allocation; between events the split is held constant (the known
    drift source). Exposed with `confidence` = events-in-window, never as a smooth curve.
  - `eco_split_at_ages(steps, ages) -> dict[age, {food, wood, gold, stone, n_events}]` — the coarse
    snapshots (the primary deliverable).
  - `collected_estimate(steps, recon) -> dict[resource, {value, low, high}] | None` — gather-rate
    integration (§ below), returns `None`/suppressed when out of band.
- **`rates.py`** *(new)* — base DE gather rates per resource + the upgrade multipliers, applied as a
  time-keyed multiplier schedule built from `Reconstruction.techs` (eco). Pure lookup tables +
  `rate_at(resource, t_s, recon)`.

`econ` consumes `Reconstruction` for ages, eco-tech timings, and `villagers_produced` (as an upper
bound / sanity ceiling); it does **not** recompute anything #1 already emits.

## Gather rates & upgrade model (`rates.py`)

Villagers gather at known base rates; eco upgrades multiply them. **The exact DE rates must be
web-confirmed at implementation time** (authoritative: aoe2techtree / the fandom wiki gather-rate
page) and pinned in a table with the source URL in a comment — do not hardcode from memory. The model:

```
estimated_resource(R) = Σ over time windows [ vils_on_R(window) × base_rate(R) × mult(R, t) ] · dt
```

Upgrade multipliers keyed off `Reconstruction.techs` timings (all exact):
- **Wood:** Double-Bit Axe, Bow Saw, Two-Man Saw.
- **Food (farm):** Horse Collar, Heavy Plow, Crop Rotation.
- **Gold:** Gold Mining, Gold Shaft Mining.
- **Stone:** Stone Mining, Stone Shaft Mining.
- **All (carry/walk):** Wheelbarrow, Hand Cart (capacity + move speed → effective throughput bump).
- Food sub-rates differ by *source* (sheep vs boar vs berries vs farm); the assignment classifier only
  knows "food", so collected-food uses a blended food rate and is the **least trustworthy** of the
  four (flag accordingly).

## What's exact vs estimated, and how it's labeled

| Field | Status | Source |
|---|---|---|
| Eco-tech timings, Farm/Mill/Camp build times, eco APM share | **exact** | `Reconstruction` (#1) |
| Which resource committed first; gold-mining start; hunt→farm shift | **exact-ish** (event timestamps are exact; the *interpretation* is heuristic) | assignment events + builds |
| Vils-per-resource split at an age boundary | **`~estimate`** + `n_events` | `eco_split_at_ages` |
| Continuous vils-per-resource curve | **not emitted** | — |
| Resources collected (per resource) | **`~estimate` with `[low, high]` band, or suppressed** | `collected_estimate` |

Labeling rule (matches the program HARD RULE): every estimated value is a dict carrying an explicit
`estimate: true`, a `confidence` (event count in the supporting window), and for collected totals a
`[low, high]` range — never a bare scalar. The serializer for #4 must refuse to flatten these into
plain numbers. Keys for estimates carry an `_estimate` suffix where a scalar shape is unavoidable.

## Validation methodology (the calibration loop)

Ground truth for the calibration game (Nam's end-game screenshots, **nom**):

| | total |
|---|---:|
| **Resources collected** | **63,808** |
| Wood | 28,079 |
| Food | 24,658 |
| Gold | 12,686 |
| Stone | 4,474 |
| Villagers (max alive) | 107 |

Methodology:
1. Run `collected_estimate` on `game.aoe2record`, compare per-resource and total to the screenshot.
2. **Acceptable error band: ±15% per resource AND ±10% on the grand total** — a deliberately loose
   band because this is a trend tool, not an accountant. (Rationale: with ~108 assignment events the
   split is coarse; tighter than ±15% would be false precision.) Wood/gold/stone are expected to land
   closer than food (blended-rate problem).
3. **If a resource is outside its band:** the model **suppresses that resource's number** and emits
   only the qualitative shape for it. If the total is outside ±10%, suppress all collected totals and
   fall back to age-boundary splits only.
4. The age-split snapshots are validated *qualitatively* against the screenshot's resource-share and
   the player's actual unit production (e.g. heavy Skirmisher/Battle-Elephant production ⇒ food+gold
   commitment should show in the split). No numeric ground truth exists per-age, so this stays
   "directionally correct," not scored.
5. This game becomes calibration sample #1. The id→resource map (`gaia.py`) and the rate table
   (`rates.py`) are tuned **once** against it; **subsequent Nam-screenshotted games are held-out
   validation** — tuning must not chase them or the band is meaningless. Target: green band on ≥3
   held-out games before the coach (#4) is allowed to *cite* a collected number rather than just the
   shape.

**Calibration data on hand (4 resource-collected points, see `aoe2coach-analysis/calibration.md`):**
Game 1 `game.aoe2record` (nom Vietnamese): W28079/F24658/G12686/S4474 + opp. Game 2
`game2.aoe2record` (nom Burgundians): F22140/W17058/S4155/G17891 + opp Flip
F17865/W12992/S2419/G6654. Tune on game 1 (nom); hold out game 2 + both opponents. Both games are
save 68.0 — so both exercise the sparse-`GATHER_POINT` path the model must survive.

**Per-TC gather points (Nam's note):** a player with 3 Town Centers can set 3 different gather
points, so villager→resource assignment is **per-TC, not global** — the model must track each TC's
gather target separately (new villagers from TC #2 may go to a different resource than TC #1's).
Tie each `GATHER_POINT`/initial assignment to its issuing TC `object_id` and resolve resource per
TC; collapsing them into one stream would mis-split the eco. Same applies to the auto-assignment of
freshly-produced villagers (they walk to their TC's gather point).

## Testing

- **Synthetic-ops unit tests** for `assignment_events`, `eco_split_steps`, `eco_split_at_ages`,
  `rate_at`, `collected_estimate` — dicts faithful to the real `mgz.fast` shapes verified here
  (`GATHER_POINT` with `target_type` incl. the `-1` case; `ORDER` with `target_id`+`object_ids`;
  synthetic gaia table with `class_id`/`object_id`/`instance_id`).
- **Fidelity test** (bytes → `mgz.fast`) confirming `GATHER_POINT` carries `target_type`, `ORDER`
  carries `target_id`, and `header["players"][0].objects` carries `class_id`/`object_id`/`instance_id`
  — so synthetic fixtures can't drift from reality, and so a future patch dropping these surfaces as a
  failing test (mirrors #1's `WORK`-vanished lesson).
- **Real-rec validation test** against `game.aoe2record`: assignment-event count ≈ 108 for ME;
  resource classes resolve (no all-`None`); `collected_estimate` total within ±10% of 63,808 *or* the
  test asserts the suppression path fired. This is the gate, not a pass/fail on the number alone.
- Ruff clean (line-length 120). The PostToolUse ruff hook strips not-yet-used imports.

## Open decisions to flag for the user (product-level — do not invent answers)

1. **Is the coarse-snapshot fallback acceptable for the coach's value?** Given that a continuous curve
   isn't honest on this patch, is "eco split at age-ups + narrative shape" enough economy signal to be
   worth shipping, or should #2 be **deferred** until/unless a `WORK`-bearing patch returns?
2. **`n_vils` semantics:** count `len(object_ids)` per command as the moved-vil count, or treat each
   assignment as a single binary "this resource is now being worked"? The former is noisier but
   richer; the latter is safer. (Affects how the split is weighted.)
3. **Error band width** (±15%/±10%) — Nam to confirm this is the right honesty/usefulness tradeoff
   before it's baked into the suppression logic.
4. **Farm-food handling:** infer farm count from `Farm` `BUILD` ops and assume N farmers, or leave
   food collected as the explicitly-least-trustworthy number? (Farms are the dominant late-food source
   and have *zero* `GATHER_POINT`/`ORDER` re-click signal once seeded.)
5. **Does the coach get to cite a collected *number* ever, or only the shape?** Recommend: only after
   ≥3 held-out games land green; until then, shape only.

## What this model deliberately does NOT do

- No **continuous** vils-per-resource curve (signal too sparse on save 68.0) — only age-boundary
  snapshots.
- No **per-villager tracking** / individual idle-villager economy (runtime object ids aren't stable
  across the join and vils are reassigned silently).
- No **true stockpile / floating-resource** estimate (would need engine simulation — Tier C, out of
  scope program-wide).
- No **opponent** economy estimate beyond what the OPP assignment events trivially allow (OPP's
  screenshots aren't available, so OPP eco cannot be validated → emit ME only, or OPP shape with a
  loud "unvalidated" flag — defer to #4).
- No **exact** economy facts — those are #1's job; #2 only adds the flagged estimates on top.

## Relationship to sub-project #1

#1 (`Reconstruction`) is the exact backbone; #2 is the only place in the program that emits economy
**estimates**, and it consumes #1 rather than re-deriving anything. #1 already flagged the version risk
this spec resolves ("`WORK` absent on 68.0 → economy model must use `GATHER_POINT`"); the investigation
here confirms that and adds `ORDER` + the gaia-object join as the recovered signal path. **Dependency
to land in #1 (or a thin shared parser change):** `parse_rec` / the parsed-rec object must surface the
GAIA `objects` list (`header["players"][0]["objects"]`) and per-player `position`, which #1's parser
reads but does not currently expose. Flag this as a prerequisite edit to the #1 parser before #2 starts.
