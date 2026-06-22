# aoe2coach Phase 1 — elluminate Quality-Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a turnkey elluminate eval harness for the AoE2 1v1 coach (Phase 0 baseline). The harness: (1) builds a collection of test rows from real `.aoe2record` replays via `aoe2coach.analyze_replay`, (2) creates an `aoe2-coach-criteria-v1` criterion set with 12 binary judges, (3) runs the experiment using the `response_column_id` path (pre-existing responses — no generation inside elluminate), and (4) prints per-criterion pass rates. Phase 0 is already shipped; this phase builds on it without modifying the coach or preprocessing.

**Architecture:** A single standalone script `eval/aoe2_coach_eval.py` inside the `elluminate-platform-django` repo (a uv project that already depends on `elluminate`). The script adds `aoe2coach` (git dep) to the elluminate-platform `pyproject.toml`, then calls `aoe2coach.analyze_replay` over a user-supplied list of replay paths to produce the data-contract dicts, uploads them as a collection, creates the criterion set, and calls `client.run_experiment(..., response_column_id=coach_col_id)` to rate the pre-existing coach outputs. All elluminate API calls are real — the script is the entire harness; there is no second file.

**Tech Stack:** Python 3.12+, `uv`, `elluminate==1.1.11` (in-repo SDK at `/Users/nam/elluminate-platform-django/elluminate_sdk`), `aoe2coach @ git+https://github.com/nam685/aoe2coach.git`. Runs from inside `/Users/nam/elluminate-platform-django`.

---

## Global Constraints

| Name | Value |
|------|-------|
| elluminate SDK version | `1.1.11` (in-repo editable at `elluminate_sdk/`) |
| elluminate base URL | `https://app.elluminate.de` |
| env var: key | `ELLUMINATE_API_KEY` (project-"nam"-scoped; create in UI, never commit) |
| env var: base URL | `ELLUMINATE_BASE_URL=https://app.elluminate.de` |
| elluminate project | **"nam"** — use existing, do NOT create |
| aoe2coach package | `aoe2coach @ git+https://github.com/nam685/aoe2coach.git` |
| data-contract keys | `match_id`, `metrics_json`, `salient_log`, `game_result`, `coach_output`, `opening`, `civ`, `elo_band` |
| collection name | `aoe2-coach-eval-v1` |
| criterion set name | `aoe2-coach-criteria-v1` |
| experiment name | `aoe2-coach-eval-run-<N>` (increment N per run) |
| rating mode | `RatingMode.DETAILED` (includes judge reasoning) |
| script location | `/Users/nam/elluminate-platform-django/eval/aoe2_coach_eval.py` |
| Phase 2 note | Criteria #2 and #10 assume `OPENING:` on line 1. Phase 2 drops that line — a v2 variant of these two criteria will be needed then. Keep baseline criteria verbatim for Phase 1. |

---

## File Structure

**New files:**
- `/Users/nam/elluminate-platform-django/eval/aoe2_coach_eval.py` — the complete eval harness (rows builder + collection + criterion set + experiment + results printer). Single script; all logic inline.
- `/Users/nam/elluminate-platform-django/eval/__init__.py` — empty, makes `eval/` a package dir so linters are happy.

**Modified files:**
- `/Users/nam/elluminate-platform-django/pyproject.toml` — add `aoe2coach @ git+https://github.com/nam685/aoe2coach.git` to `[project.dependencies]`.

**Files NOT modified:** any coach code, any nam-website file, any elluminate service/platform code, any existing test.

---

## SDK Shape Reference (verified from installed source)

Before writing the tasks you must know the confirmed SDK shapes. These are sourced directly from the installed `elluminate_sdk/` source — trust these, but Task 1 has you verify them programmatically anyway:

- **`RatingMode`**: `elluminate.schemas.RatingMode` (also re-exported from `elluminate.schemas`; imported via `from elluminate.schemas import RatingMode, RatingValue`).
- **`RatingValue`**: same module (`elluminate.schemas.RatingValue`); values `RatingValue.YES` / `RatingValue.NO`.
- **`coll.columns`**: `TemplateVariablesCollectionWithEntries.columns: list[CollectionColumn]` where `CollectionColumn.id: int | None` and `CollectionColumn.name: str | None`. Access: `next(c.id for c in coll.columns if c.name == "coach_output")`.
- **`exp.result`**: property on `Experiment` that returns `self.results` which is `ExperimentResults | None`. `ExperimentResults.mean_all_ratings.yes: float` (0–1).
- **`exp.responses()`**: returns `iter(self.rated_responses)` — an iterator of `PromptResponse`. Each has `.ratings: list[Rating]`; each `Rating` has `.criterion.criterion_str: str` and `.rating: RatingValue`.
- **`client.run_experiment(..., response_column_id=..., generate=False, ...)`**: `run_experiment` accepts `response_column_id: int | None` and `generate: bool = True` (set to `False` — no LLM generation; only rating of pre-existing responses). It blocks until complete (internally passes `block=True`). `prompt_template` can be `None` when `response_column_id` is set.
- **IMPORTANT**: the reference script in the handoff shows `create_experiment(..., generate=True, block=True)` — those kwargs do NOT exist on `create_experiment` in v1.1.11. The correct API is `client.run_experiment(..., generate=False, response_column_id=coach_col_id, rating_mode=RatingMode.DETAILED)`. This was verified from the source at `elluminate_sdk/elluminate/client.py`.

---

### Task 1: Verify SDK shapes (must run at home, needs `ELLUMINATE_API_KEY`)

**Purpose:** Confirm the 3 VERIFY points from the handoff against the installed SDK before wiring them. All 3 should pass given the source analysis above — this task catches any mismatch between the installed source and runtime behavior.

**Files:** none created/modified (read-only verification).

**Interfaces:**
- Consumes: installed `elluminate_sdk/` in the venv.
- Produces: printed confirmation of import paths, column-id access pattern, and `exp.result` / `exp.responses()` shapes.

- [ ] **Step 1: Confirm `RatingMode` and `RatingValue` import paths.**

```bash
cd /Users/nam/elluminate-platform-django
uv run python -c "
from elluminate.schemas import RatingMode, RatingValue
print('RatingMode.DETAILED:', RatingMode.DETAILED)
print('RatingMode.FAST:', RatingMode.FAST)
print('RatingValue.YES:', RatingValue.YES)
print('RatingValue.NO:', RatingValue.NO)
print('VERIFY 1: PASS')
"
```

Expected output: `RatingMode.DETAILED: detailed`, `RatingValue.YES: YES`. If `ImportError`, check whether `RatingMode`/`RatingValue` are in `elluminate.schemas.__init__` — source shows they are (`elluminate/schemas/__init__.py` lines 58 and 115).

- [ ] **Step 2: Confirm `CollectionColumn.id` access (no live API call needed — just inspect the schema).**

```bash
cd /Users/nam/elluminate-platform-django
uv run python -c "
from elluminate.schemas.template_variables_collection import CollectionColumn
import inspect
sig = inspect.signature(CollectionColumn)
print('CollectionColumn fields:', list(CollectionColumn.model_fields.keys()))
# Should include: id, name, column_type, default_value, column_position, categorical_values
assert 'id' in CollectionColumn.model_fields, 'id field missing'
assert 'name' in CollectionColumn.model_fields, 'name field missing'
print('VERIFY 2: PASS — access pattern: next(c.id for c in coll.columns if c.name == \"coach_output\")')
"
```

- [ ] **Step 3: Confirm `exp.result` property and `exp.responses()` shape.**

```bash
cd /Users/nam/elluminate-platform-django
uv run python -c "
from elluminate.schemas.experiments import Experiment, ExperimentResults
import inspect
# Confirm 'result' is a property returning 'results'
prop = Experiment.__dict__['result']
assert isinstance(prop, property), 'result must be a property'
print('result is a property:', True)

# Confirm ExperimentResults has mean_all_ratings
from elluminate.schemas.experiments import MeanRating
print('ExperimentResults fields:', list(ExperimentResults.model_fields.keys()))
assert 'mean_all_ratings' in ExperimentResults.model_fields
print('MeanRating fields:', list(MeanRating.model_fields.keys()))
assert 'yes' in MeanRating.model_fields

# Confirm responses() returns iter(rated_responses)
src = inspect.getsource(Experiment.responses)
print('responses() source:', src[:120])
print('VERIFY 3: PASS — exp.result.mean_all_ratings.yes is float 0-1; exp.responses() iterates rated_responses')
"
```

- [ ] **Step 4: Confirm `run_experiment` accepts `prompt_template=None` and `response_column_id`.**

```bash
cd /Users/nam/elluminate-platform-django
uv run python -c "
import inspect
from elluminate import Client
sig = inspect.signature(Client.run_experiment)
params = list(sig.parameters.keys())
print('run_experiment params:', params)
assert 'response_column_id' in params, 'response_column_id not in run_experiment'
assert 'generate' in params, 'generate not in run_experiment'
# Confirm prompt_template allows None
pt_param = sig.parameters['prompt_template']
print('prompt_template annotation:', pt_param.annotation)
print('VERIFY 4: PASS — use client.run_experiment(prompt_template=None, response_column_id=..., generate=False)')
"
```

---

### Task 2: Add `aoe2coach` dependency to `elluminate-platform-django`

**Files:** `/Users/nam/elluminate-platform-django/pyproject.toml`

**Interfaces:**
- Consumes: existing `pyproject.toml` with `[project.dependencies]`.
- Produces: `aoe2coach` importable from `uv run python` inside `elluminate-platform-django`.

- [ ] **Step 1: Read the current `pyproject.toml`** to see the exact `[project.dependencies]` block.

```bash
grep -A 20 '^\[project\]' /Users/nam/elluminate-platform-django/pyproject.toml
```

- [ ] **Step 2: Add `aoe2coach` to `[project.dependencies]`.**

Edit `/Users/nam/elluminate-platform-django/pyproject.toml`: add the following line to `[project.dependencies]`:

```
"aoe2coach @ git+https://github.com/nam685/aoe2coach.git",
```

- [ ] **Step 3: Sync the venv.**

```bash
cd /Users/nam/elluminate-platform-django
uv sync
```

- [ ] **Step 4: Verify import.**

```bash
cd /Users/nam/elluminate-platform-django
uv run python -c "
import aoe2coach
print('aoe2coach version:', getattr(aoe2coach, '__version__', 'n/a'))
from aoe2coach import analyze_replay, BENCHMARKS, CoachOutput
print('analyze_replay:', analyze_replay)
print('BENCHMARKS first line:', BENCHMARKS.splitlines()[0])
print('Import OK')
"
```

---

### Task 3: Write the eval harness script

**Files:**
- Create: `/Users/nam/elluminate-platform-django/eval/__init__.py` (empty)
- Create: `/Users/nam/elluminate-platform-django/eval/aoe2_coach_eval.py`

**Interfaces:**
- Consumes: `aoe2coach.analyze_replay`, `aoe2coach.BENCHMARKS`, `elluminate.Client`, `elluminate.schemas.RatingMode`, `elluminate.schemas.RatingValue`.
- Produces: a runnable script that, given a list of `.aoe2record` paths, uploads rows to elluminate, runs the experiment, prints per-criterion pass rates, and returns the experiment URL.

- [ ] **Step 1: Create the `eval/__init__.py` placeholder.**

Write an empty file at `/Users/nam/elluminate-platform-django/eval/__init__.py`.

- [ ] **Step 2: Write the complete eval script.**

Write the following to `/Users/nam/elluminate-platform-django/eval/aoe2_coach_eval.py`:

```python
"""AoE2 Coach — elluminate quality-eval harness (Phase 1 baseline).

Usage (from /Users/nam/elluminate-platform-django):

    export ELLUMINATE_API_KEY=<your-nam-project-api-key>
    export ELLUMINATE_BASE_URL=https://app.elluminate.de

    uv run python eval/aoe2_coach_eval.py \
        --owner-id <YOUR_AOE2_PROFILE_ID> \
        path/to/replay1.aoe2record \
        path/to/replay2.aoe2record \
        ...

Optional flags:
    --collection-name   override collection name (default: aoe2-coach-eval-v1)
    --run-number        suffix for experiment name (default: 1)
    --result win|loss   override game result for ALL replays (useful for batch of same-outcome recs)
    --elo-band low|mid|high   override elo band for all replays

For per-replay result/elo_band overrides: edit REPLAY_OVERRIDES dict at the top of the script.

Elluminate objects created:
    Collection:     aoe2-coach-eval-v1  (or --collection-name)
    CriterionSet:   aoe2-coach-criteria-v1
    Experiment:     aoe2-coach-eval-run-<N>

Phase 2 note: criteria #2 and #10 rely on 'OPENING:' on line 1. When Phase 2 drops that line,
create a v2 criterion set. Do NOT soften these criteria to fix a failing baseline.
"""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

from aoe2coach import BENCHMARKS, analyze_replay
from elluminate import Client
from elluminate.schemas import RatingMode, RatingValue

# ---------------------------------------------------------------------------
# The 12 judge criteria (verbatim from handoff Part 2).
# <<BENCHMARK_TABLE>> is substituted at runtime from aoe2coach.BENCHMARKS
# (the literal string sliced from COACH_SYSTEM — single source of truth).
# ---------------------------------------------------------------------------

def build_criteria(benchmarks: str) -> list[str]:
    """Return the 12 judge criteria with the benchmark table substituted in."""
    return [
        # Grounding
        "Every numeric timing or count claim in the response matches the data in {{metrics_json}} or {{salient_log}}. No invented numbers.",
        "The 'OPENING:' tag on line 1 matches the actual build order shown in {{salient_log}}.",
        "The response uses OPP-prefixed lines in {{salient_log}} only for context, never to evaluate the owner player's performance.",
        # Correctness (benchmark-anchored)
        f"Given this benchmark table:\n{benchmarks}\nthe response compares uptimes against the correct benchmark row for the opening it detected.",
        "The response applies the slow/fast thresholds correctly (15-30s = minor gap; >60s = significant), consistent with {{metrics_json}}.",
        # Consistency
        "The analysis does not contradict the game result {{game_result}} (e.g. does not claim the player was dominating if they lost).",
        # Usefulness
        "The response gives exactly one clear, actionable improvement suggestion.",
        "The improvement suggestion is specific to this game's actual mistakes (visible in {{metrics_json}}/{{salient_log}}), not generic advice.",
        "The improvement suggestion is strategically sound for Age of Empires II: DE 1v1.",
        # Format
        "Line 1 of the response is exactly in the form 'OPENING: <tag>'.",
        "The response is under 300 words, written in prose paragraphs, with no bullet lists.",
        # Tone
        "The response is concise and precise, with no filler or fluff.",
    ]


# ---------------------------------------------------------------------------
# Per-replay overrides (edit this dict for fine-grained control)
# ---------------------------------------------------------------------------
# Keys are replay filenames (basename only). Values are dicts with optional keys:
#   result: "win" | "loss"
#   elo_band: "low" | "mid" | "high"
#   civ: str
#   match_id: str
#
# Example:
#   REPLAY_OVERRIDES = {
#       "20240101_123456.aoe2record": {"result": "win", "elo_band": "mid"},
#   }
REPLAY_OVERRIDES: dict[str, dict] = {}


def build_rows(
    replay_paths: list[Path],
    owner_id: int,
    default_result: str | None,
    default_elo_band: str,
    model: str,
) -> list[dict]:
    """Parse each replay via aoe2coach.analyze_replay and return a list of data-contract dicts."""
    rows = []
    for path in replay_paths:
        overrides = REPLAY_OVERRIDES.get(path.name, {})
        result = overrides.get("result") or default_result
        elo_band = overrides.get("elo_band") or default_elo_band
        civ = overrides.get("civ", "")
        match_id = overrides.get("match_id", None)

        print(f"  Parsing {path.name} ...", end=" ", flush=True)
        try:
            row = analyze_replay(
                str(path),
                owner_id,
                result=result,
                model=model,
                civ=civ,
                elo_band=elo_band,
                match_id=match_id,
            )
            print(f"OK  opening={row['opening']}  result={row['game_result']}")
            rows.append(row)
        except Exception as exc:
            print(f"FAILED: {exc}")
            raise

    return rows


def run_eval(
    replay_paths: list[Path],
    owner_id: int,
    collection_name: str,
    run_number: int,
    default_result: str | None,
    default_elo_band: str,
    model: str,
) -> None:
    # 1) Build rows
    print(f"\n=== Step 1/4: Parsing {len(replay_paths)} replay(s) ===")
    rows = build_rows(replay_paths, owner_id, default_result, default_elo_band, model)
    print(f"  Built {len(rows)} row(s).")

    # 2) Connect to elluminate
    print("\n=== Step 2/4: Connecting to elluminate (project 'nam') ===")
    client = Client()  # reads ELLUMINATE_API_KEY and ELLUMINATE_BASE_URL from env
    print(f"  Connected: {client.get_info()}")
    print(f"  Active project: {client.current_project.name} (id={client.current_project.id})")

    # 3) Create (or reuse) the collection
    print(f"\n=== Step 3/4: Uploading collection '{collection_name}' ({len(rows)} rows) ===")
    columns = [
        "match_id",
        "metrics_json",
        "salient_log",
        "game_result",
        "coach_output",
        "opening",
        "civ",
        "elo_band",
    ]
    coll = client.create_collection(
        name=collection_name,
        description="AoE2 coach outputs + inputs for quality eval (Phase 1 baseline)",
        variables=rows,
        columns=columns,
    )
    print(f"  Collection created: id={coll.id}, rows={coll.variables_count}")

    # Verify VERIFY 2: columns attribute shape and id access
    col_names = [c.name for c in coll.columns]
    print(f"  Collection columns: {col_names}")
    coach_col = next((c for c in coll.columns if c.name == "coach_output"), None)
    if coach_col is None or coach_col.id is None:
        raise RuntimeError(
            f"'coach_output' column not found or has no id. Columns: {col_names}"
        )
    coach_col_id = coach_col.id
    print(f"  coach_output column id: {coach_col_id}")

    # 4) Create (or reuse) the criterion set
    print("\n=== Step 4/4: Creating criterion set and running experiment ===")
    criteria = build_criteria(BENCHMARKS)
    cs = client.create_criterion_set(name="aoe2-coach-criteria-v1")
    cs.add_criteria(criteria)
    print(f"  CriterionSet 'aoe2-coach-criteria-v1' created with {len(criteria)} criteria.")

    # 5) Run experiment: rate pre-existing coach outputs (no generation in elluminate)
    experiment_name = f"aoe2-coach-eval-run-{run_number}"
    print(f"  Running experiment '{experiment_name}' ...")
    print("  (This blocks until all ratings complete — may take a few minutes.)")
    exp = client.run_experiment(
        name=experiment_name,
        prompt_template=None,          # no generation — we supply pre-existing responses
        collection=coll,
        criterion_set=cs,
        rating_mode=RatingMode.DETAILED,
        response_column_id=coach_col_id,
        generate=False,                # rate the column; do not call an LLM to generate
    )
    print(f"  Experiment complete: id={exp.id}")

    # 6) Print results
    print("\n=== RESULTS ===")
    if exp.result is None:
        print("WARNING: exp.result is None — experiment may not have finished or has no ratings.")
        print(f"  rated_responses count: {len(exp.rated_responses)}")
    else:
        print(f"Overall YES rate: {exp.result.mean_all_ratings.yes:.1%}  ({len(exp.rated_responses)} response(s))")

    # Per-criterion aggregation
    agg: dict[str, list[int]] = defaultdict(lambda: [0, 0])  # criterion_str -> [passed, total]
    for resp in exp.responses():
        for r in resp.ratings:
            key = r.criterion.criterion_str
            agg[key][1] += 1
            if r.rating == RatingValue.YES:
                agg[key][0] += 1

    print("\nPer-criterion pass rates:")
    for i, crit_str in enumerate(criteria, start=1):
        passed, total = agg.get(crit_str, [0, 0])
        pct = f"{passed/total:.0%}" if total > 0 else "n/a"
        label = crit_str[:80].replace("\n", " ")
        print(f"  [{i:02d}] {pct:>4}  ({passed}/{total})  {label}")

    print(f"\nExperiment URL: {client.base_url}/projects/{client.current_project.id}/experiments/{exp.id}")
    print("\nDone. Report the experiment URL + per-criterion rates back for the handoff.")


def main() -> None:
    parser = argparse.ArgumentParser(description="AoE2 coach elluminate eval harness")
    parser.add_argument("replays", nargs="+", metavar="REPLAY", help=".aoe2record file paths")
    parser.add_argument("--owner-id", type=int, required=True, help="Your AoE2 profile ID (integer)")
    parser.add_argument("--collection-name", default="aoe2-coach-eval-v1", help="elluminate collection name")
    parser.add_argument("--run-number", type=int, default=1, help="Experiment run number suffix (increment each run)")
    parser.add_argument("--result", choices=["win", "loss"], default=None, help="Override game result for all replays")
    parser.add_argument("--elo-band", choices=["low", "mid", "high"], default="", help="Override elo band for all replays")
    parser.add_argument("--model", default="sonnet", help="aoe2coach model arg (default: sonnet)")
    args = parser.parse_args()

    paths = [Path(p) for p in args.replays]
    missing = [p for p in paths if not p.exists()]
    if missing:
        print(f"ERROR: replay file(s) not found: {missing}", file=sys.stderr)
        sys.exit(1)

    run_eval(
        replay_paths=paths,
        owner_id=args.owner_id,
        collection_name=args.collection_name,
        run_number=args.run_number,
        default_result=args.result,
        default_elo_band=args.elo_band,
        model=args.model,
    )


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Lint the script (no runtime needed).**

```bash
cd /Users/nam/elluminate-platform-django
uvx ruff check eval/aoe2_coach_eval.py && uvx ruff format --check eval/aoe2_coach_eval.py
```

Fix any lint errors before proceeding. The `defaultdict` lambda will trigger a Ruff ARG or B023 warning — if so, replace with an explicit `def` or use `dict` with `.setdefault`.

---

### Task 4: Smoke-test the script (dry-run, no replays needed)

**Purpose:** Confirm the script parses correctly, all imports resolve, and CLI help works. Does NOT require real replays or `ELLUMINATE_API_KEY`.

**Files:** no changes.

- [ ] **Step 1: Confirm imports resolve.**

```bash
cd /Users/nam/elluminate-platform-django
uv run python -c "
import eval.aoe2_coach_eval as m
print('build_criteria exists:', callable(m.build_criteria))
print('run_eval exists:', callable(m.run_eval))
criteria = m.build_criteria(m.BENCHMARKS)
print(f'criteria count: {len(criteria)} (expected 12)')
assert len(criteria) == 12, f'Expected 12 criteria, got {len(criteria)}'
# Confirm criterion 4 contains the benchmark table (substituted)
assert 'Scouts opening' in criteria[3], 'Criterion 4 missing benchmark table'
assert 'Fast Castle' in criteria[3], 'Criterion 4 missing Fast Castle benchmark row'
print('All assertions passed')
"
```

- [ ] **Step 2: Confirm CLI help prints without error.**

```bash
cd /Users/nam/elluminate-platform-django
uv run python eval/aoe2_coach_eval.py --help
```

Expected: argparse help with `replays`, `--owner-id`, `--collection-name`, `--run-number`, `--result`, `--elo-band`, `--model`.

- [ ] **Step 3: Confirm a missing replay path exits with a useful error.**

```bash
cd /Users/nam/elluminate-platform-django
uv run python eval/aoe2_coach_eval.py --owner-id 12345 /nonexistent/replay.aoe2record 2>&1
# Should print: ERROR: replay file(s) not found: ...
# and exit 1 — not a Python traceback
```

---

### Task 5: Full end-to-end run (at home, with real replays + `ELLUMINATE_API_KEY`)

**Purpose:** Execute the actual eval and collect per-criterion pass rates. Must be run on Nam's home laptop where `.aoe2record` files live and `ELLUMINATE_API_KEY` is set.

**Files:** no code changes — this is an operational task.

**Pre-flight checklist:**
- [ ] `ELLUMINATE_API_KEY` is set in env (project-"nam"-scoped key; create in elluminate UI at `https://app.elluminate.de`).
- [ ] `ELLUMINATE_BASE_URL=https://app.elluminate.de` is set (or already in `.env` in the elluminate repo).
- [ ] `CLAUDE_CODE_OAUTH_TOKEN` is set (needed by `claude -p` inside `aoe2coach.analyze_replay`).
- [ ] `aoe2coach` is on PATH: `which claude` should succeed.
- [ ] Start with 3–4 diverse replays (different openings + mix of win/loss) for a pressure-test before running the full set.

- [ ] **Step 1: Pressure-test with 3–4 replays.**

```bash
cd /Users/nam/elluminate-platform-django

export ELLUMINATE_API_KEY=<your-key>
export ELLUMINATE_BASE_URL=https://app.elluminate.de

uv run python eval/aoe2_coach_eval.py \
    --owner-id <YOUR_AOE2_PROFILE_ID> \
    --collection-name aoe2-coach-eval-v1-pressure-test \
    --run-number 1 \
    ~/replays/game1.aoe2record \
    ~/replays/game2.aoe2record \
    ~/replays/game3.aoe2record
```

Read the judge reasoning for each criterion in the elluminate UI. Confirm:
- Criteria 1–6 (grounding/correctness/consistency) receive enough context from `{{metrics_json}}` + `{{salient_log}}` + `{{game_result}}` + the embedded benchmark table to be graded fairly.
- The `OPENING:` tag on line 1 of each coach output is present and non-empty.
- No import errors or parse failures.

If criteria 1–6 are graded as `n/a` or judge reasoning says "insufficient context", the T3 inputs are not reaching the judge — inspect the criterion text carefully; the `{{...}}` placeholders must match the column names exactly.

- [ ] **Step 2: Full run with 20–40 diverse replays.**

Aim for the diversity target from the handoff:
- Openings: scouts, archers, M@A→archers, drush, fast castle, tower rush.
- Outcomes: mix of win + loss.
- Elo bands: low, mid, high.
- Edge cases: early resign, very long game, off-meta civ.

Use `--run-number 2` (or higher) to avoid name collision if the experiment name already exists. Use `--collection-name aoe2-coach-eval-v1` for the canonical run.

Per-replay overrides (result/elo_band/civ) can be set in `REPLAY_OVERRIDES` dict at the top of the script, or via `--result`/`--elo-band` for uniform batches.

```bash
uv run python eval/aoe2_coach_eval.py \
    --owner-id <YOUR_AOE2_PROFILE_ID> \
    --collection-name aoe2-coach-eval-v1 \
    --run-number 2 \
    ~/replays/*.aoe2record
```

- [ ] **Step 3: Report back.**

Copy the printed output and the experiment URL. Report:
- The experiment URL (e.g. `https://app.elluminate.de/projects/N/experiments/M`).
- Per-criterion pass rates (the 12-line table).
- Whether `prompt_template=None` + `response_column_id` worked, or if an alternative was needed.
- Any criteria with unexpectedly low or high pass rates (inspect judge reasoning in the UI for those).

---

## Self-Review

### Spec-coverage checklist

| Requirement source | Where covered |
|--------------------|---------------|
| Handoff: data-contract keys | Task 3 Step 2 — `analyze_replay` returns exactly these keys; collection columns match verbatim |
| Handoff: 12 criteria verbatim | Task 3 Step 2 — `build_criteria()` with `<<BENCHMARK_TABLE>>` substituted from `aoe2coach.BENCHMARKS` at runtime |
| Handoff: `BENCHMARKS` substituted (not retyped) | Task 3 Step 2 — `build_criteria(BENCHMARKS)` called with the imported constant |
| Handoff: `response_column_id` path (no generation in elluminate) | Task 3 Step 2 — `client.run_experiment(..., generate=False, response_column_id=coach_col_id)` |
| Handoff: `RatingMode.DETAILED` | Task 3 Step 2 — `rating_mode=RatingMode.DETAILED` |
| Handoff: project "nam" | Task 3 Step 2 — `Client()` resolves project from API key scope; confirmed in Step 4 printout |
| Handoff: VERIFY 1 (import paths) | Task 1 Step 1 |
| Handoff: VERIFY 2 (column id access) | Task 1 Step 2 + Task 3 Step 2 (runtime assertion on `coach_col.id`) |
| Handoff: VERIFY 3 (exp.result / responses shapes) | Task 1 Step 3 |
| Handoff: VERIFY 4 (prompt_template=None + run_experiment API) | Task 1 Step 4 |
| Spec: test-set diversity guidance | Task 5 Step 2 |
| Spec: pressure-test 3–4 replays before full run | Task 5 Step 1 |
| Spec: per-criterion pass rates | Task 3 Step 2 — aggregation + print loop |
| Spec: experiment URL | Task 3 Step 2 — printed from `client.base_url + project id + experiment id` |
| Spec: Phase 2 criteria #2/#10 note | Global Constraints + `aoe2_coach_eval.py` docstring |
| Spec: turnkey for home laptop | Tasks 4–5 give exact commands + env var setup |
| Spec: criterion #1 reliability callout | Not enforced in code (intentional — criterion is kept as-is per design) |
| Phase 0 not modified | Scope boundary — no `aoe2coach` source files touched |

### Placeholder scan

- No `TODO`, `FIXME`, `TBD`, `...`, `pass`, `raise NotImplementedError` in `eval/aoe2_coach_eval.py`.
- `REPLAY_OVERRIDES` is intentionally empty (filled by the user at home) — this is documented, not a placeholder.

### Type consistency

- All `analyze_replay` return values are `str` (the function stringifies everything).
- `coach_col_id` is `int` (from `CollectionColumn.id: int | None`; guarded with `if coach_col is None or coach_col.id is None`).
- `exp.result.mean_all_ratings.yes` is `float` (from `MeanRating` Pydantic model).
- `r.rating == RatingValue.YES` is safe: `RatingValue` is `str, Enum`; comparison with enum member is value-based.

### Known ambiguity (noted, not blocking)

- **`create_criterion_set` existence**: verified from `client.py` that it is a method on `Client` (calls `self._criterion_sets.create`). If it raises `ConflictError` (criterion set name already exists from a previous run), the script will fail. To handle reruns: either increment the criterion-set name with a timestamp or use `get_or_create_criterion_set` if that method exists. Check with `inspect.getmembers(client, predicate=callable)` — if `get_or_create_criterion_set` is present, prefer it. This is a low-risk issue for the first run.
- **`exp.result` may be `None` after `run_experiment`**: the code guards this with a `None` check and falls back to printing `rated_responses` count. This can happen if the experiment finishes with 0 ratings (unexpected). The guard is in Task 3 Step 2.
- **`analyze_replay` match_id**: if `match_id` is `None` and `rec.me.profile_id` is also empty, `match_id` will be an empty string, making rows non-unique. Use `path.stem` as a fallback match_id (can be patched directly in the `REPLAY_OVERRIDES` dict or by editing `build_rows`).
