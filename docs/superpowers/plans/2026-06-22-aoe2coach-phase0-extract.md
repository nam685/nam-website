# aoe2coach Phase 0 — Byte-Identical Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the AoE2 coach core (`parser`, `timeline`, `metrics`, `const`, `coach`) into a standalone, framework-agnostic git repo `aoe2coach`, consumed by nam-website production with **byte-identical** behavior, plus an eval entrypoint with no DB.

**Architecture:** New repo `aoe2coach` (flat package layout, hatchling build, only runtime dep `mgz-fast==1.0.0`). nam-website deletes the moved modules, depends on `aoe2coach`, and `analyze_match()` becomes a thin wrapper that reads Django settings, calls the pure `coach()` inside a try/except, and writes the DB exactly as before. The coach prompt string is left verbatim; the benchmark table is exposed as a constant by *slicing* `COACH_SYSTEM` (never retyped) so byte-identity is guaranteed.

**Tech Stack:** Python 3.12+, `uv`, `pytest`, `mgz-fast==1.0.0`, hatchling. nam-website: Django 6, Celery.

## Global Constraints

- Runtime dependency of `aoe2coach`: `mgz-fast==1.0.0` (exact pin, matches nam-website).
- `aoe2coach` core has **zero Django / DB / Celery / settings imports**. `coach()` takes `model` and `claude_bin` as plain args.
- LLM invocation stays subprocess `claude -p <prompt> --model <model> --output-format json` (`CLAUDE_CODE_OAUTH_TOKEN` auth).
- **Production output must be byte-identical** for the same input: do NOT change prompt wording, `COACH_SYSTEM` text, output format, model default (`"sonnet"`), or coaching behavior.
- Graceful degradation stays in the **prod wrapper** (`website/tasks.py`), not inside `coach()` — the eval needs real exceptions to surface.
- nam-website work happens in the worktree `.claude/worktrees/aoe2-coach-standalone` (branch `feat/aoe2-coach-standalone`). Run all nam-website bash from inside that directory.
- `aoe2coach` repo scaffolded at `/Users/nam/aoe2coach` (sibling of nam-website).
- Python: Ruff line-length=120.

---

## File Structure

**New repo `/Users/nam/aoe2coach`:**
- `pyproject.toml` — name=`aoe2coach`, dep `mgz-fast==1.0.0`, hatchling, packages=`["aoe2coach"]`.
- `aoe2coach/__init__.py` — re-exports `parse_rec, ParsedRec, build_timeline, render_dual_log, render_salient_log, compute_metrics, coach, CoachOutput, BENCHMARKS, analyze_replay`, and `const`.
- `aoe2coach/parser.py` — moved verbatim from nam-website.
- `aoe2coach/timeline.py` — moved verbatim.
- `aoe2coach/metrics.py` — moved verbatim.
- `aoe2coach/const.py` — moved verbatim.
- `aoe2coach/coach.py` — moved, Django import removed, `run_claude_coach` takes args, `BENCHMARKS` sliced from `COACH_SYSTEM`, `CoachOutput` + `coach()` added.
- `aoe2coach/entrypoint.py` — new `analyze_replay()`.
- `tests/test_pure.py` — ported pure tests (const/parser/timeline/metrics + new coach tests).
- `README.md`, `.gitignore`.

**nam-website worktree changes:**
- Delete: `website/aoe2/parser.py`, `timeline.py`, `metrics.py`, `const.py`, `coach.py`.
- Keep: `website/aoe2/relic.py` (nam-specific).
- Modify: `website/aoe2/__init__.py` (re-export from `aoe2coach` for compat), `website/tasks.py` (imports + `analyze_match` wrapper), `website/tests/test_aoe2.py` (imports + slim to integration), `pyproject.toml` (add dep).

---

### Task 1: Scaffold the `aoe2coach` repo

**Files:**
- Create: `/Users/nam/aoe2coach/pyproject.toml`
- Create: `/Users/nam/aoe2coach/aoe2coach/__init__.py`
- Create: `/Users/nam/aoe2coach/README.md`
- Create: `/Users/nam/aoe2coach/.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: an importable empty `aoe2coach` package + a `uv` project at `/Users/nam/aoe2coach`.

- [ ] **Step 1: Create the directory and git repo**

```bash
mkdir -p /Users/nam/aoe2coach/aoe2coach /Users/nam/aoe2coach/tests
cd /Users/nam/aoe2coach && git init -q && git branch -M main
```

- [ ] **Step 2: Write `pyproject.toml`**

```toml
[project]
name = "aoe2coach"
version = "0.1.0"
description = "Standalone AoE2 DE 1v1 coach core (parser, timeline, metrics, LLM coach). Shared by nam-website prod and the elluminate quality-eval."
requires-python = ">=3.12"
dependencies = [
    "mgz-fast==1.0.0",
]

[dependency-groups]
dev = [
    "pytest>=8.0",
    "ruff>=0.9",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["aoe2coach"]

[tool.ruff]
line-length = 120
target-version = "py312"

[tool.ruff.lint]
select = ["E4", "E7", "E9", "F", "I", "N", "ARG"]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "--tb=short"
```

- [ ] **Step 3: Write `.gitignore`**

```gitignore
__pycache__/
*.py[cod]
.venv/
.pytest_cache/
.ruff_cache/
dist/
build/
*.egg-info/
# Real AoE2 recorded games used as local test fixtures contain third-party
# player data; never commit them.
tests/fixtures/*.aoe2record
```

- [ ] **Step 4: Write a placeholder `aoe2coach/__init__.py`**

```python
"""Standalone AoE2 DE 1v1 coach core. Shared by nam-website prod + elluminate eval."""
```

- [ ] **Step 5: Write `README.md`**

```markdown
# aoe2coach

Standalone AoE2: Definitive Edition 1v1 coach core, extracted from nam-website so that
production and the elluminate quality-eval call the exact same code.

## Install (consumer)
```
uv add "aoe2coach @ git+https://github.com/<owner>/aoe2coach.git"
```

## Public API
- `parse_rec(path, owner_profile_id) -> ParsedRec`
- `build_timeline(ops, me_number) -> dict`
- `render_dual_log(ops, me_number, opp_number, me_action_count) -> str`
- `compute_metrics(timeline, duration_ms) -> dict`
- `coach(metrics, salient_log, benchmarks=BENCHMARKS, result="unknown", model="sonnet", claude_bin="claude") -> CoachOutput`
- `analyze_replay(path, owner_profile_id, *, ...) -> dict`  (eval data contract)
- `BENCHMARKS` — verbatim benchmark uptime table (single source of truth for eval criteria).

## Test
```
uv run pytest
```
```

- [ ] **Step 6: Verify the package imports**

Run: `cd /Users/nam/aoe2coach && uv run python -c "import aoe2coach; print('ok')"`
Expected: prints `ok` (uv creates the venv + installs mgz-fast on first run).

- [ ] **Step 7: Commit**

```bash
cd /Users/nam/aoe2coach && git add -A && git commit -q -m "chore: scaffold aoe2coach package"
```

---

### Task 2: Move the pure modules (parser, timeline, metrics, const) + port their tests

**Files:**
- Create: `/Users/nam/aoe2coach/aoe2coach/{parser,timeline,metrics,const}.py` (copied from nam-website)
- Create: `/Users/nam/aoe2coach/tests/test_pure.py`

**Interfaces:**
- Consumes: Task 1 package.
- Produces: `parse_rec`, `ParsedRec`, `build_timeline`, `render_dual_log`, `render_salient_log`, `AGE_RESEARCH_MS`, `compute_metrics`, and `const` (with `civ_name`, `building_name`, `unit_name`, `ECO_TECHS`, `MILITARY_BUILDINGS`, `VILLAGER_ID`, `AGE_TECHS`).

- [ ] **Step 1: Copy the four modules verbatim**

```bash
SRC=/Users/nam/nam-website/.claude/worktrees/aoe2-coach-standalone/website/aoe2
DST=/Users/nam/aoe2coach/aoe2coach
cp "$SRC/parser.py" "$SRC/timeline.py" "$SRC/metrics.py" "$SRC/const.py" "$DST/"
```

These modules already use package-relative imports (`from . import const`, `from .timeline import AGE_RESEARCH_MS`) and only import `mgz.*` externally, so no import rewrite is needed.

- [ ] **Step 2: Write the failing pure-logic test**

Create `/Users/nam/aoe2coach/tests/test_pure.py`. This ports the synthetic-ops tests (no real rec needed). Uses the real `mgz.fast.Action` enum to label ops, exactly like the source tests.

```python
from mgz.fast import Action

from aoe2coach import const
from aoe2coach.metrics import compute_metrics
from aoe2coach.timeline import build_timeline, render_dual_log


def test_name_helpers():
    assert const.civ_name(8) == "Persians"
    assert const.civ_name(999) == "#999"
    assert const.unit_name(const.VILLAGER_ID) == "Villager"
    assert const.building_name(50) == "Farm"
    assert const.unit_name(128) == "Trade Cart"
    assert const.building_name(99999) == "#99999"


def _ops():
    # (t_ms, action_type, data) — shapes match mgz.fast.parse_action output.
    return [
        (585_000, Action.RESEARCH, {"player_id": 1, "technology_id": 101}),   # feudal click
        (610_000, Action.RESEARCH, {"player_id": 1, "technology_id": 202}),   # Double-Bit Axe
        (610_000, Action.BUILD, {"player_id": 1, "building_id": 87, "x": 30.0, "y": 30.0}),
        (620_000, Action.BUILD, {"player_id": 1, "building_id": 50, "x": 31.0, "y": 31.0}),
        (625_000, Action.DE_QUEUE, {"player_id": 1, "unit_id": 83, "amount": 1}),   # Villager
        (630_000, Action.DE_QUEUE, {"player_id": 1, "unit_id": 4, "amount": 2}),    # Archer x2
        (590_000, Action.RESEARCH, {"player_id": 2, "technology_id": 101}),   # OPP feudal
        (615_000, Action.BUILD, {"player_id": 2, "building_id": 101, "x": 90.0, "y": 90.0}),  # OPP Stable
        (620_000, Action.DE_QUEUE, {"player_id": 2, "unit_id": 448, "amount": 1}),  # OPP Scout
    ]


def test_build_timeline_uptimes_and_units():
    tl = build_timeline(_ops(), me_number=1)
    assert tl["uptimes"]["feudal"] == 585_000
    assert tl["eco_techs"] == [{"t": 610_000, "name": "Double-Bit Axe"}]
    assert tl["action_count"] == 6  # 6 ME ops
    names = {u["name"] for u in tl["units"]}
    assert "Villager" in names and "Archer" in names


def test_compute_metrics_feudal_arrival():
    tl = build_timeline(_ops(), me_number=1)
    m = compute_metrics(tl, duration_ms=900_000)
    # arrival = click 585s + 130s research = 715s
    assert m["feudal_uptime_s"] == 715
    assert any(a["name"] == "Archer" for a in m["army"])
    assert m["villager_count"] == 1


def test_render_dual_log_roles_and_format():
    log = render_dual_log(_ops(), me_number=1, opp_number=2, me_action_count=6)
    lines = log.splitlines()
    assert lines[0].startswith("# ME = you")
    for ln in lines[1:]:
        parts = ln.split(" ")
        if parts[1] in {"ME", "OPP"}:
            assert parts[1] in {"ME", "OPP"}
    assert "OPP BUILD Stable" in log
    assert log.rstrip().endswith("APM total_actions=6")
```

- [ ] **Step 3: Run the test to verify it fails (modules not yet importable)**

Run: `cd /Users/nam/aoe2coach && uv run pytest tests/test_pure.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'aoe2coach.metrics'` until Step 1's files are present and picked up (if Step 1 already ran, this passes; if so, intentionally rename a module to confirm the test exercises real code, then restore).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/nam/aoe2coach && uv run pytest tests/test_pure.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint + commit**

```bash
cd /Users/nam/aoe2coach && uvx ruff check . && uvx ruff format .
git add -A && git commit -q -m "feat: move pure modules (parser/timeline/metrics/const) + tests"
```

---

### Task 3: Move `coach.py`, de-Django it, expose `BENCHMARKS`, add `CoachOutput` + `coach()`

**Files:**
- Create: `/Users/nam/aoe2coach/aoe2coach/coach.py` (moved + edited)
- Modify: `/Users/nam/aoe2coach/tests/test_pure.py` (append coach tests)

**Interfaces:**
- Consumes: Task 2 modules.
- Produces:
  - `COACH_SYSTEM: str` (verbatim, unchanged)
  - `BENCHMARKS: str` (sliced from `COACH_SYSTEM`)
  - `build_coach_prompt(salient_log: str, metrics: dict) -> str` (unchanged signature/behavior)
  - `parse_opening(text: str) -> str` (unchanged)
  - `run_claude_coach(prompt: str, model: str = "sonnet", claude_bin: str = "claude", timeout: int = 120) -> tuple[str, str]`
  - `@dataclass CoachOutput(raw_text: str, opening_tag: str, model_used: str)`
  - `coach(metrics: dict, salient_log: str, benchmarks: str = BENCHMARKS, result: str = "unknown", model: str = "sonnet", claude_bin: str = "claude") -> CoachOutput`

- [ ] **Step 1: Copy `coach.py` verbatim**

```bash
cp /Users/nam/nam-website/.claude/worktrees/aoe2-coach-standalone/website/aoe2/coach.py /Users/nam/aoe2coach/aoe2coach/coach.py
```

- [ ] **Step 2: Remove the Django import**

In `/Users/nam/aoe2coach/aoe2coach/coach.py`, delete the line:

```python
from django.conf import settings
```

- [ ] **Step 3: Make `run_claude_coach` take args instead of reading settings**

Replace the function head (the two `getattr(settings, ...)` lines) so the signature is:

```python
def run_claude_coach(prompt: str, model: str = "sonnet", claude_bin: str = "claude", timeout: int = 120) -> tuple[str, str]:
    """Run `claude -p <prompt> --model <model> --output-format json` and return (result_text, model).

    Raises RuntimeError on non-zero exit or missing 'result' key so the caller
    can decide how to handle (graceful fallback expected in the prod wrapper).
    """
    result = subprocess.run(
        [claude_bin, "-p", prompt, "--model", model, "--output-format", "json"],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
```

The rest of the function body (returncode check, JSON parse, `text`/`model` extraction, return) stays byte-identical.

- [ ] **Step 4: Add `BENCHMARKS` by slicing `COACH_SYSTEM` (no retyping → guaranteed verbatim)**

Append, immediately after the `COACH_SYSTEM = """..."""` literal:

```python
# BENCHMARKS is the verbatim benchmark uptime table, sliced out of COACH_SYSTEM so the
# eval embeds the identical yardstick. Sliced (not retyped) to guarantee byte-identity.
_BM_START = "AoE2 1v1 benchmark uptimes"
_BM_END = "\n\nKey metrics pros scrutinize:"
BENCHMARKS = COACH_SYSTEM[COACH_SYSTEM.index(_BM_START) : COACH_SYSTEM.index(_BM_END)]
```

- [ ] **Step 5: Add `CoachOutput` + `coach()`**

Add imports at the top (`from dataclasses import dataclass`) and append at the end of the file:

```python
@dataclass
class CoachOutput:
    raw_text: str
    opening_tag: str
    model_used: str


def coach(
    metrics: dict,
    salient_log: str,
    benchmarks: str = BENCHMARKS,
    result: str = "unknown",
    model: str = "sonnet",
    claude_bin: str = "claude",
) -> CoachOutput:
    """Pure, side-effect-free coach call shared by prod and the eval.

    `benchmarks` and `result` are accepted for the eval contract; the baseline prompt
    behavior is unchanged (the benchmark table is already inside COACH_SYSTEM, and the
    current prompt does not consume `result`). Raises on subprocess/JSON failure — the
    prod wrapper owns graceful degradation.
    """
    prompt = build_coach_prompt(salient_log, metrics)
    raw_text, model_used = run_claude_coach(prompt, model=model, claude_bin=claude_bin)
    return CoachOutput(raw_text=raw_text, opening_tag=parse_opening(raw_text), model_used=model_used)
```

- [ ] **Step 6: Write the failing coach tests**

Append to `/Users/nam/aoe2coach/tests/test_pure.py`:

```python
import json
from unittest.mock import MagicMock, patch

from aoe2coach import coach as coach_mod
from aoe2coach.coach import BENCHMARKS, CoachOutput, build_coach_prompt, coach, parse_opening


def test_benchmarks_sliced_verbatim():
    # The 6 benchmark rows must be present and the slice must be a substring of COACH_SYSTEM.
    assert BENCHMARKS.startswith("AoE2 1v1 benchmark uptimes")
    assert BENCHMARKS in coach_mod.COACH_SYSTEM
    for row in ["Scouts opening", "Archers opening", "Drush", "Fast Castle", "Tower Rush"]:
        assert row in BENCHMARKS
    assert "Key metrics" not in BENCHMARKS  # end anchor excluded


def test_build_coach_prompt_structure_unchanged():
    metrics = {"feudal_uptime_s": 715, "castle_uptime_s": None, "imperial_uptime_s": None,
               "apm": 80, "villager_count": 25, "army": [{"name": "Archer", "amount": 12}],
               "eco_tech_timings": [{"name": "Double-Bit Axe", "t_s": 610}]}
    p = build_coach_prompt("00:00 APM total_actions=6", metrics)
    assert p.startswith(coach_mod.COACH_SYSTEM)
    assert "=== METRICS SUMMARY ===" in p
    assert "=== SALIENT LOG ===" in p
    assert p.rstrip().endswith("Now write the coach report.")


def test_parse_opening():
    assert parse_opening("OPENING: Scouts\n\nbody") == "Scouts"
    assert parse_opening("no tag here") == ""


def test_coach_mocks_subprocess_and_extracts_fields():
    fake = json.dumps({"result": "OPENING: Archers\n\nGood archer opening.", "model": "claude-sonnet-4-5", "is_error": False})
    with patch("aoe2coach.coach.subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=fake, stderr="")
        out = coach({"apm": 80}, "00:00 APM total_actions=6", model="sonnet")
    assert isinstance(out, CoachOutput)
    assert out.raw_text == "OPENING: Archers\n\nGood archer opening."
    assert out.opening_tag == "Archers"
    assert out.model_used == "claude-sonnet-4-5"
    # subprocess invoked with the exact CLI contract
    args = run.call_args.args[0]
    assert args[:2] == ["claude", "-p"] and "--output-format" in args and "json" in args
```

- [ ] **Step 7: Run the tests to verify they fail, then pass**

Run: `cd /Users/nam/aoe2coach && uv run pytest tests/test_pure.py -q`
Expected: after Steps 1–5, PASS (all pure + coach tests). If run before Step 5, FAIL with `ImportError: cannot import name 'coach'`.

- [ ] **Step 8: Lint + commit**

```bash
cd /Users/nam/aoe2coach && uvx ruff check . && uvx ruff format .
git add -A && git commit -q -m "feat: standalone coach() + CoachOutput + BENCHMARKS (de-Django'd, byte-identical prompt)"
```

---

### Task 4: Add `analyze_replay` entrypoint + package re-exports

**Files:**
- Create: `/Users/nam/aoe2coach/aoe2coach/entrypoint.py`
- Modify: `/Users/nam/aoe2coach/aoe2coach/__init__.py`
- Modify: `/Users/nam/aoe2coach/tests/test_pure.py` (append entrypoint test)

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces: `analyze_replay(path, owner_profile_id, *, result=None, model="sonnet", civ="", elo_band="", match_id=None) -> dict` and the documented top-level re-exports.

- [ ] **Step 1: Write `entrypoint.py`**

```python
"""Eval-facing entrypoint: parse a replay → produce the eval data-contract dict. No DB."""

import json

from .coach import BENCHMARKS, coach
from .metrics import compute_metrics
from .parser import parse_rec
from .timeline import build_timeline, render_dual_log


def analyze_replay(
    path: str,
    owner_profile_id: int,
    *,
    result: str | None = None,
    model: str = "sonnet",
    civ: str = "",
    elo_band: str = "",
    match_id: str | None = None,
) -> dict:
    """Parse a .aoe2record and return BOTH the coach inputs and output (one dict per replay).

    All values are stringified for elluminate TEXT columns. Raises on parse/coach failure
    (the eval wants real exceptions). `result` defaults to the parser's RESIGN heuristic.
    """
    rec = parse_rec(path, owner_profile_id)
    timeline = build_timeline(rec.ops, rec.me["number"])
    metrics = compute_metrics(timeline, rec.duration_ms)
    salient_log = render_dual_log(rec.ops, rec.me["number"], rec.opponent["number"], timeline["action_count"])
    game_result = result if result is not None else rec.my_result
    out = coach(metrics, salient_log, benchmarks=BENCHMARKS, result=game_result, model=model)
    return {
        "match_id": str(match_id if match_id is not None else rec.me.get("profile_id", "")),
        "metrics_json": json.dumps(metrics),
        "salient_log": salient_log,
        "game_result": game_result,
        "coach_output": out.raw_text,
        "opening": out.opening_tag,
        "civ": civ or rec.me.get("civ_name", ""),
        "elo_band": elo_band,
    }
```

- [ ] **Step 2: Write the top-level re-exports in `__init__.py`**

```python
"""Standalone AoE2 DE 1v1 coach core. Shared by nam-website prod + elluminate eval."""

from . import const
from .coach import BENCHMARKS, CoachOutput, build_coach_prompt, coach, parse_opening, run_claude_coach
from .entrypoint import analyze_replay
from .metrics import compute_metrics
from .parser import ParsedRec, parse_rec
from .timeline import build_timeline, render_dual_log, render_salient_log

__all__ = [
    "const",
    "BENCHMARKS",
    "CoachOutput",
    "build_coach_prompt",
    "coach",
    "parse_opening",
    "run_claude_coach",
    "analyze_replay",
    "compute_metrics",
    "ParsedRec",
    "parse_rec",
    "build_timeline",
    "render_dual_log",
    "render_salient_log",
]
```

- [ ] **Step 3: Write the failing entrypoint test (mock parse_rec + coach, no real rec)**

Append to `tests/test_pure.py`:

```python
def test_analyze_replay_data_contract():
    import aoe2coach.entrypoint as ep

    fake_rec = MagicMock()
    fake_rec.ops = []
    fake_rec.duration_ms = 900_000
    fake_rec.me = {"number": 1, "civ_name": "Franks", "profile_id": 42}
    fake_rec.opponent = {"number": 2, "civ_name": "Mayans"}
    fake_rec.my_result = "win"

    with patch.object(ep, "parse_rec", return_value=fake_rec), \
         patch.object(ep, "build_timeline", return_value={"uptimes": {"feudal": None, "castle": None, "imperial": None},
                                                          "units": [], "eco_techs": [], "action_count": 0}), \
         patch.object(ep, "compute_metrics", return_value={"apm": 50, "army": [], "eco_tech_timings": []}), \
         patch.object(ep, "render_dual_log", return_value="# ME = you\n00:00 APM total_actions=0"), \
         patch.object(ep, "coach", return_value=CoachOutput(raw_text="OPENING: Scouts\n\nx", opening_tag="Scouts", model_used="claude-sonnet-4-5")):
        row = ep.analyze_replay("/fake.aoe2record", 42, elo_band="mid")

    assert set(row) == {"match_id", "metrics_json", "salient_log", "game_result",
                        "coach_output", "opening", "civ", "elo_band"}
    assert row["game_result"] == "win"
    assert row["opening"] == "Scouts"
    assert row["civ"] == "Franks"
    assert row["elo_band"] == "mid"
    assert json.loads(row["metrics_json"])["apm"] == 50
    assert all(isinstance(v, str) for v in row.values())
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/nam/aoe2coach && uv run pytest -q`
Expected: PASS (all tests). Also verify the public API: `uv run python -c "import aoe2coach; print(aoe2coach.coach, aoe2coach.analyze_replay, len(aoe2coach.BENCHMARKS))"`.

- [ ] **Step 5: Lint + commit**

```bash
cd /Users/nam/aoe2coach && uvx ruff check . && uvx ruff format .
git add -A && git commit -q -m "feat: analyze_replay eval entrypoint + package re-exports"
```

---

### Task 5: Wire nam-website to `aoe2coach` (editable path dep) + refactor `analyze_match` (byte-identical)

**Files:**
- Modify: `pyproject.toml` (add dep)
- Delete: `website/aoe2/parser.py`, `website/aoe2/timeline.py`, `website/aoe2/metrics.py`, `website/aoe2/const.py`, `website/aoe2/coach.py`
- Modify: `website/aoe2/__init__.py`
- Modify: `website/tasks.py` (lines 12–15 imports; `analyze_match` lines 461–470)
- Modify: `website/tests/test_aoe2.py` (imports; drop tests now living in aoe2coach)

All paths relative to the worktree `/Users/nam/nam-website/.claude/worktrees/aoe2-coach-standalone`. Run bash from there.

**Interfaces:**
- Consumes: `aoe2coach` public API from Task 4.
- Produces: a `analyze_match` Celery task with unchanged DB writes + a private `_run_coach(...)` wrapper.

- [ ] **Step 1: Add `aoe2coach` as an editable path dependency**

```bash
cd /Users/nam/nam-website/.claude/worktrees/aoe2-coach-standalone
uv add --editable /Users/nam/aoe2coach
```
Expected: `pyproject.toml` gains `aoe2coach` under `[project]` dependencies and a `[tool.uv.sources]` editable entry; `uv.lock` updates. (This is a temporary local source; Task 6 switches it to the git remote.)

- [ ] **Step 2: Delete the moved modules and update `website/aoe2/__init__.py`**

```bash
cd /Users/nam/nam-website/.claude/worktrees/aoe2-coach-standalone
git rm -q website/aoe2/parser.py website/aoe2/timeline.py website/aoe2/metrics.py website/aoe2/const.py website/aoe2/coach.py
```

Rewrite `website/aoe2/__init__.py` to re-export from `aoe2coach` (keeps any `from website.aoe2.X import Y` consumers working, and keeps `relic` local):

```python
"""nam-website AoE2 glue. Core coach logic lives in the standalone `aoe2coach` package;
re-exported here for backward-compatible imports. `relic` (Relic ELO API) stays local."""

from aoe2coach import (
    BENCHMARKS,
    CoachOutput,
    ParsedRec,
    analyze_replay,
    build_coach_prompt,
    build_timeline,
    coach,
    compute_metrics,
    const,
    parse_opening,
    parse_rec,
    render_dual_log,
    render_salient_log,
    run_claude_coach,
)

__all__ = [
    "BENCHMARKS", "CoachOutput", "ParsedRec", "analyze_replay", "build_coach_prompt",
    "build_timeline", "coach", "compute_metrics", "const", "parse_opening", "parse_rec",
    "render_dual_log", "render_salient_log", "run_claude_coach",
]
```

- [ ] **Step 3: Update `website/tasks.py` imports**

Replace the four import lines (currently lines 12–15):

```python
from website.aoe2.coach import build_coach_prompt, parse_opening, run_claude_coach
from website.aoe2.metrics import compute_metrics
from website.aoe2.parser import parse_rec
from website.aoe2.timeline import build_timeline, render_dual_log
```

with:

```python
from aoe2coach import BENCHMARKS, build_timeline, coach, compute_metrics, parse_rec, render_dual_log
```

- [ ] **Step 4: Add the prod wrapper + refactor the coach stage in `analyze_match`**

Add this module-level helper near the top of `website/tasks.py` (after imports):

```python
def _run_coach(salient_log, metrics, result):
    """Prod wrapper: read settings, call the pure aoe2coach.coach(), own graceful degradation.

    Returns (coach_analysis, coach_model, opening). On any failure returns ("", "", "")
    so analysis still completes and metrics are saved.
    """
    try:
        model = getattr(dj_settings, "AOE2_COACH_MODEL", "sonnet")
        claude_bin = getattr(dj_settings, "AOE2_CLAUDE_BIN", "claude")
        out = coach(metrics, salient_log, benchmarks=BENCHMARKS, result=result, model=model, claude_bin=claude_bin)
        return out.raw_text, out.model_used, out.opening_tag
    except Exception:  # noqa: BLE001
        logger.warning("Coach stage failed — storing empty coach_analysis")
        return "", "", ""
```

Replace the coach block in `analyze_match` (currently lines 461–470) with:

```python
        # Stage 4: LLM coach — graceful; failure must not block metrics being saved.
        coach_analysis, coach_model, opening = _run_coach(dual_log, metrics, rec.my_result)
        metrics["opening"] = opening
```

Note: behavior is byte-identical — same `dual_log`/`metrics` in, same `run_claude_coach` CLI, same `parse_opening`, and `metrics["opening"]` is set in both the success and failure paths (failure → `""`, matching the old `setdefault("opening", "")`).

- [ ] **Step 5: Update `website/tests/test_aoe2.py`**

The pure-logic tests now live in `aoe2coach`. In nam-website keep only the Django-integration tests (the `analyze_match` orchestration / gate tests and any view tests). Edit the import block (lines 8–12) to import from `aoe2coach` where any retained test still needs a core symbol:

Replace lines 8–12:

```python
from website.aoe2 import const
from website.aoe2.coach import build_coach_prompt, parse_opening, run_claude_coach
from website.aoe2.metrics import compute_metrics
from website.aoe2.parser import parse_rec
from website.aoe2.timeline import build_timeline, render_dual_log, render_salient_log
```

with:

```python
from aoe2coach import (
    build_coach_prompt,
    build_timeline,
    compute_metrics,
    const,
    parse_opening,
    parse_rec,
    render_dual_log,
    render_salient_log,
    run_claude_coach,
)
```

Then delete the test functions that are now duplicated verbatim in `aoe2coach/tests/test_pure.py` (the pure const/timeline/metrics/coach-prompt tests). Retain: the `@requires_fixture` real-rec tests (skip-guarded) and any test that calls `analyze_match` / hits the DB / views. If a retained test asserts pure behavior that is also covered in the package, leave it — duplication across repos is acceptable and adds an integration check.

- [ ] **Step 6: Add a byte-identical integration test for `_run_coach`**

Append to `website/tests/test_aoe2.py`:

```python
from unittest.mock import MagicMock, patch  # noqa: E402 (kept local if not already imported)


def test_run_coach_wrapper_success(settings):
    from website.tasks import _run_coach

    settings.AOE2_COACH_MODEL = "sonnet"
    fake = json.dumps({"result": "OPENING: Scouts\n\nbody", "model": "claude-sonnet-4-5"})
    with patch("aoe2coach.coach.subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=fake, stderr="")
        text, model, opening = _run_coach("00:00 APM total_actions=6", {"apm": 80}, "win")
    assert text == "OPENING: Scouts\n\nbody"
    assert model == "claude-sonnet-4-5"
    assert opening == "Scouts"


def test_run_coach_wrapper_graceful_failure():
    from website.tasks import _run_coach

    with patch("aoe2coach.coach.subprocess.run", side_effect=RuntimeError("boom")):
        text, model, opening = _run_coach("log", {"apm": 1}, "loss")
    assert (text, model, opening) == ("", "", "")
```

- [ ] **Step 7: Run nam-website tests**

Run:
```bash
cd /Users/nam/nam-website/.claude/worktrees/aoe2-coach-standalone
uv run pytest website/tests/test_aoe2.py -q
```
Expected: PASS (integration + wrapper tests; real-rec tests skipped — "fixture not present").

- [ ] **Step 8: Lint + commit**

```bash
cd /Users/nam/nam-website/.claude/worktrees/aoe2-coach-standalone
uvx ruff check website/ && uvx ruff format website/
git add -A && git commit -q -m "refactor(aoe2): consume standalone aoe2coach; analyze_match thin wrapper (byte-identical)"
```

---

### Task 6: Publish `aoe2coach` remote (GitHub MCP) + switch nam-website to a git dependency

**Files:**
- Modify: `pyproject.toml`, `uv.lock` (path source → git source)

**Interfaces:**
- Consumes: the committed `aoe2coach` repo + the nam-website refactor.
- Produces: a pinned git dependency that resolves in CI.

> **Orchestrator-run, requires user confirmation.** Creating a GitHub repo is an external side-effect. The orchestrator (not a subagent) creates it via the GitHub MCP after confirming **repo name** and **visibility** with Nam. CI installs the dependency, so **public** avoids needing a deploy token; if **private**, a follow-up is required to give GitHub Actions read access (PAT/deploy key) — flag this explicitly.

- [ ] **Step 1: Confirm repo name + visibility, then create the remote (GitHub MCP)**

Confirm `name` (default `aoe2coach`) and visibility with Nam. Create via `mcp__plugin_github_github__create_repository`. Capture the resulting `clone_url` / `owner`.

- [ ] **Step 2: Push `aoe2coach`**

```bash
cd /Users/nam/aoe2coach
git remote add origin https://github.com/<owner>/aoe2coach.git
git push -u origin main
```
Record the pushed commit SHA: `git rev-parse HEAD`.

- [ ] **Step 3: Switch nam-website from the path source to the git dependency**

```bash
cd /Users/nam/nam-website/.claude/worktrees/aoe2-coach-standalone
uv remove aoe2coach
uv add "aoe2coach @ git+https://github.com/<owner>/aoe2coach.git@<pushed-sha>"
```
This removes the `[tool.uv.sources]` editable entry and pins the git revision.

- [ ] **Step 4: Verify resolution + full suite**

Run:
```bash
cd /Users/nam/nam-website/.claude/worktrees/aoe2-coach-standalone
uv sync
uv run pytest website/tests/test_aoe2.py -q
```
Expected: `uv sync` resolves `aoe2coach` from git; tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/nam/nam-website/.claude/worktrees/aoe2-coach-standalone
git add pyproject.toml uv.lock
git commit -q -m "build(aoe2): pin aoe2coach git dependency"
```

---

## Self-Review

**Spec coverage (Phase 0 portions of the spec):**
- Standalone repo `aoe2coach`, framework-agnostic, dep `mgz-fast==1.0.0` → Tasks 1–4. ✓
- Pure `coach(metrics, salient_log, benchmarks, result, model="sonnet") -> CoachOutput` → Task 3. ✓ (added `claude_bin` kwarg for the prod wrapper, documented in Interfaces.)
- `BENCHMARKS` exposed as a constant, passed through → Task 3 (sliced for byte-identity). ✓
- `result` accepted as input; baseline prompt unchanged → Task 3 docstring. ✓
- Eval entrypoint `analyze_replay` returning the data contract → Task 4. ✓
- nam-website thin wrapper, settings + try/except in wrapper, DB writes unchanged → Task 5. ✓
- `relic.py` stays → Task 5 Step 2. ✓
- Byte-identical guarantees (COACH_SYSTEM verbatim, prompt structure, wrapper text) → Tasks 3 & 5 tests. ✓
- Separate git repo + git dependency via GitHub MCP → Task 6. ✓
- Testing without real data: synthetic ops + skip-guarded real-rec test → Tasks 2–5. ✓ (The bytes→`parse_action` fidelity test is most relevant to the Phase 2 *new* action types; it is scheduled in the Phase 2 plan when those extractors are added. Phase 0 moves existing code unchanged, so the existing synthetic-ops coverage suffices here.)

**Placeholder scan:** `<owner>` / `<pushed-sha>` in Task 6 are resolved at creation time (the only legitimate runtime values); every other step has concrete code/commands. No TBD/TODO. ✓

**Type consistency:** `CoachOutput(raw_text, opening_tag, model_used)` used identically in Tasks 3, 4, 5. `coach(...)` signature identical across Task 3 (def), Task 4 (call), Task 5 (`_run_coach` call). `run_claude_coach(prompt, model, claude_bin, timeout)` consistent. `analyze_replay` keys match the data-contract test in Task 4. ✓

**Out of scope for Phase 0 (deferred to later plans):** elluminate eval harness (Phase 1), preprocessing/coach enrichment (Phase 2), private-repo CI token follow-up (flagged in Task 6).
