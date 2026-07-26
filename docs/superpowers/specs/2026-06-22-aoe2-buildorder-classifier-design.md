# AoE2 Coach — Build-Order Reference Library + Deterministic Classifier (Design Spec)

**Date:** 2026-06-22
**Status:** Draft for review
**Scope:** Sub-project #3 of the "coach = preprocessing + AI" program.
**Program overview & feasibility map:** `aoe2coach-analysis/5_feasibility_and_design.md`
**Consumes:** the `Reconstruction` object from sub-project #1
(`docs/superpowers/specs/2026-06-22-aoe2-reconstruction-core-design.md`).
**Ground truth:** Hera's strategy guide (25 named build orders, `hera-strategy-guide-2025-04`).

## Why

Today the coach (Sonnet) eyeballs the log, *guesses* the opening, then judges timing against a
benchmark it half-remembers — so it picks the wrong build and then grades it against bogus targets.
Two fixes, both from Nam:

1. **Progressive disclosure, not prompt-flooding.** We do NOT paste 25 builds into the coach prompt.
   Each Hera build becomes a small, structured, retrievable **reference file** that the coach
   (sub-project #4) reads ON DEMAND once it has a hypothesis. This spec defines those files + the
   library, not the coach loop — but it defines the contract #4 relies on.
2. **Deterministic pre-narrowing.** A pure function reads the early-game signals already present in
   `Reconstruction` (first vil distribution, first buildings, first military unit, age timings,
   dark-age vil count at the Feudal click) and emits **1–3 candidate builds with confidence**,
   shrinking the search before the agent verifies. The classifier never *forces* a label — off-meta
   games degrade to "unknown / closest-N".

This spec is **data + one pure module**. No coach prompt, no Django, no network.

## What this is NOT (boundaries)

- **NOT the coach loop.** Hypothesize → read reference → judge-vs-verified-targets is sub-project #4.
  We hand #4 a candidate list and a retrieval contract; we do not call `claude -p`.
- **NOT new reconstruction.** We consume `Reconstruction` fields verbatim. If a signal we want isn't
  in #1's object, we flag it as an Open Decision for #1 — we do **not** re-parse the rec here.
- **NOT a win-prediction / "was this good" judge.** Classification answers *"which build is this?"*,
  never *"was it executed well?"* (that's #4, against the reference's verified targets).
- **NOT economy estimates.** We use only EXACT fields from #1 (ages, techs, production, milestones,
  spatial, idle). Per-resource vil splits from #2 are *optional future inputs* (see Open Decisions),
  not required — the v1 classifier works without #2.

## Part A — The reference-file library

### A.1 Format & location

- **Format: YAML**, one file per build. Rationale: the Hera tables are human-authored and
  human-audited (Nam transcribes from the PDF), YAML diffs cleanly in review, comments are allowed
  for transcription notes, and it loads to plain dicts for the matcher. JSON loses comments and is
  noisier to hand-edit; Markdown isn't machine-checkable for signatures.
- **Location:** ship as package data inside `aoe2coach`:
  ```
  aoe2coach/
    buildorders/
      __init__.py          # load_library() -> dict[str, BuildOrder]; load_one(build_id)
      _schema.py           # dataclasses + validate(); pure, no I/O beyond the yaml files
      data/
        scout-rush-1-stable.yaml
        scouts-into-archers.yaml
        scouts-into-cav-archers.yaml
        maa-into-skirms.yaml
        generic-maa-rush.yaml
        feudal-drush.yaml
        archers-1-range.yaml
        fast-castle-generic.yaml
        fast-castle-into-knights.yaml
        knight-rush.yaml
        drush-fast-castle.yaml
        ... (one per encoded Hera build)
        _index.yaml         # ordered list + display metadata for the whole library
  ```
  This keeps "data lands in `aoe2coach`, pure functions" (CLAUDE.md). nam-website bumps its git pin
  to pick up the library; it never reaches into the files directly.

### A.2 Per-build schema

Each YAML file represents ONE Hera build. The schema separates three concerns:
**identity/metadata**, **the human-readable build steps** (for #4 to read and cite), and the
**machine-checkable `signature`** (the only part the deterministic classifier reads).

```yaml
id: scouts-into-archers              # stable slug == filename stem; never renamed
name: "18 Vils Scouts into Archers"  # Hera's exact title
source:
  guide: "hera-strategy-guide-2025-04"
  page: 10                            # PDF page where the table lives
family: scouts                        # one of the generic openings (see A.3)
recommended_civs: [Chinese, Huns, Malians, Portuguese]   # from Hera; civ-tolerant matching (A.3)
summary: >
  Open scouts, then transition to archers in Feudal. Flexible: heavy Feudal + bloodlines,
  or save for a faster Castle crossbow timing.

# --- Age targets: BOTH the click (research started) and the arrival (research done). ---
# Hera gives "perfect landing time" = ARRIVAL. Arrival = click + AGE_RESEARCH_MS (#1's constant).
age_targets:
  feudal:   { arrival_s: 530, vils_at_click: 18 }   # "perfect landing 8:50"
  castle:   { arrival_s: null }                       # build doesn't pin a castle time
  imperial: { arrival_s: null }

# --- Per-age economy split: villager counts by resource, as Hera lists them on age rows. ---
# Hera's table columns are F W G S (food/wood/gold/stone) + total. null where the build is silent.
eco_split:
  dark_age:  { food: null, wood: null, gold: 0, stone: 0, total: 18 }
  feudal:    { food: 9,    wood: 9,    gold: 0, stone: 0, total: 18 }   # post-up redistribution
  castle:    { food: null, wood: null, gold: null, stone: null, total: null }

# --- Ordered, human-readable steps (verbatim-ish from the Hera table). #4 reads + cites these. ---
# Not parsed by the classifier. `phase` groups for readability; `pop`/`vils` optional where Hera gives them.
steps:
  - { phase: dark_age, vils: 6,  task: "Send 6 villagers to sheep", pop: 6 }
  - { phase: dark_age, vils: 1,  task: "Send 1 villager to boar", pop: 9 }
  - { phase: feudal,   task: "Make a stable, start scouts" }
  - { phase: feudal,   task: "Add an archery range, transition to archers" }
  # ... full table transcribed ...

# --- "What's next?" branches: how the build forks after it ends. Used by #4 for forward advice. ---
whats_next:
  - "All-in Feudal: keep adding farms + scouts, get bloodlines + forging/cav armor"
  - "Save for Castle Age crossbow timing"
  - "Castle: crossbow + a few knights to counter skirms/siege"

# --- MACHINE-CHECKABLE SIGNATURE — the ONLY block the deterministic classifier reads. ---
signature:
  # First military PRODUCTION building expected (maps to Reconstruction.spatial military buildings
  # and milestones.first_military_building). Ordered by expected appearance.
  first_military_buildings: [Stable, "Archery Range"]
  # First military UNIT type the build trains (Reconstruction.production milestones.first_unit_s).
  first_military_unit: ["Scout Cavalry"]        # list = acceptable set (civ aliases handled in A.3)
  # Later-but-defining unit that distinguishes this build from its siblings.
  defining_units: [Archer]                       # scouts-into-archers MUST show archers, else it's a pure scout rush
  # Feudal arrival band (seconds). [lo, hi] inclusive. Derived from Hera target ± tolerance (A.4).
  feudal_arrival_band_s: [490, 580]              # 8:10–9:40 around the 8:50 target
  # Optional castle band; null when the build doesn't commit to a castle time.
  castle_arrival_band_s: null
  # Dark-age vil count at the Feudal CLICK (Reconstruction villagers_produced at age click time).
  vils_at_feudal_click: { target: 18, band: [16, 20] }
  # Buildings that, if present early, RULE THIS BUILD OUT (negative evidence).
  excludes_buildings: [Castle]                   # a Castle before ~castle age contradicts a Feudal rush
  # Age path fingerprint: which ages this build reaches "fast" vs deliberately delays.
  age_path: feudal_rush                          # one of: feudal_rush | fast_castle | drush_fc | fast_imperial | boom
```

**Design notes on the signature:**
- The signature is intentionally a **small set of EXACT-derivable facts** — every field maps to a
  field that #1's `Reconstruction` already emits (ages, milestones, production, spatial). No field
  asks for an estimate or a live count.
- `first_military_unit` and `defining_units` are **lists / acceptable sets**, not single ids, so one
  reference file covers civ variants (a Briton "archers" and a Mayan "archers" both train `Archer`;
  unique-unit substitutions are normalised in A.3).
- Bands, not points. Hera's "perfect landing" is a *target*; real games land late. The classifier
  scores distance-into-band, it does not require an exact hit (A.4).

### A.3 Library scope & the civ-generic mapping

**Encode-first subset (high value, covers the common 1v1 Arabia ladder + the calibration game).**
These ten span every age-path and military class a classifier must disambiguate:

| Build (Hera title) | family | age_path | why first |
|---|---|---|---|
| 18 Vils 1-Stable Scouts | scouts | feudal_rush | the canonical scout open |
| 18 Vils Scouts into Archers | scouts | feudal_rush | scout→archer transition (calibration-relevant) |
| 18 Vils Scouts into Cavalry Archers | scouts | feudal_rush | scout→CA, distinct defining unit |
| 18 Vils Generic Modern Man-at-Arms Rush | maa | feudal_rush | the MAA baseline |
| 19 Vils Man-at-Arms Into Skirms | maa | feudal_rush | MAA→skirm, very common |
| 18 Vils Feudal Drush | drush | feudal_rush | 3-militia drush |
| 19 Vils 1-Range Archers | archers | feudal_rush | straight archers |
| 18 Vils Korean Spear Skirm Rush | trash | feudal_rush | trash/no-gold open |
| 25+4 Vils Knight Rush | knights | fast_castle | the FC→knights baseline |
| 27+2 Vils Drush Fast Castle | drush_fc | drush_fc | drush then FC, distinct fingerprint |

Plus a generic **Fast Castle** (`fast-castle-generic`) abstracted from the several FC variants
(FC-on-Fortress, FC-Boom, FC-into-UU, FC-Light-Cav-Relic) — they share one early fingerprint
(no Feudal military, late Feudal click, fast Castle) and only diverge in "what's next", which the
reference captures as branches. **Process to add the rest:** one PR per remaining Hera build,
transcribing the table into the schema + filling the `signature`, validated by the schema validator
and a synthetic-ops test (Part C). The classifier needs no code change to absorb a new file — it
discovers the library at load time.

**Civ-specific → generic.** Hera lists civ-specific builds (Georgians Healing Scout Rush, Japanese
MAA, Korean Spear-Skirm, Cuman 2-TC, Ethiopian 2-range, Chinese Fast Feudal, Malay, Armenian,
Turk Fast Imperial, etc.). Two rules:
1. If the civ-specific build is just a *generic opening with a civ's eco quirk* (e.g. Chinese Fast
   Feudal ≈ a faster generic Feudal, Japanese MAA ≈ generic MAA), **fold it into the generic file**
   and note the civ tweak in `whats_next` / a `civ_notes` map — do not create a near-duplicate file.
2. If it is *structurally distinct* (Cuman 2-TC boom, Turk Fast Imperial — a unique age_path),
   give it its own file with `recommended_civs` constrained.
   `recommended_civs` is **soft evidence only** — a Hun player doing scouts-into-archers still
   matches even though Huns aren't in some lists. Civ never hard-excludes a candidate; it only
   nudges confidence (A.4). The classifier reads `Reconstruction.meta.my_civ` and normalises unique
   units to their generic class (e.g. a Briton Longbowman counts as `Archer`-class for
   `defining_units`) via a small `UNIT_CLASS` map added to `const.py`.

### A.4 Tolerance / band derivation (documented, not magic numbers)

- **Arrival bands** are `[target − 40s, target + 50s]` by default (rushes land late more often than
  early; FC builds tolerate wider). Stored per-build so an editor can widen Fortress/closed-map
  builds. The band is **soft**: scoring is distance-into-band (1.0 inside, linear falloff to 0 over
  one extra band-width outside), never a hard gate — a 10:05 Feudal still scores against an 8:50
  target, just lower.
- `vils_at_feudal_click.band` defaults to `target ± 2`.
- These are **data, in the YAML**, so calibration tweaks are reviewable diffs, not code edits.

## Part B — The deterministic classifier

### B.1 Module

`aoe2coach/classify.py` — pure functions over a `Reconstruction` dict (no I/O except reading the
YAML library once via `buildorders.load_library()`).

```python
def classify(recon: dict, library: dict | None = None) -> ClassificationResult: ...
```

`ClassificationResult` (JSON-serializable dataclass):

```python
@dataclass
class Candidate:
    build_id: str          # "scouts-into-archers"
    name: str              # "18 Vils Scouts into Archers"
    confidence: float      # 0.0–1.0, calibrated score (B.3)
    matched_signals: list[str]   # human-readable: ["first unit=Scout Cavalry", "feudal 9:34 in band"]
    missed_signals: list[str]    # what didn't match: ["no Archer seen yet"]

@dataclass
class ClassificationResult:
    candidates: list[Candidate]      # 1–3, sorted desc by confidence; may be empty-ish (see unknown)
    is_confident: bool               # top candidate >= CONFIDENT_THRESHOLD and clear of #2
    unknown: bool                    # True when no candidate clears MIN_THRESHOLD → "off-meta"
    notes: list[str]                 # e.g. "off-meta: feudal military but castle before 15:00"
```

### B.2 Signals consumed (all EXACT, all from `Reconstruction` #1)

| Signal | Reconstruction source | Used for |
|---|---|---|
| Feudal/Castle/Imperial arrival_s | `ages.*_arrival_s` | arrival bands, `age_path` |
| Feudal click_s | `ages.feudal_click_s` | vils-at-click cutoff |
| villagers_produced at feudal click | `counts.villagers_produced` filtered by `production` ≤ click_s | `vils_at_feudal_click` |
| first military building + type | `production.milestones.first_military_building_s` + `spatial.me.buildings` | `first_military_buildings` |
| first military unit type | `production.milestones.first_unit_s` (first non-Villager) | `first_military_unit` |
| defining units present | `production.produced_units` (set of names, normalised via UNIT_CLASS) | `defining_units` |
| early Castle/Krepost/Donjon | `spatial.me.buildings` | `excludes_buildings` |
| my_civ | `meta.my_civ` | soft civ nudge |

The classifier computes one derived fact first — the **`age_path` fingerprint** — from arrivals:
`feudal_rush` (Feudal military building before Castle arrival), `fast_castle` (no Feudal military +
Castle < ~17:00), `drush_fc` (early Barracks + a few militia, then fast_castle pattern),
`fast_imperial`, `boom` (multiple TCs early, no early military). This single fingerprint does most of
the pre-narrowing; signatures then disambiguate within a fingerprint group.

### B.3 Algorithm

```
1. Build the observed early-game snapshot from recon (B.2). Compute age_path fingerprint.
2. Hard-filter the library by negative evidence ONLY:
   - drop builds whose `excludes_buildings` are present early
   - drop builds whose `age_path` is incompatible with the observed fingerprint
     (e.g. observed fast_castle drops every feudal_rush build)
   This is the cheap pre-narrowing — usually leaves a handful.
3. Score each surviving build on a WEIGHTED sum of soft matches (each 0..1):
     w_unit(0.30)  first_military_unit in signature set
     w_def (0.20)  defining_units all present (or partial credit)
     w_bld (0.15)  first_military_buildings order/presence
     w_feud(0.20)  feudal arrival distance-into-band
     w_vils(0.10)  vils_at_feudal_click distance-into-band
     w_civ (0.05)  my_civ in recommended_civs (soft nudge only)
   confidence = sum(weight*match). Weights are module constants, documented, tunable.
4. Rank; keep top 3 with confidence >= MIN_THRESHOLD (default 0.35).
5. Decide outcome:
   - if NOTHING clears MIN_THRESHOLD  -> unknown=True, candidates = closest-N by raw score
        with a note explaining the mismatch (graceful degrade, never force a label).
   - if top >= CONFIDENT_THRESHOLD (0.70) AND top-second gap >= 0.15 -> is_confident=True.
   - else is_confident=False (the agent must verify between the candidates).
6. Always attach matched_signals / missed_signals per candidate so #4 can reason transparently.
```

**Graceful degradation is a hard requirement.** If a player does something off-meta (e.g. tower rush,
a hybrid, a build not in the library), `unknown=True` and we return the *closest* builds with an
honest note ("feudal military seen but Castle landed 14:30 — between feudal_rush and fast_castle").
We **never** emit a single high-confidence wrong label. This directly fixes the current failure mode.

### B.4 Determinism

`classify()` is pure and order-stable: same `Reconstruction` → same result, tie-breaks by `build_id`
ascending. No randomness, no clock, no network. This is what lets #4 trust it as a pre-narrowing
gate rather than re-deriving the build itself.

## Part C — Contract for sub-project #4 (the coach)

#4 receives the `ClassificationResult` (serialized into the facts block) and uses it like this:

1. **Read `candidates`** (1–3, with confidence + matched/missed signals). This is the hypothesis
   set — #4 does NOT re-guess from raw logs.
2. **Retrieve a full reference on demand** via the documented path:
   `aoe2coach/buildorders/data/<build_id>.yaml` — exposed through
   `buildorders.load_one(build_id) -> dict`. #4's agent reads this file (it has file tools) to get
   the full step list, age targets, eco splits, and `whats_next`. **This is the progressive
   disclosure**: only the candidate file(s) enter the agent's context, never the whole library.
3. **Judge against the reference's verified targets**, not memory: compare observed
   `ages.feudal_arrival_s` to the reference `age_targets.feudal.arrival_s`, observed eco to
   `eco_split`, etc. Cite the build by `id` + `source.page`.
4. **Handle `unknown=True`**: when set, #4 narrates "this doesn't match a standard build; closest
   are X/Y" and coaches from first principles, never forcing the closest label as if confirmed.

The contract surface #4 depends on is small and stable: `ClassificationResult` shape (B.1),
`load_one(build_id)` returning the schema dict (A.2), and the file path convention. Anything else in
this sub-project is free to change.

## Part D — Testing

- **Schema validation test:** every YAML in `data/` loads, passes `_schema.validate()` (required
  keys, band ordering lo≤hi, `age_path` enum, `first_military_unit` names resolve via `const`).
- **Synthetic-`Reconstruction` fixtures → expected candidates.** Hand-build minimal `Reconstruction`
  dicts (reusing #1's test convention) for each encoded build's "textbook" execution; assert the
  matching build is the top candidate and `is_confident` where it should be. One fixture per build.
- **Negative / off-meta fixtures:** a tower-rush-ish and a hybrid fixture → assert `unknown=True` and
  a sensible closest-N + note. A pure-scout fixture must NOT be classified as scouts-into-archers
  (no `Archer` in `defining_units`) — guards the sibling-disambiguation.
- **Determinism test:** classify the same fixture twice, assert identical `ClassificationResult`.
- **Calibration-game golden test.** Run the classifier on the calibration `Reconstruction`
  (Vietnamese "nom", Arabia, Feudal **9:34** / Castle **20:55** / Imperial **40:23**, military =
  **skirmishers + scouts + battle elephants**). Expected: the observed Feudal-military-then-slow-
  Castle pattern with scouts + skirms should surface **scout/skirm feudal-rush** candidates (e.g.
  Scouts-into-Archers / Korean-Spear-Skirm family by signal overlap), NOT a fast-castle/knight build,
  and NOT a single over-confident label given the unusual battle-elephant tech switch. The assertion
  is on **plausibility + honesty** (correct family in candidates, fast_castle excluded, no false
  high-confidence), since "nom" is partly off-meta — this is exactly the graceful-degrade path.
- Ruff clean, line-length 120. Pure functions; YAML loaded once, no per-call I/O in hot paths.

## Open decisions to flag for Nam

1. **Does #1 expose every signal B.2 needs?** Specifically `villagers_produced` filtered to the
   Feudal-click time, and `first_military_building` *with its building type/name* (the #1 spec lists
   `first_military_building_s` as a timestamp). If #1 only emits the timestamp, we need it to also
   surface the building name — **a request back to #1**, not something this sub-project should
   re-derive. Flagging rather than assuming.
2. **Eco-split matching (needs #2).** The reference files store Hera's per-resource vil splits, but
   v1 of the classifier does NOT score against them (it has no observed eco split without #2's
   `WORK`/`GATHER_POINT` model, which is itself flagged unreliable on save 68.0). Decision: ship the
   eco_split as reference data for #4 to read, but keep it out of the classifier weights until #2 is
   trusted. Confirm.
3. **Transcription effort.** Encode the 10-build subset now (Part A.3) and add the remaining ~15 via
   one PR each, or transcribe all 25 up front? Recommend the subset first — it covers the ladder and
   the calibration game, and the add-process is zero-code.
4. **Band defaults.** Are `[−40s, +50s]` arrival tolerance and `±2` vils sensible starting points, or
   does Nam want to calibrate them against a few real recs before committing the numbers to YAML?
5. **Confidence thresholds** (`MIN 0.35`, `CONFIDENT 0.70`, gap `0.15`) and signal weights (B.3) are
   first guesses — should be tuned once we have a handful of classified real recs. Flag as
   calibration-pending.

## Relationship to #1 / #2 / #4

- **#1 (Reconstruction core)** is the sole input. We consume its exact fields; we ask it (Open
  Decision 1) to surface first-military-building *name* and vils-at-click if not already present.
- **#2 (Economy model)** is an *optional future* input (eco-split scoring); v1 does not require it.
- **#4 (Coach v2)** is the sole consumer, via the small contract in Part C. The reference files and
  the candidate list are the progressive-disclosure mechanism that lets #4 fact-check on demand
  instead of being flooded.
