# aoe2coach Phase 2 — Enrich Preprocessing + Coach v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract more structured information from the de-noised action log (military tech upgrades, treb/unit milestones, villager-idle gaps, forward-building positions, game-flow facts) and feed it to a restructured coach that records named facts in a mandatory "What happened" summary before any judgment.

**Architecture:** All changes land in the standalone **`aoe2coach`** package (`/Users/nam/aoe2coach`); nam-website only bumps the git pin. New extractors are pure functions over `ops` (`list[(clock_ms, action_type, data)]`), so fully testable with synthetic ops faithful to the `mgz.fast` dict shapes. A new `build_facts()` assembles a structured facts dict; `coach()` gains a v2 prompt that consumes it. The opening tag moves from a redundant standalone line into the (wanted) facts summary, still parsed out for `metrics["opening"]`.

**Tech Stack:** Python 3.12+, `uv`, `pytest`, `mgz-fast==1.0.0`. Consumer: nam-website (Django/Celery) — pin bump only.

## Global Constraints

- All new extractors are **pure functions over `ops`**; no Django/DB/network/settings in `aoe2coach`.
- Synthetic-ops test fixtures must match the real `mgz.fast.parse_action` dict shapes. For any newly-consumed action type, add a **bytes→`parse_action` fidelity test** (pack bytes, run through `mgz.fast.parse_action`, assert keys match the fixture builder).
- **Tech/unit id values** come from aoe2techtree community data (same source as existing `const.py`); they are **best-effort until validated against a real `.aoe2record`** (a validation task is included). The extraction *mechanism* is id-independent and fully tested with synthetic ops.
- **Spatial signals (build positions) are best-effort**; coordinate thresholds need calibration against a real rec (validation task). Missing/zero coordinates must never raise — guard everything.
- Coach changes preserve the contract that `metrics["opening"]` is populated (it drives the UI chip). The standalone redundant `OPENING:` line 1 is **removed**; the opening tag now lives inside the mandatory "What happened" summary and is parsed from there.
- Output stays plain-text from `claude -p`; metrics/timeline JSON additions are **additive** (old rows still read).
- Python: Ruff line-length=120. NOTE: a PostToolUse hook runs `ruff check --fix` (F401) on every `.py` save — when adding an import, add its first usage in the same edit or add the usage first, else the import is stripped.

## File Structure

**`aoe2coach` package (modified/created):**
- `aoe2coach/const.py` — add `MILITARY_TECHS`, `UNIVERSITY_TECHS` maps + `tech_name()`; add `SIEGE_UNIT_IDS`, `MILITARY_BUILDINGS` already exists.
- `aoe2coach/timeline.py` — `build_timeline` surfaces military-tech upgrades + unit milestones; `render_dual_log` adds `UPGRADE` lines (ME full, OPP key).
- `aoe2coach/metrics.py` — add villager-idle/production-gap metrics + milestone timings + forward-building summary.
- `aoe2coach/positions.py` — **new**: base-centroid + forward-building detection (pure, best-effort).
- `aoe2coach/facts.py` — **new**: `build_facts(rec, timeline, metrics) -> dict` assembling the structured facts.
- `aoe2coach/coach.py` — `COACH_SYSTEM_V2`, `build_coach_prompt_v2(facts, salient_log, metrics)`, `parse_opening` handles the summary form; `coach()` builds + uses v2 + facts; `CoachOutput` unchanged.
- `aoe2coach/entrypoint.py` — `analyze_replay` builds facts, passes them through, includes them in the returned dict (additive key `facts_json`).
- `tests/test_pure.py` (or new `tests/test_enrich.py`) — synthetic-ops tests for every extractor + a fidelity test.

**nam-website (worktree):**
- `pyproject.toml` + `uv.lock` — bump `aoe2coach` git pin to the Phase 2 rev.
- `website/tasks.py` — persist new metrics/timeline fields (additive; likely no code change if it already stores the whole metrics/timeline dicts — verify).

---

### Task 1: Military & university tech id maps

**Files:**
- Modify: `/Users/nam/aoe2coach/aoe2coach/const.py`
- Test: `/Users/nam/aoe2coach/tests/test_enrich.py` (create)

**Interfaces:**
- Produces: `MILITARY_TECHS: dict[int,str]`, `UNIVERSITY_TECHS: dict[int,str]`, `tech_name(tid) -> str` (falls back to `#<id>`), `SIEGE_UNIT_IDS: set[int]`.

- [ ] **Step 1: Write the failing test**

Create `/Users/nam/aoe2coach/tests/test_enrich.py`:

```python
from aoe2coach import const


def test_military_tech_names():
    assert const.MILITARY_TECHS[199] == "Fletching"
    assert const.MILITARY_TECHS[67] == "Forging"
    assert const.MILITARY_TECHS[435] == "Bloodlines"
    assert const.UNIVERSITY_TECHS[93] == "Ballistics"
    assert const.tech_name(199) == "Fletching"
    assert const.tech_name(999999) == "#999999"


def test_siege_unit_ids_cover_treb_and_ram():
    # Trebuchet (packed + unpacked) and rams are siege milestones.
    assert 42 in const.SIEGE_UNIT_IDS or 331 in const.SIEGE_UNIT_IDS
    assert 280 in const.SIEGE_UNIT_IDS  # Mangonel
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd /Users/nam/aoe2coach && uv run pytest tests/test_enrich.py -q`
Expected: FAIL — `AttributeError: module 'aoe2coach.const' has no attribute 'MILITARY_TECHS'`.

- [ ] **Step 3: Add the maps to `const.py`**

Append to `const.py` (ids sourced from aoe2techtree; high-confidence common set — extend/validate against a real rec in Task 9):

```python
# Blacksmith + stable/range military upgrades (tech_id -> name). aoe2techtree ids.
# Best-effort starter set; validate against a real rec (see Phase 2 Task 9).
MILITARY_TECHS = {
    199: "Fletching",
    200: "Bodkin Arrow",
    201: "Bracer",
    211: "Padded Archer Armor",
    212: "Leather Archer Armor",
    219: "Ring Archer Armor",
    67: "Forging",
    68: "Iron Casting",
    75: "Blast Furnace",
    81: "Scale Mail Armor",
    76: "Chain Mail Armor",
    77: "Plate Mail Armor",
    82: "Scale Barding Armor",
    83: "Chain Barding Armor",
    80: "Plate Barding Armor",
    435: "Bloodlines",
    215: "Squires",
}

# University / monastery / town-center combat techs that gate timing.
UNIVERSITY_TECHS = {
    93: "Ballistics",
    47: "Chemistry",
    377: "Siege Engineers",
    322: "Murder Holes",
    380: "Heated Shot",
    608: "Arrowslits",
}

# Unit ids that count as a "siege" milestone (treb, rams, mangonel/onager, scorpion, BBC).
SIEGE_UNIT_IDS = {
    42, 331,  # Trebuchet (unpacked / packed)
    280, 550, 588,  # Mangonel / Onager / Siege Onager
    279, 542,  # Scorpion / Heavy Scorpion
    35, 422, 548, 1258,  # Battering/Capped/Siege Ram + alt ram id
    36, 420, 691,  # Bombard Cannon / Cannon Galleon line
}
```

Add the helper after `unit_name`:

```python
def tech_name(tid):
    return MILITARY_TECHS.get(tid) or UNIVERSITY_TECHS.get(tid) or ECO_TECHS.get(tid) or f"#{tid}"
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd /Users/nam/aoe2coach && uv run pytest tests/test_enrich.py -q`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
cd /Users/nam/aoe2coach && uvx ruff check . && uvx ruff format .
git add -A && git commit -m "feat: military/university tech id maps + siege unit ids"
```

---

### Task 2: Surface military-tech upgrades in the timeline + dual log

**Files:**
- Modify: `/Users/nam/aoe2coach/aoe2coach/timeline.py`
- Test: `/Users/nam/aoe2coach/tests/test_enrich.py`

**Interfaces:**
- Consumes: `const.MILITARY_TECHS`, `const.UNIVERSITY_TECHS`.
- Produces: `build_timeline(...)` result gains `"mil_techs": [{"t","name"}]` (ME, first occurrence each). `render_dual_log` emits `UPGRADE` lines: ME for all mil/university techs; OPP for the same set (key markers). Tag set documented in the header.

- [ ] **Step 1: Write the failing test**

```python
from mgz.fast import Action

from aoe2coach.timeline import build_timeline, render_dual_log


def _ops_with_upgrades():
    return [
        (600_000, Action.RESEARCH, {"player_id": 1, "technology_id": 199}),  # ME Fletching
        (700_000, Action.RESEARCH, {"player_id": 1, "technology_id": 93}),   # ME Ballistics
        (605_000, Action.RESEARCH, {"player_id": 2, "technology_id": 67}),   # OPP Forging
    ]


def test_build_timeline_collects_mil_techs():
    tl = build_timeline(_ops_with_upgrades(), me_number=1)
    names = [m["name"] for m in tl["mil_techs"]]
    assert names == ["Fletching", "Ballistics"]


def test_dual_log_has_upgrade_lines_both_roles():
    log = render_dual_log(_ops_with_upgrades(), me_number=1, opp_number=2, me_action_count=2)
    assert "ME UPGRADE Fletching" in log
    assert "ME UPGRADE Ballistics" in log
    assert "OPP UPGRADE Forging" in log
```

- [ ] **Step 2: Run, verify fail** (`KeyError: 'mil_techs'`).

Run: `cd /Users/nam/aoe2coach && uv run pytest tests/test_enrich.py -q`

- [ ] **Step 3: Implement in `timeline.py`**

In `build_timeline`, add near the other accumulators:

```python
    mil_techs, seen_mil = [], set()
```

Inside the RESEARCH branch (after the eco-tech handling), add:

```python
            elif tech in const.MILITARY_TECHS or tech in const.UNIVERSITY_TECHS:
                tname = const.tech_name(tech)
                if tname not in seen_mil:
                    seen_mil.add(tname)
                    mil_techs.append({"t": t, "name": tname})
```

Add `"mil_techs": mil_techs,` to the returned dict.

In `render_dual_log`, in the ME RESEARCH branch add (after the eco-tech `elif`):

```python
                elif tech in const.MILITARY_TECHS or tech in const.UNIVERSITY_TECHS:
                    tname = const.tech_name(tech)
                    if tname not in me_seen_techs:
                        me_seen_techs.add(tname)
                        raw.append((t, "ME", "UPGRADE", tname, 1))
```

In the OPP RESEARCH branch, after the age-up handling, add (track an `opp_seen_techs: set` next to `opp_first_units`):

```python
                elif tech in const.MILITARY_TECHS or tech in const.UNIVERSITY_TECHS:
                    tname = const.tech_name(tech)
                    if tname not in opp_seen_techs:
                        opp_seen_techs.add(tname)
                        raw.append((t, "OPP", "UPGRADE", tname, 1))
```

`UPGRADE` lines must be treated like `TECH` (no spam-collapse): add `"UPGRADE"` wherever `"TECH"` is special-cased in the collapse split, i.e. change the filter to `tag in ("TECH", "UPGRADE")`. Update the header string to mention `UPGRADE`.

- [ ] **Step 4: Run, verify pass.**

Run: `cd /Users/nam/aoe2coach && uv run pytest tests/test_enrich.py -q`

- [ ] **Step 5: Lint + commit**

```bash
cd /Users/nam/aoe2coach && uvx ruff check . && uvx ruff format .
git add -A && git commit -m "feat: surface military/university tech upgrades (ME full, OPP key) in timeline + dual log"
```

---

### Task 3: Villager production gaps / TC idle metrics

**Files:**
- Modify: `/Users/nam/aoe2coach/aoe2coach/metrics.py`
- Test: `/Users/nam/aoe2coach/tests/test_enrich.py`

**Interfaces:**
- Consumes: `timeline["villager_queue_times"]` (already produced by `build_timeline`).
- Produces: metrics dict gains `villager_gaps_s: list[int]` (gaps over threshold), `longest_villager_gap_s: int`, `tc_idle_s: int` (sum of gaps over threshold). Threshold constant `VILL_GAP_THRESHOLD_S = 8`.

- [ ] **Step 1: Write the failing test**

```python
from aoe2coach.metrics import compute_metrics


def _tl(vill_times):
    return {
        "uptimes": {"feudal": None, "castle": None, "imperial": None},
        "units": [], "eco_techs": [], "mil_techs": [], "action_count": 0,
        "villager_queue_times": vill_times,
    }


def test_villager_idle_metrics():
    # villagers queued at 0,25,30,90 s → gaps 25,5,60 → over-threshold (>8s): 25 and 60.
    tl = _tl([0, 25_000, 30_000, 90_000])
    m = compute_metrics(tl, duration_ms=120_000)
    assert m["longest_villager_gap_s"] == 60
    assert m["tc_idle_s"] == 85   # 25 + 60
    assert m["villager_gaps_s"] == [25, 60]


def test_villager_idle_no_villagers():
    m = compute_metrics(_tl([]), duration_ms=60_000)
    assert m["longest_villager_gap_s"] == 0
    assert m["tc_idle_s"] == 0
    assert m["villager_gaps_s"] == []
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement in `compute_metrics`**

Add a module constant `VILL_GAP_THRESHOLD_S = 8` and compute before the return:

```python
    vt = sorted(timeline.get("villager_queue_times", []))
    gaps = [(vt[i] - vt[i - 1]) // 1000 for i in range(1, len(vt))]
    over = [g for g in gaps if g > VILL_GAP_THRESHOLD_S]
    longest_gap = max(gaps) if gaps else 0
```

Add to the returned dict:

```python
        "villager_gaps_s": over,
        "longest_villager_gap_s": longest_gap,
        "tc_idle_s": sum(over),
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Lint + commit**

```bash
cd /Users/nam/aoe2coach && uvx ruff check . && uvx ruff format .
git add -A && git commit -m "feat: villager production-gap / TC-idle metrics"
```

---

### Task 4: Unit milestones (first treb / first siege / first-of-each military unit)

**Files:**
- Modify: `/Users/nam/aoe2coach/aoe2coach/metrics.py`
- Test: `/Users/nam/aoe2coach/tests/test_enrich.py`

**Interfaces:**
- Consumes: `timeline["units"]` (list of `{t, name, amount}` for ME) + `const.SIEGE_UNIT_IDS` is id-based, but `timeline["units"]` stores names; so milestones are computed by name. Produces metrics keys: `first_unit_s: dict[name,int]` (earliest train time per ME military unit, seconds), `first_treb_s: int|None`, `first_siege_s: int|None`.

NOTE: `build_timeline` must also record unit ids to classify siege. Add `"unit_id"` to each `timeline["units"]` entry in Task 4 Step 3a (small timeline change), so metrics can map ids→siege.

- [ ] **Step 1: Write the failing test**

```python
from mgz.fast import Action

from aoe2coach.metrics import compute_metrics
from aoe2coach.timeline import build_timeline


def test_unit_milestones_first_treb_and_siege():
    ops = [
        (600_000, Action.DE_QUEUE, {"player_id": 1, "unit_id": 4, "amount": 3}),    # Archer
        (1_800_000, Action.DE_QUEUE, {"player_id": 1, "unit_id": 280, "amount": 1}),  # Mangonel (siege)
        (2_400_000, Action.DE_QUEUE, {"player_id": 1, "unit_id": 331, "amount": 1}),  # Trebuchet (packed)
    ]
    tl = build_timeline(ops, me_number=1)
    m = compute_metrics(tl, duration_ms=2_700_000)
    assert m["first_unit_s"]["Archer"] == 600
    assert m["first_siege_s"] == 1800  # Mangonel is first siege
    assert m["first_treb_s"] == 2400
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3a: Record `unit_id` in the timeline**

In `build_timeline`'s DE_QUEUE branch, change the appended unit dict to include the id:

```python
            units.append({"t": t, "name": const.unit_name(uid), "amount": amount, "unit_id": uid})
```

- [ ] **Step 3b: Compute milestones in `compute_metrics`**

```python
    first_unit_s, first_siege_s, first_treb_s = {}, None, None
    TREB_IDS = {42, 331}
    for u in timeline.get("units", []):
        if u["name"] == "Villager":
            continue
        t_s = u["t"] // 1000
        first_unit_s.setdefault(u["name"], t_s)
        uid = u.get("unit_id")
        if uid in const.SIEGE_UNIT_IDS and first_siege_s is None:
            first_siege_s = t_s
        if uid in TREB_IDS and first_treb_s is None:
            first_treb_s = t_s
```

Add `from . import const` import at the top of `metrics.py` if not present. Add to the returned dict:

```python
        "first_unit_s": first_unit_s,
        "first_siege_s": first_siege_s,
        "first_treb_s": first_treb_s,
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Lint + commit**

```bash
cd /Users/nam/aoe2coach && uvx ruff check . && uvx ruff format .
git add -A && git commit -m "feat: unit milestones (first treb/siege/first-of-each) metrics"
```

---

### Task 5: Forward-building detection (best-effort positions) + fidelity test

**Files:**
- Create: `/Users/nam/aoe2coach/aoe2coach/positions.py`
- Test: `/Users/nam/aoe2coach/tests/test_enrich.py`

**Interfaces:**
- Produces: `forward_buildings(ops, me_number, mil_building_names) -> list[{name, t, dist}]` — ME military buildings whose distance from ME's base centroid exceeds `FORWARD_DIST` (best-effort; tiles). `base_centroid(ops, me_number) -> (x, y) | None` (mean of the first `BASE_SAMPLE` ME BUILD coords). Constants `FORWARD_DIST = 25.0`, `BASE_SAMPLE = 5`. All guard against missing/zero coords.

- [ ] **Step 1: Write the failing test (includes a bytes→parse_action fidelity check for BUILD)**

```python
import struct

import mgz.fast
from mgz.fast import Action

from aoe2coach.positions import base_centroid, forward_buildings


def test_build_action_fidelity():
    # Confirm our synthetic BUILD dict shape matches mgz.fast.parse_action.
    # BUILD layout: '<xh2fI' after the standard 3-byte (player_id, length) prefix is
    # handled by parse_action; build a minimal valid buffer and compare keys.
    data = struct.pack("<bh", 1, 0) + struct.pack("<xh2fI", 0, 1, 30.0, 31.0, 87)
    out = mgz.fast.parse_action(Action.BUILD, data)
    assert set(["player_id", "x", "y", "building_id"]).issubset(out.keys())


def test_forward_building_detection():
    ops = [
        (10_000, Action.BUILD, {"player_id": 1, "building_id": 70, "x": 20.0, "y": 20.0}),   # House (base)
        (12_000, Action.BUILD, {"player_id": 1, "building_id": 68, "x": 21.0, "y": 19.0}),   # Mill (base)
        (600_000, Action.BUILD, {"player_id": 1, "building_id": 12, "x": 80.0, "y": 80.0}),  # FWD Barracks
    ]
    centroid = base_centroid(ops, me_number=1)
    assert centroid is not None
    fwd = forward_buildings(ops, me_number=1, mil_building_names={"Barracks"})
    assert any(b["name"] == "Barracks" for b in fwd)


def test_forward_building_handles_missing_coords():
    ops = [(10_000, Action.BUILD, {"player_id": 1, "building_id": 12})]  # no x/y
    assert forward_buildings(ops, 1, {"Barracks"}) == []
    assert base_centroid(ops, 1) is None
```

- [ ] **Step 2: Run, verify fail** (`ModuleNotFoundError: aoe2coach.positions`).

- [ ] **Step 3: Implement `positions.py`**

```python
"""Best-effort spatial signals from BUILD coordinates. Calibrate FORWARD_DIST on a real rec."""

import math

from mgz.fast import Action

from . import const

FORWARD_DIST = 25.0  # tiles from base centroid; needs real-rec calibration (Phase 2 Task 9)
BASE_SAMPLE = 5


def _me_builds_with_xy(ops, me_number):
    out = []
    for t, action_type, data in ops:
        if action_type == Action.BUILD and data.get("player_id") == me_number:
            x, y = data.get("x"), data.get("y")
            if x and y:  # guard: missing or 0/0 coords are unusable
                out.append((t, const.building_name(data.get("building_id")), float(x), float(y)))
    return out


def base_centroid(ops, me_number):
    builds = _me_builds_with_xy(ops, me_number)
    if not builds:
        return None
    sample = builds[:BASE_SAMPLE]
    return (sum(b[2] for b in sample) / len(sample), sum(b[3] for b in sample) / len(sample))


def forward_buildings(ops, me_number, mil_building_names):
    centroid = base_centroid(ops, me_number)
    if centroid is None:
        return []
    cx, cy = centroid
    out = []
    for t, name, x, y in _me_builds_with_xy(ops, me_number):
        if name not in mil_building_names:
            continue
        dist = math.hypot(x - cx, y - cy)
        if dist > FORWARD_DIST:
            out.append({"name": name, "t": t, "dist": round(dist, 1)})
    return out
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Lint + commit**

```bash
cd /Users/nam/aoe2coach && uvx ruff check . && uvx ruff format .
git add -A && git commit -m "feat: best-effort forward-building detection + BUILD fidelity test"
```

---

### Task 6: `build_facts()` — assemble the structured facts dict

**Files:**
- Create: `/Users/nam/aoe2coach/aoe2coach/facts.py`
- Test: `/Users/nam/aoe2coach/tests/test_enrich.py`

**Interfaces:**
- Consumes: `ParsedRec` (`rec.my_result`, `rec.me`, `rec.opponent`, `rec.duration_ms`, `rec.ops`), `timeline`, `metrics`, `const.MILITARY_BUILDINGS`.
- Produces: `build_facts(rec, timeline, metrics) -> dict` with keys: `result`, `duration_s`, `my_civ`, `opp_civ`, `age_arrivals_s` ({feudal,castle,imperial}), `army` (list), `military_techs` ([name@s]), `eco_techs` ([name@s]), `first_treb_s`, `first_siege_s`, `apm`, `villager_count`, `tc_idle_s`, `longest_villager_gap_s`, `forward_buildings` ([name@s]), `resign_s` (int|None).

- [ ] **Step 1: Write the failing test**

```python
from types import SimpleNamespace

from mgz.fast import Action

from aoe2coach.facts import build_facts
from aoe2coach.metrics import compute_metrics
from aoe2coach.timeline import build_timeline


def test_build_facts_shape():
    ops = [
        (585_000, Action.RESEARCH, {"player_id": 1, "technology_id": 101}),
        (600_000, Action.RESEARCH, {"player_id": 1, "technology_id": 199}),  # Fletching
        (610_000, Action.DE_QUEUE, {"player_id": 1, "unit_id": 4, "amount": 2}),
        (2_400_000, Action.DE_QUEUE, {"player_id": 1, "unit_id": 331, "amount": 1}),  # Treb
        (2_500_000, Action.RESIGN, {"player_id": 2}),
    ]
    rec = SimpleNamespace(
        my_result="win", duration_ms=2_500_000, ops=ops,
        me={"number": 1, "civ_name": "Mayans"}, opponent={"number": 2, "civ_name": "Franks"},
    )
    tl = build_timeline(ops, 1)
    m = compute_metrics(tl, rec.duration_ms)
    f = build_facts(rec, tl, m)
    assert f["result"] == "win"
    assert f["my_civ"] == "Mayans" and f["opp_civ"] == "Franks"
    assert f["age_arrivals_s"]["feudal"] == 715
    assert "Fletching" in [t.split("@")[0] for t in f["military_techs"]]
    assert f["first_treb_s"] == 2400
    assert f["resign_s"] == 2500
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `facts.py`**

```python
"""Assemble a compact, structured facts dict the coach must restate before judging."""

from mgz.fast import Action

from . import const
from .positions import forward_buildings


def _resign_s(ops, opp_number):
    for t, action_type, data in ops:
        if action_type == Action.RESIGN and data.get("player_id") == opp_number:
            return t // 1000
    return None


def build_facts(rec, timeline, metrics):
    me_no = rec.me["number"]
    opp_no = rec.opponent["number"] if rec.opponent else None
    fwd = forward_buildings(rec.ops, me_no, const.MILITARY_BUILDINGS)
    return {
        "result": rec.my_result,
        "duration_s": rec.duration_ms // 1000,
        "my_civ": rec.me.get("civ_name", ""),
        "opp_civ": (rec.opponent or {}).get("civ_name", ""),
        "age_arrivals_s": {
            "feudal": metrics.get("feudal_uptime_s"),
            "castle": metrics.get("castle_uptime_s"),
            "imperial": metrics.get("imperial_uptime_s"),
        },
        "apm": metrics.get("apm"),
        "villager_count": metrics.get("villager_count"),
        "army": metrics.get("army", []),
        "military_techs": [f"{m['name']}@{m['t'] // 1000}s" for m in timeline.get("mil_techs", [])],
        "eco_techs": [f"{e['name']}@{e['t_s']}s" for e in metrics.get("eco_tech_timings", [])],
        "first_treb_s": metrics.get("first_treb_s"),
        "first_siege_s": metrics.get("first_siege_s"),
        "tc_idle_s": metrics.get("tc_idle_s", 0),
        "longest_villager_gap_s": metrics.get("longest_villager_gap_s", 0),
        "forward_buildings": [f"{b['name']}@{b['t'] // 1000}s" for b in fwd],
        "resign_s": _resign_s(rec.ops, opp_no) if opp_no is not None else None,
    }
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Lint + commit**

```bash
cd /Users/nam/aoe2coach && uvx ruff check . && uvx ruff format .
git add -A && git commit -m "feat: build_facts() structured facts assembler"
```

---

### Task 7: Coach v2 — facts block + mandatory "What happened" summary; opening from summary

**Files:**
- Modify: `/Users/nam/aoe2coach/aoe2coach/coach.py`
- Test: `/Users/nam/aoe2coach/tests/test_enrich.py`

**Interfaces:**
- Produces: `COACH_SYSTEM_V2: str`; `build_coach_prompt_v2(facts: dict, salient_log: str, metrics: dict) -> str`; `parse_opening` updated to also match `Opening: <tag>` inside the summary (keep the legacy `OPENING:` match for back-compat); `coach()` gains `facts: dict | None = None` param — when provided, uses v2 prompt; else falls back to v1 (byte-identical for callers that don't pass facts).

- [ ] **Step 1: Write the failing test**

```python
import json
from unittest.mock import MagicMock, patch

from aoe2coach.coach import COACH_SYSTEM_V2, build_coach_prompt_v2, coach, parse_opening


def test_parse_opening_from_summary_line():
    assert parse_opening("WHAT HAPPENED\n- Opening: Fast Castle\n\nANALYSIS\n...") == "Fast Castle"
    assert parse_opening("OPENING: Scouts\n\nbody") == "Scouts"  # legacy still works


def test_prompt_v2_contains_facts_and_requires_summary():
    facts = {"result": "win", "first_treb_s": 1420, "army": [{"name": "Archer", "amount": 18}]}
    p = build_coach_prompt_v2(facts, "00:00 APM total_actions=6", {"apm": 80})
    assert "MATCH FACTS" in p
    assert "WHAT HAPPENED" in COACH_SYSTEM_V2
    assert "first_treb_s" in p  # facts are serialized into the prompt
    assert p.rstrip().endswith("Now write the coach report.")


def test_coach_uses_v2_when_facts_given():
    fake = json.dumps({"result": "WHAT HAPPENED\n- Opening: Archers\n\nANALYSIS\nx", "model": "claude-sonnet-4-5"})
    with patch("aoe2coach.coach.subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=fake, stderr="")
        out = coach({"apm": 80}, "log", facts={"result": "win"})
    assert out.opening_tag == "Archers"
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement v2 in `coach.py`**

Add the v2 system prompt (reuse `BENCHMARKS` + the same benchmark/threshold knowledge; the key change is the mandatory summary and named markers, and dropping the standalone `OPENING:` line):

```python
COACH_SYSTEM_V2 = f"""\
You are a concise, precise Age of Empires II: Definitive Edition 1v1 coaching assistant.
You receive a STRUCTURED MATCH FACTS block (authoritative numbers) and a mechanical salient
log. Rely on the FACTS block for all numbers; use the log only for sequence/context.

{COACH_SYSTEM[COACH_SYSTEM.index("AGE_UP TIMESTAMPS"):COACH_SYSTEM.index("Output format")]}
You MUST record these specific markers when present (do not decide which matter — record all):
first treb timing, first siege timing, age-up ARRIVAL times, army composition, eco/military
tech timings, villager idle time, forward buildings, and how the game ended (who won and the
mechanism, e.g. "opponent resigned after losing eco to archer raids").

Output format — plain text, two sections:
  WHAT HAPPENED
  - Opening: <tag>            (one of: scouts, archers, maa_archers, drush, fast_castle, tower_rush, unknown)
  - then 4-7 short factual bullets restating the key markers above (timings, comp, outcome).
  Blank line.
  ANALYSIS
  - 3-4 short prose paragraphs of judgment ONLY (uptime vs benchmark, eco/production, the single
    most impactful observation, and one concrete improvement). Do NOT restate raw facts here.

Do NOT emit a standalone "OPENING:" line — the opening is the first bullet of WHAT HAPPENED.
Keep the whole report under 320 words. No fluff.
"""


def build_coach_prompt_v2(facts: dict, salient_log: str, metrics: dict) -> str:
    import json as _json

    return (
        f"{COACH_SYSTEM_V2}\n\n"
        "=== MATCH FACTS (authoritative) ===\n"
        f"{_json.dumps(facts, indent=2)}\n\n"
        "=== SALIENT LOG ===\n"
        f"{salient_log}\n\n"
        "Now write the coach report."
    )
```

Update `parse_opening` to also match the summary bullet (keep legacy):

```python
_OPENING_RE = re.compile(r"^\s*(?:-\s*)?OPENING:\s*(.+)|^\s*-\s*Opening:\s*(.+)", re.MULTILINE | re.IGNORECASE)


def parse_opening(text: str) -> str:
    m = _OPENING_RE.search(text)
    if not m:
        return ""
    return (m.group(1) or m.group(2) or "").strip()
```

Update `coach()` to take `facts` and branch:

```python
def coach(metrics, salient_log, benchmarks=BENCHMARKS, result="unknown",  # noqa: ARG001
          model="sonnet", claude_bin="claude", facts=None):
    prompt = build_coach_prompt_v2(facts, salient_log, metrics) if facts is not None else build_coach_prompt(salient_log, metrics)
    raw_text, model_used = run_claude_coach(prompt, model=model, claude_bin=claude_bin)
    return CoachOutput(raw_text=raw_text, opening_tag=parse_opening(raw_text), model_used=model_used)
```

(Keep `result`'s `# noqa: ARG001`; `benchmarks` is now used inside `COACH_SYSTEM_V2` via `BENCHMARKS` at module load, but the param itself is still unused → keep its noqa.)

- [ ] **Step 4: Run, verify pass** (and re-run the full suite — v1 tests must still pass).

Run: `cd /Users/nam/aoe2coach && uv run pytest -q`

- [ ] **Step 5: Lint + commit**

```bash
cd /Users/nam/aoe2coach && uvx ruff check . && uvx ruff format .
git add -A && git commit -m "feat: coach v2 — facts block + mandatory WHAT HAPPENED summary; opening parsed from summary"
```

---

### Task 8: Wire `analyze_replay` + `analyze_match` to build/pass facts; bump nam-website pin

**Files:**
- Modify: `/Users/nam/aoe2coach/aoe2coach/entrypoint.py`, `aoe2coach/__init__.py`
- Modify (nam-website worktree): `website/tasks.py`, `pyproject.toml`, `uv.lock`
- Test: `/Users/nam/aoe2coach/tests/test_enrich.py`; `website/tests/test_aoe2.py`

**Interfaces:**
- `analyze_replay` builds facts via `build_facts` and (a) passes `facts=` to `coach()`, (b) adds `"facts_json": json.dumps(facts)` to the returned dict (additive). `aoe2coach.__init__` re-exports `build_facts`.
- nam-website `analyze_match`: builds facts and passes `facts=` through `_run_coach` → `coach()`; persists the enriched `metrics`/`timeline` (additive — verify the task already stores the full dicts, which it does via `match.metrics = metrics`).

- [ ] **Step 1 (aoe2coach): update `entrypoint.py`** — import `build_facts`, build it after metrics, pass `facts=facts` to `coach()`, add `"facts_json": json.dumps(facts)` to the returned dict. Re-export `build_facts` in `__init__.py` (add usage in `__all__`).

- [ ] **Step 2 (aoe2coach): test** — extend `test_analyze_replay_data_contract` (in test_pure.py) to assert `"facts_json"` is present and is valid JSON. Patch `build_facts` too in that test's `patch.object` block. Run `uv run pytest -q`.

- [ ] **Step 3 (aoe2coach): commit + push + capture new rev**

```bash
cd /Users/nam/aoe2coach && uvx ruff check . && uvx ruff format . && uv run pytest -q
git add -A && git commit -m "feat: analyze_replay builds + returns facts; pass facts to coach v2"
git push origin main && git rev-parse HEAD
```

- [ ] **Step 4 (nam-website): update `_run_coach` + `analyze_match` to build and pass facts**

In `website/tasks.py`, import `build_facts`; in `analyze_match`, after metrics/dual_log:

```python
        facts = build_facts(rec, timeline, metrics)
        coach_analysis, coach_model, opening = _run_coach(dual_log, metrics, rec.my_result, facts)
        metrics["opening"] = opening
```

and update `_run_coach(salient_log, metrics, result, facts=None)` to pass `facts=facts` into `coach(...)`. (Add `build_facts` to the `from aoe2coach import ...` line — add its usage in the same edit to dodge the import-stripping hook.)

- [ ] **Step 5 (nam-website): bump the git pin**

```bash
cd /Users/nam/nam-website/.claude/worktrees/aoe2-coach-standalone
uv lock --upgrade-package aoe2coach   # or: edit the @<rev> in pyproject to the Step-3 sha, then `uv lock`
uv sync
```

- [ ] **Step 6 (nam-website): update the analyze_match success test** to also assert the enriched fields persist (e.g. `m.metrics["tc_idle_s"]` exists / `m.metrics["first_treb_s"]`), using the `_fake_pipeline` stub extended with the new metrics keys. Run the suite **at home** (Django/DB needed): `uv run pytest website/tests/test_aoe2.py`.

- [ ] **Step 7: commit (nam-website)**

```bash
git add -A && git commit -m "feat(aoe2): pass structured facts to coach v2; bump aoe2coach pin"
```

---

### Task 9: Validation against a real rec (at home) + id/threshold calibration

**Files:** none (verification task); may produce small follow-up commits to `const.py`/`positions.py`.

- [ ] **Step 1:** Place a real ranked-1v1 `.aoe2record` at `website/tests/fixtures/sample_1v1.aoe2record` (gitignored).
- [ ] **Step 2:** Run the skip-guarded pipeline test + a manual dump: `uv run python -c "from aoe2coach import analyze_replay; import json; print(json.dumps(analyze_replay('website/tests/fixtures/sample_1v1.aoe2record', <YOUR_PROFILE_ID>)['facts_json']))"`.
- [ ] **Step 3:** Verify: military-tech ids resolve to real names (no `#<id>` for common upgrades) — extend `MILITARY_TECHS`/`UNIVERSITY_TECHS` if any common upgrade shows as `#id`. Verify `forward_buildings` matches what actually happened in the game; tune `FORWARD_DIST` (and decide whether opponent-start-relative frontal/flank is worth adding) against the real coordinates.
- [ ] **Step 4:** Read the coach v2 output on the real rec; confirm the WHAT HAPPENED summary records the named markers (treb timing, outcome, etc.) and the opening parses into `metrics["opening"]`.
- [ ] **Step 5:** Commit any id/threshold fixes to aoe2coach; bump the nam-website pin.

---

## Self-Review

**Spec coverage (Phase 2 section of the spec + the user's clarifications):**
- Tech upgrades surfaced (ME full, OPP key) → Tasks 1-2. ✓
- Treb/unit milestones (treb timing explicit) → Tasks 1 (siege ids), 4. ✓
- Villager idle / production gaps → Task 3. ✓
- Build positions (forward/proxy) → Task 5 (forward detection; frontal/flank flagged for real-rec calibration in Task 9). ✓
- Game-flow narrative ("who won how": push style, frontal/flank, raids, resign trigger) → facts (`forward_buildings`, `first_treb_s`, `resign_s`, `result`) + the coach's mandatory outcome marker (Tasks 6-7). ✓ (frontal/flank depth pending Task 9 calibration — flagged.)
- Coach: structured facts block + mandatory "What happened" summary + explicitly-named markers → Task 7. ✓
- Drop redundant `OPENING:` line; opening still populates `metrics["opening"]` (parsed from the summary's `Opening:` bullet) → Task 7. ✓
- Coach + stored metrics only (no frontend changes) → metrics/timeline JSON additions are additive; nam-website persists the whole dicts. ✓
- Testing without real data: synthetic ops + a BUILD fidelity test; real-rec validation deferred to Task 9. ✓
- Eval criteria #2/#10 v2 variant: the output contract changed (no standalone `OPENING:` line; opening is the first summary bullet) → **flagged for the Phase 1 harness** to add v2 criteria; not changed here.

**Placeholder scan:** `<YOUR_PROFILE_ID>` and `<rev>`/Step-3 sha in Tasks 8-9 are resolve-at-runtime values. Tech ids are a confident starter set with an explicit Task-9 validation pass (the mechanism is fully tested independent of id values). No TBD/TODO in code steps.

**Type consistency:** `build_facts(rec, timeline, metrics)` signature consistent across Tasks 6, 8. `coach(..., facts=None)` consistent across Tasks 7, 8. `forward_buildings(ops, me_number, mil_building_names)` consistent across Tasks 5, 6. New metrics keys (`first_treb_s`, `tc_idle_s`, `mil_techs`, etc.) named identically where produced (timeline/metrics) and consumed (facts).

**Open design decision flagged for the human:** frontal-vs-flank classification needs an opponent-start reference (header coords or a heuristic), which only calibrates against a real rec — Task 5 ships forward-distance detection (no OPP coords needed); the richer frontal/flank signal is deferred to Task 9 where real coordinates exist.
