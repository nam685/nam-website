# AoE2 Coach — Coaching Knowledge Base + Deterministic Mistake Detectors (Design Spec)

**Date:** 2026-06-22
**Status:** Draft for review
**Scope:** Sub-project #6 of the "coach = preprocessing + AI" program.
**Program overview & feasibility map:** `aoe2coach-analysis/5_feasibility_and_design.md`
**Consumes:** the `Reconstruction` object from #1
(`docs/superpowers/specs/2026-06-22-aoe2-reconstruction-core-design.md`).
**Reuses:** #3's progressive-disclosure retrieval mechanism
(`…/2026-06-22-aoe2-buildorder-classifier-design.md`).
**Feeds:** #4's agentic coach (`…/2026-06-22-aoe2-coach-v2-design.md`).

## Why

#3 tells the coach *which build this is*. It does not tell the coach *what went wrong*. Today the
coach is expected to spot mistakes by eyeballing facts — unreliable: it misses idle TC unless it
happens to do the arithmetic, and it sometimes asserts a mistake (floating resources) that the data
can't actually support. The fix mirrors the rest of the program: **distill common 1v1 mistakes from
authoritative sources into versioned, reviewable reference files, and detect them deterministically**
over #1's `Reconstruction`. The coach then receives a *flagged* list (linter-style, not LLM-noticed)
and pulls each mistake's full rubric entry — explanation, concrete fix, cited source — **on demand**
via the exact retrieval mechanism #3 already built.

Three firm decisions (Nam's calls), honored throughout:

1. **Curated once, offline — not runtime video-watching, not Claude agent-memory.** The KB is
   human-authored reference files in the repo, same spirit as #3's build refs. Sourcing = Hera video
   transcripts + written guides + community lists.
2. **Integration is BOTH a deterministic detector pass AND progressive disclosure**, not either/or.
   A pure detector pass flags which mistakes are *actually present*; the coach then retrieves the
   full entry for each flagged mistake on demand.
3. **Honesty tagging is program-wide.** Every detector is `exact` / `heuristic` / `needs-#2`. Shaky
   detections are flagged so the coach hedges and never asserts a low-confidence mistake as fact.

This spec is **data + one pure module**. No coach prompt (that's #4), no Django, no network.

## Part A — Sourcing method & honest feasibility

### A.1 Sources (authoritative, citable)

| Source | Type | Fetchable now? | Use |
|---|---|---|---|
| Hera coaching/"common mistakes" videos | YouTube transcript | **Partial** — see A.2 | mistake list + fixes, in his words |
| Hera strategy guide PDF (`hera-strategy-guide-2025-04`) | written, already transcribed for #3 | manual (PDF) | uptime targets, eco-upgrade timing |
| Steam community guides (e.g. "Noobs guide for AoE2") | HTML | **Yes** (verified fetchable) | concrete thresholds (idle-TC wood loss, floating, walling order) |
| AoE Library "Perfect Uptimes" | HTML table | **Yes** (verified fetchable) | age-arrival target bands per pop |
| Spirit of the Law videos | YouTube transcript | partial (A.2) | eco-upgrade ROI (e.g. Wheelbarrow needs ~14-16 farms) |
| r/aoe2 "biggest mistakes" threads | HTML | partial (search is flaky; direct URLs work) | taxonomy seeding / sanity check |

### A.2 Honest feasibility note (auto-fetch vs manual curation)

Verified during this spec's research:

- **Written guides are reliably auto-fetchable.** Steam guides and AoE Library returned clean,
  numeric content via `WebFetch` (the idle-TC "~982 wood by 8:40" figure, "~30% market loss",
  walling-order advice, and the per-pop uptime table all came straight out). These can seed and
  re-verify rubric entries semi-automatically.
- **YouTube transcripts are NOT plain-fetchable.** Fetching a `youtube.com/watch?v=…` page yields
  only nav/footer chrome — no caption text. Pulling Hera's spoken content needs the YouTube
  `timedtext` caption API or `yt-dlp --write-auto-sub`, run **offline as a one-time curation step**,
  not at runtime. Auto-captions are also noisy (mis-hears unit names) and need a human pass.
- **Conclusion:** sourcing is **semi-automated at best, and the rubric is fundamentally
  manually curated.** We use scripts to *gather raw material* (fetch guides, pull captions), but a
  human writes each entry, picks the threshold, assigns the confidence tier, and records the
  citation. This matches #3's "Nam transcribes the Hera PDF" model and is a feature, not a
  limitation: the rubric is small (~10-15 entries), high-leverage, and must be trustworthy. **No
  runtime fetching, no LLM memory.** The repo files are the single source of truth.

### A.3 Starter taxonomy (~12 common ranked-1v1 mistakes)

Each row becomes one rubric entry (Part B). Detector = the `Reconstruction` field(s) + condition;
tier per decision #3. `needs-#2` rows ship as **reference-only stubs** (entry exists, detector
disabled) until #2's economy estimate is trusted — they are honest about why.

| id | mistake | detector (over `Reconstruction`) | tier | source |
|---|---|---|---|---|
| `idle-tc` | TC sat idle (lost villager production) | `efficiency.tc_idle_s` over threshold (scaled by duration) | **exact** | Steam Noobs guide (982 wood/25s) |
| `long-vil-gap` | one long villager-production gap | `efficiency.longest_villager_gap_s` > threshold | **exact** | Steam Noobs guide |
| `slow-feudal` | slow Feudal uptime vs build target | `ages.feudal_arrival_s` vs #3 reference band | **exact** | AoE Library uptimes / Hera |
| `slow-castle` | slow Castle uptime | `ages.castle_arrival_s` vs band | **exact** | AoE Library uptimes |
| `slow-imperial` | slow Imperial uptime | `ages.imperial_arrival_s` vs band | **exact** | AoE Library uptimes |
| `late-loom-or-eco-up` | key eco upgrade late/missing (Wheelbarrow, Double-Bit Axe, lumber/mining camp ups) | `techs.eco[]` names + `t_s` vs age-relative deadlines | **exact** | Steam guide; SotL ROI |
| `too-few-villagers` | under-producing villagers for the game length | `counts.villagers_produced` vs pop-vs-time floor (produced is an upper bound → only flag when *below*, never when above) | **exact** | AoE Library; Villager wiki |
| `got-housed` | hit pop cap / housing plateau during active production | `population.housed_flags`, `population.maxed_at_s` | **heuristic** | Steam guide (constant farms) |
| `no-map-presence` | no forward/expansion buildings; everything hugging base | `spatial.me.forward` empty + few `engagements` in opp/center zones | **heuristic** | Steam guide (map awareness) |
| `leaky-or-late-walls` | walls absent or with gaps when under pressure | `spatial.me.walls` coverage vs `engagements` near own base; wall `t_s` | **heuristic** | Steam guide (wall after eco) |
| `walled-too-early` | walling before hitting Feudal/eco timing | earliest `walls[].t_s` before `ages.feudal_arrival_s` + heavy dark-age wall count | **heuristic** | Steam guide (eco first, then wall) |
| `floating-resources` | banked resources unspent (esp. Feudal) | requires #2 stockpile estimate | **needs-#2** | Steam guide (1000 wood floating) |
| `over-collecting-one-res` | eco skewed to one resource | requires #2 vils-per-resource split | **needs-#2** | Steam guide (eco balance) |

The two `needs-#2` rows are deliberately included so the rubric is *complete* as a knowledge base
while being *honest* that they can't be detected yet — exactly decision #3's spirit.

## Part B — The rubric reference library

### B.1 Format & location (consistent with #3)

YAML, one file per mistake, shipped as package data inside `aoe2coach`, under a **second namespace**
alongside #3's `buildorders/`:

```
aoe2coach/
  mistakes/
    __init__.py          # load_library() -> dict[str, Rubric]; load_one(mistake_id) -> dict
    _schema.py           # dataclasses + validate(); pure, no I/O beyond the yaml files
    detectors.py         # the named pure detector functions referenced by entries (B.3)
    data/
      idle-tc.yaml
      long-vil-gap.yaml
      slow-feudal.yaml
      slow-castle.yaml
      slow-imperial.yaml
      late-loom-or-eco-up.yaml
      too-few-villagers.yaml
      got-housed.yaml
      no-map-presence.yaml
      leaky-or-late-walls.yaml
      walled-too-early.yaml
      floating-resources.yaml      # needs-#2: detector disabled, reference-only
      over-collecting-one-res.yaml # needs-#2: detector disabled, reference-only
      _index.yaml                  # ordered list + display metadata
```

`load_one(mistake_id)` mirrors #3's `buildorders.load_one(build_id)` byte-for-byte in spirit — same
progressive-disclosure contract, different namespace. The coach (#4) reads exactly the entries that
were flagged, never the whole library.

### B.2 Per-entry schema

```yaml
id: idle-tc                          # stable slug == filename stem; never renamed
name: "Idle Town Center"
explanation: >
  Every second the TC isn't producing villagers is economy you never get back. Idling one
  villager's worth of time (~25s) early snowballs to ~1000 resources lost over a long game.
severity: high                        # low | medium | high — default weight on the coach's attention
confidence_tier: exact                # exact | heuristic | needs-#2  (decision #3)

# --- DETECTOR: precise enough to implement as a pure function over the Reconstruction. ---
# `fn` names a function in mistakes/detectors.py; `inputs` lists the Reconstruction paths it reads;
# `params` are the calibration knobs (data, not code — reviewable diffs, see B.4).
detector:
  fn: idle_tc                         # detectors.idle_tc(recon, params) -> Detection | None
  inputs: [efficiency.tc_idle_s, meta.duration_s]
  params:
    # tolerance scales with game length: allow base + per-minute drift before flagging.
    base_tolerance_s: 25
    per_minute_tolerance_s: 2.0       # e.g. 40min game tolerates 25 + 80 = 105s idle
  # Human-readable restatement of the condition (also a doc for reviewers):
  condition: "tc_idle_s > base_tolerance_s + per_minute_tolerance_s * (duration_s / 60)"

fix: >
  Bind all Town Centers to a hotkey and check them on a rhythm; queue 1-2 villagers when you
  can't babysit. Set a gather point on wood/food so new villagers auto-task.

source:
  ref: "steam-noobs-guide-2993319677"   # stable citation key (resolved in _index.yaml → URL/title)
  detail: "~982 wood lost from 25s idle by 8:40 in a 50-min game"
  study:                                 # USER-facing "learn more" material (not just a coach citation)
    url: "https://www.youtube.com/watch?v=...&t=412"   # deep link, video timestamp where useful
    title: "Hera — Top 10 mistakes (idle TC)"
```

**Study material is user-facing, not just a coach citation.** Every flagged mistake carries a
`source.study` link (a guide/video deep-link, timestamped where possible) so that when the user
sees the mistake they get material to consult and learn from. The frontend (#5) surfaces this as a
"learn more" link on each flagged mistake; the coach (#4) may also cite it inline.

Schema rules (enforced by `_schema.validate()`):
- `confidence_tier ∈ {exact, heuristic, needs-#2}`; `severity ∈ {low, medium, high}`.
- `detector.fn` must resolve to a function in `detectors.py`; `inputs` paths must be dotted paths
  that exist in #1's `Reconstruction` shape (validated against a shape manifest, see Part D).
- A `needs-#2` entry must set `detector.fn: disabled` (reference-only) — the schema *requires* it,
  so a stub can't accidentally run against absent data.
- `source.ref` must resolve in `_index.yaml`.

### B.3 Where the detector logic lives

Each `detector.fn` is a **pure named function** in `mistakes/detectors.py`:

```python
def idle_tc(recon: dict, params: dict) -> Detection | None: ...
```

Returning `None` = not flagged; returning a `Detection` = flagged (B.5 shape). The YAML names the
function and supplies `params`; the function does the arithmetic. This split keeps thresholds as
reviewable data (B.4) while detection logic stays unit-testable Python. A `needs-#2` entry's
`fn: disabled` is a no-op that always returns `None` and is skipped by the pass.

### B.4 Threshold definition & calibration

- **Thresholds live in the YAML `params`**, never hard-coded — same principle as #3's bands. Tuning
  is a reviewable diff, not a code edit.
- Defaults are seeded from the cited sources (idle-TC 25s base; eco-upgrade deadlines age-relative;
  uptime bands reused **directly from #3's reference files**, see B.6) and flagged
  **calibration-pending** until checked against a handful of Nam's real recs (the program's
  validation-set approach, overview §5).
- Thresholds **scale with game length** where relevant (idle tolerance grows per minute) so a 58-min
  game isn't flagged for the same absolute idle a 20-min game would be.

### B.5 The detector pass

`aoe2coach/mistakes/detect.py`:

```python
def detect_mistakes(recon: dict, library: dict | None = None) -> list[Flagged]: ...
```

```python
@dataclass
class Detection:               # returned by a detector fn when the mistake is present
    observed: dict             # the actual numbers ({"tc_idle_s": 142, "tolerance_s": 105})
    magnitude: float           # 0..1 how bad, for ranking (e.g. over-by / tolerance, clamped)

@dataclass
class Flagged:                 # one row in the pass output (JSON-serializable)
    id: str                    # "idle-tc"
    name: str
    severity: str              # from entry
    confidence_tier: str       # exact | heuristic | needs-#2  → coach hedging (Part C)
    observed: dict             # Detection.observed
    magnitude: float
    reference_path: str        # "mistakes/data/idle-tc.yaml" — #4 retrieves on demand
```

Algorithm:
```
1. Load the library once (load_library()).
2. For each entry whose detector.fn != disabled:
     - read the entry's `inputs` from recon; if ANY input path is absent/None
       (e.g. needs-#2 data missing, or #1 didn't emit a field) -> SKIP, add to `skipped` notes.
     - call detectors[fn](recon, params); if it returns a Detection -> emit a Flagged.
3. Sort Flagged by (severity rank desc, magnitude desc, id asc) — deterministic, tie-broken by id.
4. Return the list (possibly empty — "no detectable mistakes" is a valid, honest answer).
```

**Pure & deterministic:** same `Reconstruction` → same list. No randomness, no clock, no network —
the same guarantee #1/#3 give, which is what lets #4 trust it as linter output.

**Degrades when #2 data is absent (the common case on save 68.0):** `floating-resources` and
`over-collecting-one-res` are `fn: disabled`, so they never run and never false-flag. Even if a
future build re-enables them, the `inputs`-presence check in step 2 skips a detector whose required
field is missing rather than guessing — the pass silently drops `needs-#2` checks until #2 is wired,
and the coach is told (via the rubric entry's tier) that those dimensions weren't assessed.

### B.6 Reuse of #3's reference bands (no duplication)

The three uptime detectors (`slow-feudal/castle/imperial`) compare `ages.*_arrival_s` to a target
band. Those bands **already exist** in #3's matched build-order reference (`age_targets.*.arrival_s`
+ the band derivation in #3 §A.4). To avoid two sources of truth:

- `detect_mistakes` accepts an **optional `build_target` arg** (the matched build's age targets,
  passed by #4 after #3 classifies). When present, the slow-age detectors judge against *that build's*
  target band — "slow vs the build you actually played."
- When absent (no confident classification, or `unknown=True`), they fall back to a **generic
  per-pop uptime band** seeded from AoE Library, stored in `slow-feudal.yaml` `params` as a
  conservative default. This is honest: a generic late-Feudal flag, not a false "you missed *Fast
  Castle's* 8:50."

## Part C — Retrieval integration & the contract for #4

`detect_mistakes` runs in preprocessing (alongside #3's `classify`). Its output joins the facts the
coach receives. #4 uses it exactly like #3's candidates:

1. **Receive the `flagged` list** (serialized into the facts block / written into the workspace as
   `mistakes.json`, sibling to #4's `facts.json`/`candidates.md`). This is the linter result — the
   coach does **not** decide which mistakes exist; the pass already did, reliably.
2. **Retrieve each flagged entry on demand** via `mistakes.load_one(id)` →
   `mistakes/data/<id>.yaml`, copied into the workspace `references/mistakes/` (same copy-in pattern
   #4 uses for build references, so the agent's Read/Grep stay in-sandbox). **Only flagged entries'
   files enter context** — this is the progressive disclosure: explanation + fix + citation pulled
   per-flag, never the whole rubric.
3. **Narrate with the entry's `explanation`, advise with its `fix`, cite its `source`.** The coach
   never invents a fix or a number — it reads the entry it was handed, same as it reads a build
   reference. The detector already supplies `observed` (the actual numbers), so the coach states
   "TC idle 142s vs ~105s tolerated" with both the fact and the source backing it.
4. **Honesty-driven hedging (Part D below).** The coach phrases each flag according to its
   `confidence_tier`.

Contract surface #4 depends on (small, stable): the `Flagged` shape (B.5), `load_one(id)` returning
the schema dict (B.2), and the `mistakes/data/<id>.yaml` path convention. Everything else is free to
change. This is additive to #4's existing input contract — `mistakes.json` is a new sibling file; the
v1 / no-reconstruction paths are unaffected.

## Part D — Honesty tagging treatment

Decision #3 made concrete:

- **`exact`** — derived from #1's exact signals (idle TC, age arrivals, eco-tech timings, villager
  produced-count as a *lower-bound* check). The coach may state these **as fact**: "Your TC was idle
  142s."
- **`heuristic`** — inferred (housed flags, wall coverage, map-presence from forward buildings +
  engagement zones). The coach must **hedge**: "It looks like you may have been housed around 18:00"
  / "I don't see forward buildings or center fights, which usually means limited map presence."
- **`needs-#2`** — depends on the unreliable economy estimate (floating resources, over-collection).
  These **never fire** in the detector pass (`fn: disabled`), so the coach is never *handed* a
  shaky-as-fact flag. The rubric entries still exist as knowledge; #4 may *mention the dimension
  wasn't assessed* but must not assert it.

The `confidence_tier` rides on every `Flagged` row, and #4's system prompt gets one added rule:
*"Each flagged mistake carries a confidence_tier. State `exact` flags as fact with the number.
Hedge `heuristic` flags ('looks like'). Never assert a flag you weren't handed."* This is the
mechanism that stops the coach asserting a shaky mistake — the unreliable ones simply aren't in the
list, and the soft ones are labeled.

## Part E — Testing

- **Schema validation test:** every YAML in `data/` loads, passes `_schema.validate()` (tier/severity
  enums, `detector.fn` resolves in `detectors.py` or is `disabled`, `inputs` paths exist in the
  `Reconstruction` shape manifest, `source.ref` resolves in `_index.yaml`).
- **Per-detector unit tests:** for each enabled detector, a minimal synthetic `Reconstruction`
  (reusing #1's test convention) just over threshold → flagged, and just under → not flagged. Assert
  `observed`/`magnitude` values. One pair per detector.
- **`needs-#2` guard:** assert `floating-resources` / `over-collecting-one-res` are `fn: disabled`
  and never appear in `detect_mistakes` output even when given a full reconstruction.
- **Missing-input degradation:** a `Reconstruction` lacking a field a detector reads → that detector
  is skipped (noted), not raised; the rest of the pass still runs.
- **Determinism test:** run `detect_mistakes` twice on the same fixture → identical list, identical
  order.
- **Calibration-game golden test.** Run the pass on the calibration `Reconstruction` (Vietnamese
  "nom", Arabia, Feudal **9:34** / Castle **20:55** / Imperial **40:23**, very low real APM, reached
  Imperial very late). **Expected (plausibility + honesty, like #3's golden test):**
  - **Should surface:** `slow-castle` and/or `slow-imperial` (20:55 Castle and 40:23 Imperial are
    both late vs generic bands), and an idle/low-APM-driven `idle-tc` or `long-vil-gap` flag
    consistent with the low effective APM.
  - **Must NOT false-positive:** `too-few-villagers` (126 *produced* is an upper bound — the detector
    only flags *below* a floor, so a high produced count must never trip it), and no `needs-#2`
    flag (floating/over-collection) since #2 data is absent on save 68.0.
  - The assertion is on **the right flags present + the wrong ones absent**, not exact magnitudes
    (calibration-pending), matching the program's honesty bar.
- Ruff clean, line-length 120. Pure functions; library loaded once, no per-call I/O in hot paths.

## Open decisions to flag for Nam

1. **`needs-#2` entries: ship now or defer?** Recommend shipping them as reference-only stubs (entry
   + explanation + fix + citation, `fn: disabled`) so the KB is complete and honest about the gap.
   Confirm — vs. omitting them entirely until #2 is trusted.
2. **Generic uptime bands vs build-relative only.** B.6 falls back to a generic per-pop band when no
   confident build match exists. Acceptable, or should slow-age flags only fire when #3 gives a
   confident build (i.e. never flag "slow" without a known target)? The generic fallback is more
   useful but slightly less precise.
3. **Threshold seeds are calibration-pending.** idle base 25s, per-minute drift, eco-upgrade
   deadlines, too-few-vils floor — all first guesses from the cited guides. Tune against the same
   real-rec validation set the program already plans (overview §5)?
4. **Severity → coach attention.** Should `severity` drive ordering only, or also a hard cap (coach
   addresses top-N flags) to keep the report under #4's ~340-word budget? Recommend ordering +
   #4 picks the most impactful, since #4 already owns the word budget.
5. **Transcript pipeline.** Worth a small offline `yt-dlp`-based caption-pull helper to seed entries
   from Hera videos, or is hand-transcription (as with the #3 PDF) fine for ~12 entries? Recommend
   hand-curation for v1 — the rubric is small and the captions are noisy.

## What this sub-project deliberately does NOT do

- **Does not parse replays or compute facts** — that's #1 (`Reconstruction`). The pass only reads it.
- **Does not watch video or use LLM memory at runtime** — the KB is curated offline into repo files
  (decision #1). No network at detect time.
- **Does not classify the build** — that's #3. It *reuses* #3's matched build's age targets (B.6) but
  does not re-derive the build.
- **Does not estimate resources / vils-per-resource** — that's #2. `needs-#2` detectors stay disabled
  until #2 is trusted; the pass never guesses economy numbers.
- **Does not author the coach prompt or run `claude -p`** — that's #4. It hands #4 a flagged list +
  the retrieval contract and one hedging rule; #4 owns narration and the word budget.
- **Does not judge "was this good overall" / predict wins** — it flags *specific, sourced mistakes*,
  nothing more.

## Relationship to #1 / #3 / #4

- **#1 (Reconstruction core)** is the sole fact input. Detectors read its exact fields
  (`efficiency.tc_idle_s`, `ages.*_arrival_s`, `techs.eco[]`, `spatial`, `population`,
  `counts.villagers_produced`). If a detector wants a field #1 doesn't emit, that's an Open Decision
  back to #1 — not re-parsing here.
- **#3 (Build-order classifier)** supplies the optional `build_target` for build-relative uptime
  flags (B.6) and the **retrieval mechanism this KB reuses** (`load_one`, `data/` reference files,
  progressive disclosure) in a parallel `mistakes/` namespace.
- **#4 (Coach v2)** is the sole consumer: receives the `Flagged` list (new `mistakes.json` sibling),
  retrieves each flagged entry on demand, narrates with its explanation/fix/citation, and hedges by
  `confidence_tier`. Additive to #4's contract — old paths unchanged.
