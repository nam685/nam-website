# AoE2 Coach — Extract, Enrich, Evaluate (Design)

Date: 2026-06-22
Status: Approved (brainstorming) → ready for implementation plan
Related: `~/elluminate-platform-django/tmp/aoe2-coach-eval-handoff.md`,
`~/elluminate-platform-django/tmp/aoe2-coach-eval-design.md`, PRs #240–#245.

## Goal

Three coupled changes to the AoE2 1v1 coach pipeline:

1. **Enrich preprocessing** — extract more structured information from the de-noised
   action log (tech upgrades, unit/treb milestones, villager-idle gaps, build positions,
   game-flow narrative inputs).
2. **Improve the AI coach** — rely on structured information as much as possible; require a
   factual "what happened" summary before any judgment; the system prompt explicitly names
   the markers to record rather than relying on the model to decide what matters.
3. **Make the coach a standalone module** — extract it into its own git repo so that
   nam-website (production) and the elluminate quality-eval call the **exact same code**.

These are sequenced into three phases (below). The sequence is deliberate: extract a
byte-identical baseline first so the eval can measure the enrichment as an improvement.

## Locked decisions (from brainstorming)

- **Testing without real data**: synthetic ops faithful to the `mgz.fast` dict shapes, plus a
  bytes→`parse_action` fidelity test. Real `.aoe2record` only available on Nam's home machine
  later; online sample recs are inconsistent (bonus-only, never committed).
- **Enrichment scope**: tech upgrades + treb/unit milestones; villager idle / production
  gaps; build positions (forward/proxy); game-flow narrative ("who won how" = push style,
  frontal vs flank, scout raids, what triggered the resign).
- **Coach format**: structured facts block + mandatory "what happened" summary before
  judgment; system prompt explicitly enumerates markers to record.
- **Output surface**: coach prompt + stored metrics only (no frontend changes this round).
- **Packaging**: separate git repo `aoe2coach`, consumed by both repos as a git dependency.
  Remote created via the GitHub MCP (name + visibility confirmed before creation).
- **Sequencing**: extract byte-identical baseline first, then enrich.
- **OPENING line**: the v2 coach drops the redundant `OPENING:` prose line (the opening is
  already shown as a UI chip next to the Victory/Defeat badge). The opening is still produced
  as a structured field so `metrics["opening"]` keeps driving that chip.

---

## Phase 0 — Extract `aoe2coach` (byte-identical)

### New repo `aoe2coach`

Framework-agnostic Python package. Only runtime dependency: `mgz-fast==1.0.0`.

```
aoe2coach/
  pyproject.toml            # name=aoe2coach, dep mgz-fast==1.0.0, build-system
  src/aoe2coach/
    __init__.py             # re-exports: parse_rec, build_timeline, render_dual_log,
                            #             compute_metrics, coach, analyze_replay,
                            #             BENCHMARKS, CoachOutput
    parser.py               # mgz adapter → ParsedRec (moved verbatim)
    timeline.py             # build_timeline + render_dual_log (moved verbatim, then enriched in P2)
    metrics.py              # compute_metrics (moved verbatim, then enriched in P2)
    const.py                # id→name maps (moved verbatim, then extended in P2)
    coach.py                # COACH_SYSTEM, BENCHMARKS, build_coach_prompt, parse_opening,
                            #   run_claude_coach, coach(), CoachOutput
    entrypoint.py           # analyze_replay() — eval-facing, no DB
  tests/                    # the pure tests from website/tests/test_aoe2.py
```

### Pure callable

```python
@dataclass
class CoachOutput:
    raw_text: str
    opening_tag: str        # regex-extracted (baseline); structured field (v2)
    model_used: str

def coach(metrics: dict, salient_log: str, benchmarks: str, result: str,
          model: str = "sonnet") -> CoachOutput
```

- No Django, no DB, no Celery, no settings reads inside. `model` is a plain arg.
- `benchmarks` is passed in explicitly. The benchmark uptime table currently lives inside
  `COACH_SYSTEM`; expose it as the module constant `BENCHMARKS` and pass it through, so the
  eval embeds the identical yardstick in its criteria.
- `result` is accepted as an input now (the eval judge uses it). For the **baseline**, the
  prompt behavior is unchanged (the current prompt does not use `result`); keep it that way
  until Phase 2 decides whether the narrative summary should consume it.
- LLM invocation stays subprocess `claude -p … --model … --output-format json`
  (`CLAUDE_CODE_OAUTH_TOKEN` auth). **Exceptions surface** — the try/except lives in the prod
  wrapper, not in `coach()`.

### Eval entrypoint (no DB)

```python
def analyze_replay(path: str, owner_profile_id: int, *,
                   result: str = "unknown", model: str = "sonnet",
                   civ: str = "", elo_band: str = "") -> dict
```

Returns the handoff Part-2 data contract (one dict per replay), all values stringified:

```
{ "match_id", "metrics_json", "salient_log", "game_result",
  "coach_output", "opening", "civ", "elo_band" }
```

### nam-website changes

- Add `aoe2coach @ git+https://github.com/<owner>/aoe2coach.git@<rev>` to `pyproject.toml`.
- `website/aoe2/` collapses to thin Django glue. `relic.py` (Relic ELO API) **stays** — it is
  nam-website-specific. `parser/timeline/metrics/const/coach` are deleted and imported from
  `aoe2coach`.
- `website/tasks.py::analyze_match()` becomes a thin wrapper:
  - reads `AOE2_COACH_MODEL` / `AOE2_CLAUDE_BIN` from settings,
  - calls `aoe2coach.coach(...)` inside try/except → empty `coach_analysis` on failure
    (graceful degradation preserved),
  - writes `Aoe2Match.coach_analysis` / `coach_model` / `metrics` / `timeline` unchanged.

### Byte-identical guarantee

- `uv run pytest website/tests/test_aoe2.py` still passes (tests that move to the package run
  there; integration tests for the Django glue stay in nam-website).
- Regression test: mock the `claude` subprocess; assert `coach()` output text == the
  pre-refactor `analyze_match` coach text for the same input.
- Confirm `analyze_match()` still writes `coach_analysis` / `coach_model` unchanged.

### Repo creation

Scaffold + commit `aoe2coach` locally. Create the GitHub remote via GitHub MCP (confirm repo
name + private/public first). Push, then pin nam-website to the pushed revision.

---

## Phase 1 — Eval harness (built here, run at home)

- `build_rows_from_replays(paths)` → list of data-contract dicts via `analyze_replay`.
- elluminate script per handoff Part 2: `create_collection` (one row per replay) →
  `create_criterion_set` + 12 criteria (benchmark table substituted **verbatim** from
  `aoe2coach.BENCHMARKS`) → `create_experiment(prompt_template=None,
  response_column_id=coach_col_id, generate=True, block=True,
  rating_mode=RatingMode.DETAILED)` → per-criterion pass rates.
- Verify the 3 SDK VERIFY points against the installed `elluminate==1.1.11`:
  import paths (`RatingMode`, `RatingValue`), `coll.columns` id access, and
  `exp.result` / `exp.responses()` shapes.
- **Cannot run here**: needs real recs + `ELLUMINATE_API_KEY` (project "nam") + laptop. The
  script is delivered turnkey with the exact commands; Nam runs it at home and reports the
  experiment URL + pass rates.

---

## Phase 2 — Enrichment (the product)

### Preprocessing (in `aoe2coach`)

All new extractors are pure functions over `ops` (list of `(clock_ms, action_type, data)`),
so fully testable with synthetic ops.

- **Tech upgrades** — add military / blacksmith / university tech id→name maps to `const.py`
  (Fletching, Bodkin, Forging, Iron Casting, Bloodlines, Ballistics, Chemistry, armor lines,
  Squires, …). Surface upgrade timings: ME full set; OPP key markers only (mirrors the
  existing ME-full / OPP-key asymmetry).
- **Milestones** — first-treb, first-siege, first-of-each distinct military unit timing.
  Treb timing is surfaced explicitly as its own structured fact.
- **Villager idle / production gaps** — from villager queue timestamps: TC idle time, count
  and length of production gaps over a threshold, longest gap.
- **Build positions** — `BUILD` carries `x`,`y`. Derive opponent start (first OPP TC /
  `CREATE`) and classify forward / proxy / frontal-vs-flank build placement. Best-effort;
  coordinate semantics get calibrated when a real rec is available. Guarded so missing
  positional data never breaks the pipeline.
- **Game-flow narrative inputs** — structured facts feeding "who won how": push style
  (e.g. siege/treb slow push), frontal vs flank (from build positions), scout raids, and the
  resign trigger (resign timing relative to the owner's last aggression / eco hit).

These extend `compute_metrics`/`render_dual_log` outputs and add a new structured
**facts** dict. The metrics/timeline JSON columns gain fields (additive; old rows still read).

### Coach v2 (in `aoe2coach`)

- Feed a **structured FACTS block** (JSON-ish) alongside the salient log.
- System prompt **explicitly enumerates** the markers to record (first treb timing, opening,
  age-up arrival times, army composition, who-won-how narrative) and **requires a
  "What happened" summary section before any judgment**.
- **Drop the redundant `OPENING:` prose line.** The opening is emitted as a structured field
  (within the facts summary / a machine-readable line the display strips) so
  `metrics["opening"]` still populates the UI chip. `parse_opening` is updated accordingly.
- ⚠️ The output contract changes, so eval criteria **#2** ("`OPENING:` matches build order")
  and **#10** ("Line 1 is exactly `OPENING: <tag>`") get a **v2 variant**. The baseline eval
  (Phase 1) keeps the current criteria; the v2 eval uses the updated set. Do not soften the
  factual-grounding criterion (#1) to chase a higher pass rate.

---

## Testing strategy (no real data)

- **Synthetic ops** faithful to the `mgz.fast` `parse_action` dict shapes (verified from the
  installed library source). A shared fixture builder constructs `(t, action_type, data)`
  tuples for: RESEARCH, BUILD (with x/y), DE_QUEUE, RESIGN, CREATE, plus the new action types
  used by enrichment.
- **Fidelity test** — for a couple of action types, pack the raw bytes and run them through
  `mgz.fast.parse_action`, then assert the produced dict keys match the fixture builder. This
  pins the synthetic fixtures to the real library without any real rec.
- **Full-pipeline `parse_rec` test** stays skip-guarded on
  `website/tests/fixtures/sample_1v1.aoe2record` (gitignored) for Nam to run at home.
- Online sample rec: attempt as a bonus only; never committed; treat results as unverified
  given known online inconsistency.

## Dependencies on Nam (cannot be done solo)

- Approve repo name + visibility for the GitHub MCP repo creation.
- Run the Phase 1 eval at home (real recs + `ELLUMINATE_API_KEY`); report experiment URL +
  per-criterion pass rates.
- Drop a real `.aoe2record` for the skip-guarded end-to-end test + build-position calibration.

## Out of scope (this round)

- Frontend changes (Aoe2Tab UI, QA checklist) — surface is "coach + stored metrics only".
- Replacing the `claude` CLI subprocess with an API call.
- Multi-step agent / ATIF trajectory representation in elluminate (single-shot coach uses the
  `response_column_id` path).
