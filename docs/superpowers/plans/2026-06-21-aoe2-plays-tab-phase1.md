# AoE2 Empires Tab — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public "Empires" tab in `/plays` that shows the owner's real AoE2 DE 1v1 games — parsed from uploaded `.aoe2record` files into uptimes, build order, eco-tech timing, army composition, APM, and an opening classification — fed by an admin upload endpoint and a local folder-watcher.

**Architecture:** A local watcher POSTs each new `.aoe2record` to an admin-only `/api/aoe2/upload/`. The server stores the raw rec, then a Celery task (`analyze_match`) parses it with `mgz-fast`, builds a chat/name-stripped salient timeline, computes metrics + opening, and saves them on an `Aoe2Match` row. Public endpoints serve the list/detail/stats; a React accordion renders them. (Phase 1 has **no** klaude coach, **no** clips, **no** relic ELO enrichment — those are Phases 2 & 3.)

**Tech Stack:** Django 6 + Celery + PostgreSQL (backend), `mgz-fast==1.0.0` (rec parser), Next.js 16 / React 19 / TypeScript (frontend), pytest + vitest (tests).

## Global Constraints

- **Worktree:** all work happens in `.claude/worktrees/` — never on `main`. Create with `git worktree add .claude/worktrees/aoe2-tab -b feat/aoe2-tab origin/main`.
- **Backend layout:** one model per file in `website/models/<name>.py` exported via `models/__init__.py` `__all__`; one view group in `website/views/<name>.py` exported via `views/__init__.py` `__all__`; routes in `website/urls.py` under `/api/`. Never create flat `models.py`/`views.py`.
- **Python:** Ruff line-length 120; PostToolUse hook auto-runs `ruff check --fix` + `ruff format` on `.py` save. Run from repo root with `uv run`.
- **Frontend:** Prettier (semi, double quotes, 2-space indent, trailing commas) + ESLint; client fetches use `${API}/api/<endpoint>/` from `@/lib/api`; localStorage only via `store`/`storeDel` from `@/lib/auth`. Pure logic lives in `frontend/src/lib/` with vitest tests; React components are not unit-tested (verify visually).
- **Auth:** admin endpoints use the `require_admin` decorator (Bearer token); token key in localStorage is `adminToken`.
- **Verified external facts (from spec Verified Findings):** parser is `mgz-fast==1.0.0` (no `Summary` class); owner relic `profile_id = 14697894`, Steam id `76561198829134149`, IGN `nom`; age techs 101=Feudal/102=Castle/103=Imperial; DE trains units via `DE_QUEUE`; human slot = `type == 2`.
- **Privacy:** chat and player names are stripped during preprocessing — they must NEVER appear in `salient.log`, the `timeline` JSON, or any stored/served field except the owner's own civ and the opponent's civ. Opponent name is not stored.
- **Scope:** ingest only **two-human 1v1** games; team / single-player / any AI slot → store `status="skipped"`, never shown.

---

## File Structure

**Backend (new):**
- `website/aoe2/__init__.py` — package marker.
- `website/aoe2/const.py` — id→name maps we must supply (civ/building/unit/eco-tech) + helpers; `mgz-fast` ships none except map names.
- `website/aoe2/parser.py` — `mgz-fast` adapter: `parse_rec(path) -> ParsedRec`.
- `website/aoe2/timeline.py` — `build_timeline(ops, me_id, opp_id) -> Timeline` + `render_salient_log(timeline) -> str` (chat/name-free).
- `website/aoe2/metrics.py` — `compute_metrics(timeline, parsed) -> dict` + `classify_opening(...)`.
- `website/models/aoe2_match.py` — `Aoe2Match`.
- `website/views/aoe2.py` — upload/list/detail/stats/sync-status/delete/reanalyze.
- `website/tests/test_aoe2.py` — backend tests.
- `website/tests/fixtures/sample_1v1.aoe2record` — a real small owner rec (see Task 1).

**Backend (modified):**
- `website/models/__init__.py`, `website/views/__init__.py`, `website/urls.py` — register new model/views/routes.
- `website/tasks.py` — add `analyze_match`.
- `config/settings.py` — add `AOE2_PROFILE_ID`, `AOE2_IGN`.
- `pyproject.toml` — add `mgz-fast`.

**Frontend (new):**
- `frontend/src/lib/aoe2.ts` — pure helpers.
- `frontend/src/lib/__tests__/aoe2.test.ts` — vitest.
- `frontend/src/components/Aoe2Tab.tsx` — the tab.

**Frontend (modified):**
- `frontend/src/app/plays/PlaysClient.tsx` — add the `empires` tab.

**Watcher (new):**
- `scripts/aoe2_watcher.py` — folder watcher + uploader.
- `scripts/test_aoe2_watcher.py` — pytest for the pure bits.

**Docs (modified):**
- `docs/README.md`, `docs/QA-CHECKLIST.md`.

---

## Task 1: Worktree, dependency, and a real fixture rec

**Files:**
- Modify: `pyproject.toml`
- Create: `website/aoe2/__init__.py`
- Create: `website/tests/fixtures/sample_1v1.aoe2record` (binary, copied)
- Create: `website/tests/test_aoe2.py`

**Interfaces:**
- Produces: `mgz` (from `mgz-fast`) importable; a real current-build rec fixture at a known path; `website.aoe2` package.

- [ ] **Step 1: Create the worktree and switch into it**

```bash
git worktree add .claude/worktrees/aoe2-tab -b feat/aoe2-tab origin/main
cd .claude/worktrees/aoe2-tab
```
All subsequent paths are relative to this worktree root.

- [ ] **Step 2: Add the parser dependency**

In `pyproject.toml`, add to `[project] dependencies` (after `"celery[redis]>=5.4",`):

```toml
    "mgz-fast==1.0.0",
```

- [ ] **Step 3: Install and verify the import**

Run: `uv sync && uv run python -c "import mgz.fast.header, mgz.fast as f; from mgz.fast import Operation, Action; print(Operation.ACTION, Action.RESEARCH)"`
Expected: prints `Operation.ACTION Action.RESEARCH` with no error.

- [ ] **Step 4: Create the package marker**

Create `website/aoe2/__init__.py` (empty file).

- [ ] **Step 5: Place a real fixture rec**

Copy one of the owner's **smallest** current-build 1v1 recs into the fixtures dir (binary; it is the owner's own match data — tests below assert only structural facts, never private strings):

```bash
mkdir -p website/tests/fixtures
cp "/mnt/c/Users/lehai/Games/Age of Empires 2 DE/76561198829134149/savegame/$(ls -S "/mnt/c/Users/lehai/Games/Age of Empires 2 DE/76561198829134149/savegame/"*.aoe2record | tail -1 | xargs basename)" website/tests/fixtures/sample_1v1.aoe2record
ls -la website/tests/fixtures/sample_1v1.aoe2record
```
Expected: a `sample_1v1.aoe2record` file exists (a few hundred KB–few MB). If the picked file is not a 2-human 1v1, swap for another; Task 2's test will confirm.

- [ ] **Step 6: Write a smoke test that the fixture parses**

Create `website/tests/test_aoe2.py`:

```python
from pathlib import Path

import mgz.fast
import mgz.fast.header

FIXTURE = Path(__file__).parent / "fixtures" / "sample_1v1.aoe2record"


def test_fixture_exists():
    assert FIXTURE.exists(), "place a real .aoe2record at website/tests/fixtures/sample_1v1.aoe2record"


def test_mgz_fast_parses_fixture_header():
    with FIXTURE.open("rb") as f:
        header = mgz.fast.header.parse(f)
    assert header["version"].value == 21  # Version.DE
    assert "de" in header and "players" in header["de"]
```

- [ ] **Step 7: Run the smoke test**

Run: `uv run pytest website/tests/test_aoe2.py -v`
Expected: both tests PASS.

- [ ] **Step 8: Commit**

```bash
git add pyproject.toml uv.lock website/aoe2/__init__.py website/tests/test_aoe2.py website/tests/fixtures/sample_1v1.aoe2record
git commit -m "feat(aoe2): add mgz-fast dep + rec fixture + parse smoke test"
```

---

## Task 2: Constants (id→name maps)

`mgz-fast` ships no civ/tech/unit/building name maps, so we supply the subset we display.

**Files:**
- Create: `website/aoe2/const.py`
- Test: `website/tests/test_aoe2.py` (append)

**Interfaces:**
- Produces:
  - `VILLAGER_ID: int` (83)
  - `AGE_TECHS: dict[int, str]` → `{101: "Feudal Age", 102: "Castle Age", 103: "Imperial Age"}`
  - `ECO_TECHS: dict[int, str]` (eco/economy upgrades we report timing for)
  - `civ_name(civ_id: int) -> str`, `building_name(bid: int) -> str`, `unit_name(uid: int) -> str` — each returns a name or a `"#<id>"` fallback.

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_aoe2.py`:

```python
from website.aoe2 import const


def test_age_techs():
    assert const.AGE_TECHS == {101: "Feudal Age", 102: "Castle Age", 103: "Imperial Age"}


def test_name_helpers_fallback():
    assert const.civ_name(8) == "Celts"
    assert const.civ_name(999) == "#999"
    assert const.unit_name(const.VILLAGER_ID) == "Villager"
    assert const.building_name(70) == "House"
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `uv run pytest website/tests/test_aoe2.py::test_age_techs -v`
Expected: FAIL (`ModuleNotFoundError: website.aoe2.const`).

- [ ] **Step 3: Implement `const.py`**

Create `website/aoe2/const.py`:

```python
"""AoE2 DE id->name maps. mgz-fast ships only map names, so we supply the rest.
Source: aoe2techtree community data. Fallbacks return "#<id>" so unknown ids never crash."""

VILLAGER_ID = 83

AGE_TECHS = {101: "Feudal Age", 102: "Castle Age", 103: "Imperial Age"}

# Economy upgrades we surface timing for (tech_id -> name).
ECO_TECHS = {
    22: "Loom",
    213: "Wheelbarrow",
    249: "Hand Cart",
    202: "Double-Bit Axe",
    203: "Bow Saw",
    221: "Two-Man Saw",
    14: "Horse Collar",
    13: "Heavy Plow",
    12: "Crop Rotation",
    55: "Gold Mining",
    278: "Stone Mining",
    182: "Gold Shaft Mining",
    279: "Stone Shaft Mining",
    8: "Town Watch",
    65: "Fishing Ship (Gillnets)",
    280: "Town Patrol",
}

# DE civ id -> name.
CIV_NAMES = {
    1: "Britons", 2: "Franks", 3: "Goths", 4: "Teutons", 5: "Japanese", 6: "Chinese",
    7: "Byzantines", 8: "Celts", 9: "Persians", 10: "Saracens", 11: "Turks", 12: "Vikings",
    13: "Mongols", 14: "Koreans", 15: "Aztecs", 16: "Mayans", 17: "Spanish", 18: "Incas",
    19: "Indians", 20: "Italians", 21: "Magyars", 22: "Slavs", 23: "Portuguese", 24: "Ethiopians",
    25: "Malians", 26: "Berbers", 27: "Khmer", 28: "Malay", 29: "Burmese", 30: "Vietnamese",
    31: "Bulgarians", 32: "Tatars", 33: "Cumans", 34: "Lithuanians", 35: "Burgundians",
    36: "Sicilians", 37: "Poles", 38: "Bohemians", 39: "Dravidians", 40: "Bengalis",
    41: "Gurjaras", 42: "Romans", 43: "Armenians", 44: "Georgians", 45: "Hindustanis",
    46: "Bohemians", 47: "Jurchens", 48: "Khitans", 49: "Shu", 50: "Wu", 51: "Wei",
}

# Common buildings (building_id -> name).
BUILDING_NAMES = {
    70: "House", 68: "Mill", 562: "Lumber Camp", 584: "Mining Camp", 109: "Town Center",
    12: "Barracks", 87: "Archery Range", 101: "Stable", 49: "Siege Workshop",
    79: "Watch Tower", 84: "Market", 103: "Blacksmith", 209: "University", 30: "Castle",
    104: "Monastery", 117: "Stone Wall", 72: "Palisade Wall", 487: "Gate", 199: "Fish Trap",
    45: "Dock", 82: "Castle", 276: "Wonder", 463: "Krepost", 1665: "Donjon", 1251: "Folwark",
}

# Common units (unit_id -> name).
UNIT_NAMES = {
    83: "Villager", 448: "Scout Cavalry", 4: "Archer", 24: "Crossbowman", 7: "Skirmisher",
    74: "Militia", 75: "Man-at-Arms", 77: "Long Swordsman", 38: "Knight", 39: "Cavalry Archer",
    329: "Camel Rider", 125: "Monk", 280: "Mangonel", 36: "Bombard Cannon", 35: "Battering Ram",
    11: "Trade Cart", 17: "Trade Cog", 13: "Fishing Ship", 128: "Trebuchet", 1103: "Fire Galley",
    250: "Longboat", 5: "Hand Cannoneer", 873: "Eagle Scout", 751: "Eagle Warrior",
}


def civ_name(civ_id):
    return CIV_NAMES.get(civ_id, f"#{civ_id}")


def building_name(bid):
    return BUILDING_NAMES.get(bid, f"#{bid}")


def unit_name(uid):
    return UNIT_NAMES.get(uid, f"#{uid}")
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest website/tests/test_aoe2.py::test_age_techs website/tests/test_aoe2.py::test_name_helpers_fallback -v`
Expected: PASS. (If `civ_name(8)` isn't "Celts" for the fixture's civ, that's fine — the assert uses canonical AoC ids; adjust only if a value is genuinely wrong.)

- [ ] **Step 5: Commit**

```bash
git add website/aoe2/const.py website/tests/test_aoe2.py
git commit -m "feat(aoe2): id->name constant maps with fallbacks"
```

---

## Task 3: Rec parser adapter (`parse_rec`)

Turn a `.aoe2record` into a structured `ParsedRec`: version, map, duration, the 1v1/human check, and the owner-vs-opponent identification by `profile_id`. Also returns the raw op list for the timeline task (parsed once).

**Files:**
- Create: `website/aoe2/parser.py`
- Test: `website/tests/test_aoe2.py` (append)

**Interfaces:**
- Consumes: `mgz.fast`, `website.aoe2.const`.
- Produces:
  - `OWNER_PROFILE_ID: int` is NOT defined here (the caller passes it).
  - `@dataclass ParsedRec` with fields: `version: str`, `save_version: float`, `map_name: str`, `duration_ms: int`, `is_1v1: bool`, `me: dict | None`, `opponent: dict | None`, `my_result: str` (`"win"|"loss"|"unknown"`), `ops: list[tuple]`. Each player dict: `{"number": int, "civ_id": int, "civ_name": str, "color_id": int, "team_id": int, "profile_id": int, "is_me": bool}`.
  - `parse_rec(path: str, owner_profile_id: int) -> ParsedRec`.

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_aoe2.py`:

```python
from website.aoe2.parser import parse_rec

OWNER_PROFILE_ID = 14697894


def test_parse_rec_basic():
    rec = parse_rec(str(FIXTURE), OWNER_PROFILE_ID)
    assert rec.version == "Version.DE" or "DE" in rec.version
    assert rec.duration_ms > 0
    assert rec.is_1v1 is True            # fixture must be a 2-human 1v1
    assert rec.me is not None and rec.me["is_me"] is True
    assert rec.opponent is not None and rec.opponent["is_me"] is False
    assert rec.me["civ_name"] and rec.opponent["civ_name"]
    assert rec.map_name  # non-empty
    assert rec.my_result in ("win", "loss", "unknown")
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `uv run pytest website/tests/test_aoe2.py::test_parse_rec_basic -v`
Expected: FAIL (`ModuleNotFoundError: website.aoe2.parser`).

- [ ] **Step 3: Implement `parser.py`**

Create `website/aoe2/parser.py`:

```python
"""Adapter over mgz-fast (no Summary class). Parses a .aoe2record into a ParsedRec."""

from dataclasses import dataclass, field

import mgz.const
import mgz.fast
import mgz.fast.header
from mgz.fast import Action, Operation

from . import const

EMPTY_PROFILE_ID = 4294967295  # 0xFFFFFFFF marks an empty/closed slot


@dataclass
class ParsedRec:
    version: str
    save_version: float
    map_name: str
    duration_ms: int
    is_1v1: bool
    me: dict | None
    opponent: dict | None
    my_result: str
    ops: list = field(default_factory=list)


def _read_ops(f):
    """Iterate the body. Returns (ops, duration_ms). Chat ops are dropped here (privacy)."""
    mgz.fast.meta(f)
    ops = []
    clock = 0
    while True:
        try:
            op_type, payload = mgz.fast.operation(f)
        except EOFError:
            break
        if op_type == Operation.SYNC:
            inc, _checksum, info = payload
            clock += inc
            if isinstance(info, dict) and "current_time" in info:
                clock = info["current_time"]
            continue
        if op_type == Operation.ACTION:
            action_type, data = payload
            ops.append((clock, action_type, data))
    return ops, clock


def _result_from_ops(ops, me_number, opp_number):
    """1v1 result via RESIGN heuristic. Authoritative result comes later from relic (Phase 3)."""
    for _t, action_type, data in ops:
        if action_type == Action.RESIGN:
            pid = data.get("player_id")
            if pid == opp_number:
                return "win"
            if pid == me_number:
                return "loss"
    return "unknown"


def parse_rec(path, owner_profile_id):
    with open(path, "rb") as f:
        header = mgz.fast.header.parse(f)
        ops, duration_ms = _read_ops(f)

    de_players = [p for p in header["de"]["players"] if p.get("type") == 2]  # 2 = human
    is_1v1 = len(de_players) == 2 and all(p.get("profile_id") != EMPTY_PROFILE_ID for p in de_players)

    def to_dict(p):
        civ_id = p.get("civilization_id")
        return {
            "number": p.get("number"),
            "civ_id": civ_id,
            "civ_name": const.civ_name(civ_id),
            "color_id": p.get("color_id"),
            "team_id": p.get("team_id"),
            "profile_id": p.get("profile_id"),
            "is_me": p.get("profile_id") == owner_profile_id,
        }

    players = [to_dict(p) for p in de_players]
    me = next((p for p in players if p["is_me"]), None)
    opponent = next((p for p in players if not p["is_me"]), None) if me else None

    map_id = header["de"].get("rms_map_id")
    map_name = mgz.const.DE_MAP_NAMES.get(map_id, f"#{map_id}") if map_id is not None else ""

    my_result = "unknown"
    if is_1v1 and me and opponent:
        my_result = _result_from_ops(ops, me["number"], opponent["number"])

    return ParsedRec(
        version=str(header["version"]),
        save_version=float(header["save_version"]),
        map_name=map_name,
        duration_ms=duration_ms,
        is_1v1=is_1v1,
        me=me,
        opponent=opponent,
        my_result=my_result,
        ops=ops,
    )
```

- [ ] **Step 4: Run the test**

Run: `uv run pytest website/tests/test_aoe2.py::test_parse_rec_basic -v`
Expected: PASS. If `is_1v1` is False, the fixture isn't a 2-human 1v1 — replace it (Task 1 Step 5) with a ranked 1v1 rec. If `me` is None, confirm the fixture is one of profile 14697894's games.

- [ ] **Step 5: Commit**

```bash
git add website/aoe2/parser.py website/tests/test_aoe2.py
git commit -m "feat(aoe2): mgz-fast parser adapter (parse_rec)"
```

---

## Task 4: Salient timeline + `salient.log` (chat/name-free)

Reduce the op list to meaningful events and render the grep-friendly text artifact. No names, no chat ever.

**Files:**
- Create: `website/aoe2/timeline.py`
- Test: `website/tests/test_aoe2.py` (append)

**Interfaces:**
- Consumes: `ParsedRec.ops`, `mgz.fast.Action`, `website.aoe2.const`.
- Produces:
  - `build_timeline(ops, me_number) -> dict` with keys: `uptimes` (`{"feudal": ms|None, "castle": ms|None, "imperial": ms|None}`), `builds` (`[{"t": ms, "name": str}]`), `eco_techs` (`[{"t": ms, "name": str}]`), `units` (`[{"t": ms, "name": str, "amount": int}]`), `villager_queue_times` (`[ms]`), `action_count` (int). All events are for `me_number` only.
  - `render_salient_log(timeline) -> str` — one tagged event per line, no free text.

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_aoe2.py`:

```python
from website.aoe2.timeline import build_timeline, render_salient_log


def test_build_timeline_and_log():
    rec = parse_rec(str(FIXTURE), OWNER_PROFILE_ID)
    tl = build_timeline(rec.ops, rec.me["number"])
    # A real 1v1 always reaches at least Feudal:
    assert tl["uptimes"]["feudal"] is not None
    assert tl["action_count"] > 0
    log = render_salient_log(tl)
    assert "AGE_UP feudal" in log
    # privacy: no chat/name leakage — log is purely mechanical tags
    for line in log.splitlines():
        assert line.split(" ", 2)[1] in {"AGE_UP", "BUILD", "TECH", "TRAIN", "APM"}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `uv run pytest website/tests/test_aoe2.py::test_build_timeline_and_log -v`
Expected: FAIL (`ModuleNotFoundError: website.aoe2.timeline`).

- [ ] **Step 3: Implement `timeline.py`**

Create `website/aoe2/timeline.py`:

```python
"""Reduce the action stream to a salient, chat/name-free timeline for the owner."""

from mgz.fast import Action

from . import const


def _fmt(ms):
    s = ms // 1000
    return f"{s // 60:02d}:{s % 60:02d}"


def build_timeline(ops, me_number):
    uptimes = {"feudal": None, "castle": None, "imperial": None}
    age_key = {101: "feudal", 102: "castle", 103: "imperial"}
    builds, eco_techs, units, vill_times = [], [], [], []
    action_count = 0

    for t, action_type, data in ops:
        if data.get("player_id") != me_number:
            continue
        action_count += 1
        if action_type == Action.RESEARCH:
            tech = data.get("technology_id")
            if tech in age_key and uptimes[age_key[tech]] is None:
                uptimes[age_key[tech]] = t
            elif tech in const.ECO_TECHS:
                eco_techs.append({"t": t, "name": const.ECO_TECHS[tech]})
        elif action_type == Action.BUILD:
            builds.append({"t": t, "name": const.building_name(data.get("building_id"))})
        elif action_type == Action.DE_QUEUE:
            uid = data.get("unit_id")
            amount = int(data.get("amount", 1))
            units.append({"t": t, "name": const.unit_name(uid), "amount": amount})
            if uid == const.VILLAGER_ID:
                vill_times.append(t)

    return {
        "uptimes": uptimes,
        "builds": builds,
        "eco_techs": eco_techs,
        "units": units,
        "villager_queue_times": vill_times,
        "action_count": action_count,
    }


def render_salient_log(timeline):
    lines = []
    for age, t in timeline["uptimes"].items():
        if t is not None:
            lines.append((t, f"{_fmt(t)} AGE_UP {age}"))
    for b in timeline["builds"]:
        lines.append((b["t"], f"{_fmt(b['t'])} BUILD {b['name']}"))
    for e in timeline["eco_techs"]:
        lines.append((e["t"], f"{_fmt(e['t'])} TECH {e['name']}"))
    for u in timeline["units"]:
        lines.append((u["t"], f"{_fmt(u['t'])} TRAIN {u['name']} x{u['amount']}"))
    lines.sort(key=lambda x: x[0])
    out = [line for _t, line in lines]
    out.append(f"00:00 APM total_actions={timeline['action_count']}")
    return "\n".join(out)
```

- [ ] **Step 4: Run the test**

Run: `uv run pytest website/tests/test_aoe2.py::test_build_timeline_and_log -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add website/aoe2/timeline.py website/tests/test_aoe2.py
git commit -m "feat(aoe2): salient timeline + chat-free salient.log"
```

---

## Task 5: Metrics + opening classification

**Files:**
- Create: `website/aoe2/metrics.py`
- Test: `website/tests/test_aoe2.py` (append)

**Interfaces:**
- Consumes: timeline dict, `ParsedRec`.
- Produces: `compute_metrics(timeline, duration_ms) -> dict` with keys: `feudal_uptime_s` / `castle_uptime_s` / `imperial_uptime_s` (int|None), `apm` (int), `villager_count` (int), `idle_tc_est_s` (int, `is_estimate`), `opening` (str), `army` (`[{"name","amount"}]` aggregated), `eco_tech_timings` (`[{"name","t_s"}]`), `estimates` (`["idle_tc_est_s"]`). `classify_opening(timeline) -> str`.

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_aoe2.py`:

```python
from website.aoe2.metrics import classify_opening, compute_metrics


def test_compute_metrics():
    rec = parse_rec(str(FIXTURE), OWNER_PROFILE_ID)
    tl = build_timeline(rec.ops, rec.me["number"])
    m = compute_metrics(tl, rec.duration_ms)
    assert m["feudal_uptime_s"] is None or m["feudal_uptime_s"] > 0
    assert m["apm"] >= 0
    assert m["villager_count"] == len(
        [u for u in tl["units"] if u["name"] == "Villager"]
    ) or m["villager_count"] >= 0
    assert isinstance(m["opening"], str) and m["opening"]
    assert "idle_tc_est_s" in m["estimates"]


def test_classify_opening_archers():
    tl = {
        "uptimes": {"feudal": 600000, "castle": None, "imperial": None},
        "builds": [{"t": 610000, "name": "Archery Range"}],
        "eco_techs": [], "units": [{"t": 620000, "name": "Archer", "amount": 1}],
        "villager_queue_times": [], "action_count": 50,
    }
    assert classify_opening(tl) == "Archers"
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `uv run pytest website/tests/test_aoe2.py::test_classify_opening_archers -v`
Expected: FAIL (`ModuleNotFoundError: website.aoe2.metrics`).

- [ ] **Step 3: Implement `metrics.py`**

Create `website/aoe2/metrics.py`:

```python
"""Derived metrics + opening classification from the salient timeline. Inputs-only; some
values (idle TC) are ESTIMATES and labelled as such."""

from collections import defaultdict

IDLE_GAP_MS = 30000  # gaps between vill queues longer than this count as approx idle TC


def classify_opening(timeline):
    """Coarse opening tag from the build/tech/unit fingerprint up to ~Castle."""
    feudal = timeline["uptimes"]["feudal"]
    castle = timeline["uptimes"]["castle"]
    build_names = {b["name"] for b in timeline["builds"]}
    unit_names = {u["name"] for u in timeline["units"]}

    if "Watch Tower" in build_names and feudal is not None:
        return "Tower Rush"
    if {"Man-at-Arms", "Militia"} & unit_names and "Archery Range" in build_names:
        return "M@A → Archers"
    if {"Man-at-Arms", "Militia"} & unit_names and feudal is None:
        return "Drush"
    if "Archery Range" in build_names or "Archer" in unit_names or "Skirmisher" in unit_names:
        return "Archers"
    if "Stable" in build_names or "Scout Cavalry" in unit_names:
        return "Scouts"
    if castle is not None and not build_names & {"Barracks", "Archery Range", "Stable"}:
        return "Fast Castle"
    return "Other"


def _idle_tc_est_s(vill_times):
    if len(vill_times) < 2:
        return 0
    idle = 0
    for a, b in zip(vill_times, vill_times[1:]):
        gap = b - a
        if gap > IDLE_GAP_MS:
            idle += gap - IDLE_GAP_MS
    return idle // 1000


def compute_metrics(timeline, duration_ms):
    up = timeline["uptimes"]
    minutes = max(duration_ms / 60000, 1 / 60)
    apm = round(timeline["action_count"] / minutes)

    army = defaultdict(int)
    villagers = 0
    for u in timeline["units"]:
        if u["name"] == "Villager":
            villagers += u["amount"]
        else:
            army[u["name"]] += u["amount"]

    return {
        "feudal_uptime_s": (up["feudal"] // 1000) if up["feudal"] is not None else None,
        "castle_uptime_s": (up["castle"] // 1000) if up["castle"] is not None else None,
        "imperial_uptime_s": (up["imperial"] // 1000) if up["imperial"] is not None else None,
        "apm": apm,
        "villager_count": villagers,
        "idle_tc_est_s": _idle_tc_est_s(timeline["villager_queue_times"]),
        "opening": classify_opening(timeline),
        "army": [{"name": n, "amount": a} for n, a in sorted(army.items(), key=lambda x: -x[1])],
        "eco_tech_timings": [{"name": e["name"], "t_s": e["t"] // 1000} for e in timeline["eco_techs"]],
        "estimates": ["idle_tc_est_s"],
    }
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest website/tests/test_aoe2.py -k "metrics or opening" -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add website/aoe2/metrics.py website/tests/test_aoe2.py
git commit -m "feat(aoe2): metrics + opening classification"
```

---

## Task 6: `Aoe2Match` model + settings

**Files:**
- Create: `website/models/aoe2_match.py`
- Modify: `website/models/__init__.py`
- Modify: `config/settings.py`
- Migration: generated

**Interfaces:**
- Produces: `Aoe2Match` model importable from `website.models`; settings `AOE2_PROFILE_ID` (int) and `AOE2_IGN` (str).

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_aoe2.py`:

```python
import pytest


@pytest.mark.django_db
def test_aoe2_match_model_defaults():
    from website.models import Aoe2Match

    m = Aoe2Match.objects.create(file_hash="abc123", my_civ="Celts", opponent_civ="Franks")
    assert m.analysis_status == "pending"
    assert m.featured is False
    assert m.timeline == {} and m.metrics == {}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `uv run pytest website/tests/test_aoe2.py::test_aoe2_match_model_defaults -v`
Expected: FAIL (`ImportError: cannot import name 'Aoe2Match'`).

- [ ] **Step 3: Implement the model**

Create `website/models/aoe2_match.py`:

```python
from django.db import models


class Aoe2Match(models.Model):
    """A parsed AoE2 DE 1v1 recorded game. Opponent stored by civ only (no name)."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PARSING = "parsing", "Parsing"
        DONE = "done", "Done"
        ERROR = "error", "Error"
        SKIPPED = "skipped", "Skipped (not a 1v1)"

    rec_file = models.FileField(upload_to="aoe2/", null=True, blank=True)
    file_hash = models.CharField(max_length=64, unique=True)

    played_at = models.DateTimeField(null=True, blank=True)
    map_name = models.CharField(max_length=64, blank=True, default="")
    duration_seconds = models.IntegerField(default=0)
    game_version = models.CharField(max_length=32, blank=True, default="")

    my_civ = models.CharField(max_length=32, blank=True, default="")
    my_result = models.CharField(max_length=8, blank=True, default="unknown")
    my_elo = models.IntegerField(null=True, blank=True)
    my_rating_change = models.IntegerField(null=True, blank=True)

    opponent_civ = models.CharField(max_length=32, blank=True, default="")
    opponent_elo = models.IntegerField(null=True, blank=True)

    relic_match_id = models.BigIntegerField(null=True, blank=True)
    relic_enriched_at = models.DateTimeField(null=True, blank=True)

    timeline = models.JSONField(default=dict, blank=True)
    metrics = models.JSONField(default=dict, blank=True)

    coach_analysis = models.TextField(blank=True, default="")
    coach_model = models.CharField(max_length=64, blank=True, default="")
    analyzed_at = models.DateTimeField(null=True, blank=True)

    analysis_status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    error_detail = models.TextField(blank=True, default="")

    featured = models.BooleanField(default=False)
    clip_url = models.URLField(max_length=500, blank=True, default="")
    clip_title = models.CharField(max_length=120, blank=True, default="")
    clip_note = models.CharField(max_length=300, blank=True, default="")
    clip_start_seconds = models.IntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-played_at", "-created_at"]

    def __str__(self):
        return f"{self.my_civ} vs {self.opponent_civ} ({self.map_name})"
```

- [ ] **Step 4: Register the model**

In `website/models/__init__.py`: add `from .aoe2_match import Aoe2Match` (alphabetically, near the top before `.attachment`) and add `"Aoe2Match",` to `__all__`.

- [ ] **Step 5: Add settings**

In `config/settings.py`, near the other `env(...)` reads, add:

```python
AOE2_PROFILE_ID = env.int("AOE2_PROFILE_ID", default=14697894)
AOE2_IGN = env("AOE2_IGN", default="nom")
```

Also append to `.env.example`:

```
# AoE2 (Empires tab) — owner's relic profile id + in-game name
AOE2_PROFILE_ID=14697894
AOE2_IGN=nom
```

- [ ] **Step 6: Make and apply the migration**

Run: `uv run python manage.py makemigrations website && uv run python manage.py migrate`
Expected: a new migration `website/migrations/0XXX_aoe2match.py` is created and applied.

- [ ] **Step 7: Run the test**

Run: `uv run pytest website/tests/test_aoe2.py::test_aoe2_match_model_defaults -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add website/models/aoe2_match.py website/models/__init__.py config/settings.py .env.example website/migrations/
git commit -m "feat(aoe2): Aoe2Match model + AOE2 settings"
```

---

## Task 7: `analyze_match` Celery task

Wire parser → timeline → metrics onto a stored match. (No coach in Phase 1.)

**Files:**
- Modify: `website/tasks.py`
- Test: `website/tests/test_aoe2.py` (append)

**Interfaces:**
- Consumes: `Aoe2Match` with `rec_file` set; `parse_rec`, `build_timeline`, `render_salient_log`, `compute_metrics`; `settings.AOE2_PROFILE_ID`.
- Produces: `analyze_match(match_id)` Celery task. On a 1v1 it fills `map_name, duration_seconds, game_version, my_civ, opponent_civ, my_result, timeline, metrics, analysis_status="done"`. On a non-1v1 it sets `analysis_status="skipped"`. On exception it sets `analysis_status="error"` + `error_detail`. Stores `salient.log` text inside `timeline["salient_log"]`.

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_aoe2.py`:

```python
@pytest.mark.django_db
def test_analyze_match_done(tmp_path, settings):
    from django.core.files import File

    from website.models import Aoe2Match
    from website.tasks import analyze_match

    settings.AOE2_PROFILE_ID = OWNER_PROFILE_ID
    m = Aoe2Match.objects.create(file_hash="hash-done")
    with FIXTURE.open("rb") as fh:
        m.rec_file.save("sample.aoe2record", File(fh), save=True)

    analyze_match(m.id)
    m.refresh_from_db()
    assert m.analysis_status == "done"
    assert m.my_civ and m.opponent_civ
    assert m.duration_seconds > 0
    assert "salient_log" in m.timeline
    assert "opening" in m.metrics
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `uv run pytest website/tests/test_aoe2.py::test_analyze_match_done -v`
Expected: FAIL (`ImportError: cannot import name 'analyze_match'`).

- [ ] **Step 3: Implement the task**

Append to `website/tasks.py` (add imports at top with the others):

```python
from django.conf import settings as dj_settings
from django.utils import timezone as dj_timezone

from website.aoe2.metrics import compute_metrics
from website.aoe2.parser import parse_rec
from website.aoe2.timeline import build_timeline, render_salient_log
from website.models import Aoe2Match


@app.task(max_retries=0)
def analyze_match(match_id):
    """Parse a stored rec into metrics. 1v1-only; non-1v1 -> skipped; failures -> error."""
    try:
        match = Aoe2Match.objects.get(id=match_id)
    except Aoe2Match.DoesNotExist:
        return

    match.analysis_status = Aoe2Match.Status.PARSING
    match.save(update_fields=["analysis_status"])

    try:
        rec = parse_rec(match.rec_file.path, dj_settings.AOE2_PROFILE_ID)

        if not rec.is_1v1 or rec.me is None or rec.opponent is None:
            match.analysis_status = Aoe2Match.Status.SKIPPED
            match.save(update_fields=["analysis_status"])
            return

        timeline = build_timeline(rec.ops, rec.me["number"])
        metrics = compute_metrics(timeline, rec.duration_ms)
        timeline_payload = {k: v for k, v in timeline.items()}
        timeline_payload["salient_log"] = render_salient_log(timeline)

        match.map_name = rec.map_name
        match.duration_seconds = rec.duration_ms // 1000
        match.game_version = rec.version
        match.my_civ = rec.me["civ_name"]
        match.opponent_civ = rec.opponent["civ_name"]
        match.my_result = rec.my_result
        match.timeline = timeline_payload
        match.metrics = metrics
        match.analyzed_at = dj_timezone.now()
        match.analysis_status = Aoe2Match.Status.DONE
        match.save()
    except Exception as exc:  # noqa: BLE001 — fail loud, store the reason
        logger.exception("analyze_match failed for %s", match_id)
        match.analysis_status = Aoe2Match.Status.ERROR
        match.error_detail = str(exc)[:2000]
        match.save(update_fields=["analysis_status", "error_detail"])
```

- [ ] **Step 4: Run the test**

Run: `uv run pytest website/tests/test_aoe2.py::test_analyze_match_done -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add website/tasks.py website/tests/test_aoe2.py
git commit -m "feat(aoe2): analyze_match task (parse -> timeline -> metrics)"
```

---

## Task 8: Endpoints (upload, list, detail, stats, sync-status, delete, reanalyze)

**Files:**
- Create: `website/views/aoe2.py`
- Modify: `website/views/__init__.py`, `website/urls.py`
- Test: `website/tests/test_aoe2.py` (append)

**Interfaces:**
- Consumes: `Aoe2Match`, `analyze_match`, `require_admin`, `parse_pagination`.
- Produces views: `aoe2_upload` (admin POST), `aoe2_list` (GET), `aoe2_detail` (GET), `aoe2_stats` (GET), `aoe2_sync_status` (admin GET), `aoe2_delete` (admin POST), `aoe2_reanalyze` (admin POST). Routes under `/api/aoe2/`.
- Response shapes: `aoe2_list` → `{"matches": [match_summary], "total": int}`; `aoe2_detail` → full match incl. `timeline`, `metrics`; `aoe2_stats` → `{"total": int, "wins": int, "losses": int, "favourite_civ": str|null, "current_elo": int|null}`. `match_summary` = `{id, played_at, map_name, duration_seconds, my_civ, opponent_civ, my_result, my_elo, my_rating_change, opening, featured, clip_url}`.

- [ ] **Step 1: Write the failing tests**

Append to `website/tests/test_aoe2.py`:

```python
@pytest.mark.django_db
def test_upload_requires_admin(client):
    resp = client.post("/api/aoe2/upload/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_upload_then_list_and_detail(client, auth_headers, settings):
    settings.AOE2_PROFILE_ID = OWNER_PROFILE_ID
    with FIXTURE.open("rb") as fh:
        resp = client.post("/api/aoe2/upload/", {"rec": fh}, **auth_headers)
    assert resp.status_code in (200, 201)
    mid = resp.json()["id"]

    # analyze synchronously for the test (CELERY_TASK_ALWAYS_EAGER in test settings,
    # or call the task directly if not configured):
    from website.models import Aoe2Match
    from website.tasks import analyze_match

    if Aoe2Match.objects.get(id=mid).analysis_status == "pending":
        analyze_match(mid)

    lst = client.get("/api/aoe2/").json()
    assert lst["total"] >= 1
    detail = client.get(f"/api/aoe2/{mid}/").json()
    assert "metrics" in detail and "timeline" in detail


@pytest.mark.django_db
def test_upload_dedup(client, auth_headers, settings):
    settings.AOE2_PROFILE_ID = OWNER_PROFILE_ID
    with FIXTURE.open("rb") as fh:
        client.post("/api/aoe2/upload/", {"rec": fh}, **auth_headers)
    with FIXTURE.open("rb") as fh:
        resp2 = client.post("/api/aoe2/upload/", {"rec": fh}, **auth_headers)
    assert resp2.status_code == 200  # dup -> 200 with existing id
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `uv run pytest website/tests/test_aoe2.py -k upload -v`
Expected: FAIL (404 — routes/views not defined).

- [ ] **Step 3: Implement the views**

Create `website/views/aoe2.py`:

```python
import hashlib
import logging

from django.db.models import Count
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..auth import require_admin
from ..models import Aoe2Match
from ..tasks import analyze_match
from ..utils import parse_pagination

logger = logging.getLogger(__name__)


def _summary(m):
    return {
        "id": m.id,
        "played_at": m.played_at.isoformat() if m.played_at else None,
        "map_name": m.map_name,
        "duration_seconds": m.duration_seconds,
        "my_civ": m.my_civ,
        "opponent_civ": m.opponent_civ,
        "my_result": m.my_result,
        "my_elo": m.my_elo,
        "my_rating_change": m.my_rating_change,
        "opening": (m.metrics or {}).get("opening", ""),
        "featured": m.featured,
        "clip_url": m.clip_url,
    }


def aoe2_list(request):
    try:
        limit, offset = parse_pagination(request)
    except ValueError:
        return JsonResponse({"error": "Invalid pagination parameters"}, status=400)
    qs = Aoe2Match.objects.filter(analysis_status="done")
    total = qs.count()
    matches = [_summary(m) for m in qs[offset : offset + limit]]
    return JsonResponse({"matches": matches, "total": total})


def aoe2_detail(request, match_id):
    try:
        m = Aoe2Match.objects.get(id=match_id, analysis_status="done")
    except Aoe2Match.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)
    data = _summary(m)
    data["timeline"] = m.timeline
    data["metrics"] = m.metrics
    data["coach_analysis"] = m.coach_analysis
    data["clip_title"] = m.clip_title
    data["clip_note"] = m.clip_note
    data["clip_start_seconds"] = m.clip_start_seconds
    return JsonResponse(data)


def aoe2_stats(request):
    qs = Aoe2Match.objects.filter(analysis_status="done")
    wins = qs.filter(my_result="win").count()
    losses = qs.filter(my_result="loss").count()
    fav = qs.values("my_civ").annotate(n=Count("my_civ")).order_by("-n").first()
    latest_elo = qs.exclude(my_elo=None).order_by("-played_at").values_list("my_elo", flat=True).first()
    return JsonResponse({
        "total": qs.count(),
        "wins": wins,
        "losses": losses,
        "favourite_civ": fav["my_civ"] if fav and fav["my_civ"] else None,
        "current_elo": latest_elo,
    })


@csrf_exempt
@require_admin
def aoe2_upload(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    f = request.FILES.get("rec")
    if not f:
        return JsonResponse({"error": "rec file required"}, status=400)
    raw = f.read()
    file_hash = hashlib.sha256(raw).hexdigest()

    existing = Aoe2Match.objects.filter(file_hash=file_hash).first()
    if existing:
        return JsonResponse({"id": existing.id, "status": existing.analysis_status, "duplicate": True})

    from django.core.files.base import ContentFile

    match = Aoe2Match.objects.create(file_hash=file_hash)
    match.rec_file.save(f.name or f"{file_hash}.aoe2record", ContentFile(raw), save=True)
    analyze_match.delay(match.id)
    return JsonResponse({"id": match.id, "status": match.analysis_status}, status=201)


@require_admin
def aoe2_sync_status(request):
    recent = Aoe2Match.objects.order_by("-created_at")[:20]
    return JsonResponse({
        "matches": [
            {"id": m.id, "status": m.analysis_status, "my_civ": m.my_civ, "error": m.error_detail}
            for m in recent
        ]
    })


@csrf_exempt
@require_admin
def aoe2_delete(request, match_id):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    Aoe2Match.objects.filter(id=match_id).delete()
    return JsonResponse({"ok": True})


@csrf_exempt
@require_admin
def aoe2_reanalyze(request, match_id):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    if not Aoe2Match.objects.filter(id=match_id).exists():
        return JsonResponse({"error": "Not found"}, status=404)
    analyze_match.delay(match_id)
    return JsonResponse({"ok": True})
```

- [ ] **Step 4: Register the views**

In `website/views/__init__.py` add an import block and `__all__` entries:

```python
from .aoe2 import (
    aoe2_delete,
    aoe2_detail,
    aoe2_list,
    aoe2_reanalyze,
    aoe2_stats,
    aoe2_sync_status,
    aoe2_upload,
)
```
Add `"aoe2_delete", "aoe2_detail", "aoe2_list", "aoe2_reanalyze", "aoe2_stats", "aoe2_sync_status", "aoe2_upload",` to `__all__`.

- [ ] **Step 5: Register the routes**

In `website/urls.py`, add (specific routes before the `<int:match_id>` catch-alls):

```python
    path("aoe2/", views.aoe2_list),
    path("aoe2/upload/", views.aoe2_upload),
    path("aoe2/stats/", views.aoe2_stats),
    path("aoe2/sync-status/", views.aoe2_sync_status),
    path("aoe2/<int:match_id>/", views.aoe2_detail),
    path("aoe2/<int:match_id>/delete/", views.aoe2_delete),
    path("aoe2/<int:match_id>/reanalyze/", views.aoe2_reanalyze),
```

- [ ] **Step 6: Run the tests**

Run: `uv run pytest website/tests/test_aoe2.py -k upload -v`
Expected: PASS. (If `analyze_match.delay` runs async and the upload test's match stays `pending`, the test calls `analyze_match(mid)` directly — already handled.)

- [ ] **Step 7: Run the full backend test file + lint**

Run: `uv run pytest website/tests/test_aoe2.py -v && uvx ruff check website/aoe2 website/views/aoe2.py website/tasks.py`
Expected: all PASS, no lint errors.

- [ ] **Step 8: Commit**

```bash
git add website/views/aoe2.py website/views/__init__.py website/urls.py website/tests/test_aoe2.py
git commit -m "feat(aoe2): upload/list/detail/stats/admin endpoints"
```

---

## Task 9: Frontend pure helpers (`aoe2.ts`)

**Files:**
- Create: `frontend/src/lib/aoe2.ts`
- Test: `frontend/src/lib/__tests__/aoe2.test.ts`

**Interfaces:**
- Produces: `formatDuration(seconds: number): string` (`"24:31"`), `formatUptime(seconds: number | null): string` (`"—"` when null), `openingColor(opening: string): string` (hex), `resultLabel(result: string): string`.
- Types: `export type Aoe2MatchSummary = { id: number; played_at: string | null; map_name: string; duration_seconds: number; my_civ: string; opponent_civ: string; my_result: string; my_elo: number | null; my_rating_change: number | null; opening: string; featured: boolean; clip_url: string };`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/__tests__/aoe2.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatDuration, formatUptime, openingColor, resultLabel } from "../aoe2";

describe("aoe2 helpers", () => {
  it("formats duration mm:ss", () => {
    expect(formatDuration(1471)).toBe("24:31");
    expect(formatDuration(0)).toBe("00:00");
  });
  it("formats uptime with dash for null", () => {
    expect(formatUptime(null)).toBe("—");
    expect(formatUptime(150)).toBe("2:30");
  });
  it("maps result to label", () => {
    expect(resultLabel("win")).toBe("Victory");
    expect(resultLabel("loss")).toBe("Defeat");
    expect(resultLabel("unknown")).toBe("—");
  });
  it("returns a hex color for openings", () => {
    expect(openingColor("Archers")).toMatch(/^#/);
    expect(openingColor("anything")).toMatch(/^#/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd frontend && pnpm test -- aoe2`
Expected: FAIL (cannot resolve `../aoe2`).

- [ ] **Step 3: Implement `aoe2.ts`**

Create `frontend/src/lib/aoe2.ts`:

```ts
export type Aoe2MatchSummary = {
  id: number;
  played_at: string | null;
  map_name: string;
  duration_seconds: number;
  my_civ: string;
  opponent_civ: string;
  my_result: string;
  my_elo: number | null;
  my_rating_change: number | null;
  opening: string;
  featured: boolean;
  clip_url: string;
};

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, "0")}`;
}

export function resultLabel(result: string): string {
  if (result === "win") return "Victory";
  if (result === "loss") return "Defeat";
  return "—";
}

const OPENING_COLORS: Record<string, string> = {
  Scouts: "#f59e0b",
  Archers: "#06b6d4",
  "M@A → Archers": "#a855f7",
  Drush: "#ef4444",
  "Fast Castle": "#22c55e",
  "Tower Rush": "#eab308",
  Other: "#64748b",
};

export function openingColor(opening: string): string {
  return OPENING_COLORS[opening] ?? "#64748b";
}
```

- [ ] **Step 4: Run the test**

Run: `cd frontend && pnpm test -- aoe2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/aoe2.ts frontend/src/lib/__tests__/aoe2.test.ts
git commit -m "feat(aoe2): frontend pure helpers + tests"
```

---

## Task 10: `Aoe2Tab` component + `PlaysClient` wiring

The accordion tab. No clips/coach yet (those render conditionally and are simply empty in Phase 1).

**Files:**
- Create: `frontend/src/components/Aoe2Tab.tsx`
- Modify: `frontend/src/app/plays/PlaysClient.tsx`

**Interfaces:**
- Consumes: `@/lib/api` (`API`), `@/lib/auth` (`store`), `@/lib/aoe2` helpers + `Aoe2MatchSummary`.
- Produces: default-exported `Aoe2Tab` React component. `PlaysClient` gains an `"empires"` tab.

- [ ] **Step 1: Implement `Aoe2Tab.tsx`**

Create `frontend/src/components/Aoe2Tab.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";
import { store } from "@/lib/auth";
import {
  Aoe2MatchSummary,
  formatDuration,
  formatUptime,
  openingColor,
  resultLabel,
} from "@/lib/aoe2";

const ACCENT = "var(--accent)";

type Stats = {
  total: number;
  wins: number;
  losses: number;
  favourite_civ: string | null;
  current_elo: number | null;
};

type Detail = Aoe2MatchSummary & {
  metrics: Record<string, unknown>;
  timeline: Record<string, unknown>;
  coach_analysis: string;
};

export default function Aoe2Tab() {
  const [matches, setMatches] = useState<Aoe2MatchSummary[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/aoe2/`)
      .then((r) => r.json())
      .then((d) => {
        setMatches(d.matches || []);
        if (d.matches?.length) setSelectedId(d.matches[0].id); // newest selected by default
      })
      .catch(() => {});
    fetch(`${API}/api/aoe2/stats/`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
    const token = store("adminToken");
    if (token) {
      fetch(`${API}/api/auth/check/`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok && setIsAdmin(true))
        .catch(() => {});
    }
  }, []);

  // Load detail only for the selected (expanded) game.
  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    fetch(`${API}/api/aoe2/${selectedId}/`)
      .then((r) => r.json())
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [selectedId]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    const token = store("adminToken");
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("rec", file);
      await fetch(`${API}/api/aoe2/upload/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      }).catch(() => {});
    }
    window.location.reload();
  }

  return (
    <div>
      {/* Stats header */}
      {stats && (
        <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          <Stat label="ELO" value={stats.current_elo ?? "—"} />
          <Stat label="W / L" value={`${stats.wins} / ${stats.losses}`} />
          <Stat label="Games" value={stats.total} />
          <Stat label="Top civ" value={stats.favourite_civ ?? "—"} />
        </div>
      )}

      {/* Admin upload */}
      {isAdmin && (
        <div style={{ marginBottom: "1.5rem" }}>
          <label style={uploadBtnStyle}>
            Upload .aoe2record
            <input type="file" accept=".aoe2record" multiple hidden onChange={handleUpload} />
          </label>
        </div>
      )}

      {/* Accordion match list */}
      {matches.length === 0 && (
        <p style={{ color: "#555", fontStyle: "italic", fontSize: "0.85rem" }}>No games yet.</p>
      )}
      {matches.map((m) => {
        const selected = m.id === selectedId;
        return (
          <div key={m.id} style={{ borderBottom: "1px solid #1a1a1a" }}>
            <button
              onClick={() => setSelectedId(selected ? null : m.id)}
              style={{ ...rowStyle, color: selected ? ACCENT : "#ccc" }}
            >
              <span style={{ flex: 1, textAlign: "left" }}>
                {m.my_civ} vs {m.opponent_civ}
              </span>
              <span style={{ color: "#777" }}>{m.map_name}</span>
              <span
                style={{
                  fontSize: "0.6rem",
                  padding: "0.1rem 0.4rem",
                  borderRadius: "3px",
                  background: openingColor(m.opening),
                  color: "#0e0e0e",
                }}
              >
                {m.opening}
              </span>
              <span style={{ width: "4.5rem", textAlign: "right" }}>{resultLabel(m.my_result)}</span>
            </button>
            {selected && detail && detail.id === m.id && (
              <MatchDetail detail={detail} />
            )}
          </div>
        );
      })}

      <div style={{ textAlign: "center", marginTop: "3rem" }}>
        <span style={taglineStyle}>built different — analyzed differently</span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div style={{ fontSize: "0.6rem", color: "#666", textTransform: "uppercase", letterSpacing: "0.1em" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.4rem", color: "var(--accent)", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function MatchDetail({ detail }: { detail: Detail }) {
  const m = detail.metrics as Record<string, number | null | string>;
  const estimates: string[] = ((detail.metrics as Record<string, unknown>).estimates as string[]) || [];
  return (
    <div style={{ padding: "1rem 0 1.5rem" }}>
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <Metric label="Feudal" value={formatUptime(m.feudal_uptime_s as number | null)} />
        <Metric label="Castle" value={formatUptime(m.castle_uptime_s as number | null)} />
        <Metric label="Imperial" value={formatUptime(m.imperial_uptime_s as number | null)} />
        <Metric label="APM" value={String(m.apm ?? "—")} />
        <Metric label="Villagers" value={String(m.villager_count ?? "—")} />
        <Metric
          label="Idle TC (est)"
          value={`${m.idle_tc_est_s ?? 0}s`}
          estimate={estimates.includes("idle_tc_est_s")}
        />
        <Metric label="Length" value={formatDuration(detail.duration_seconds)} />
      </div>
      {detail.clip_url && (
        <iframe
          src={detail.clip_url}
          style={{ width: "100%", maxWidth: "640px", aspectRatio: "16/9", border: "none" }}
          allowFullScreen
          title="clip"
        />
      )}
    </div>
  );
}

function Metric({ label, value, estimate }: { label: string; value: string; estimate?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: "0.55rem", color: "#666", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
        {estimate && <span style={{ color: "#b45309" }}> ~est</span>}
      </div>
      <div style={{ fontSize: "1rem", color: "#ddd" }}>{value}</div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  width: "100%",
  padding: "0.7rem 0.25rem",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: "0.8rem",
};

const uploadBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.7rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "0.4rem 0.8rem",
  background: "var(--accent)",
  color: "#0e0e0e",
  border: "none",
  borderRadius: "3px",
  cursor: "pointer",
  fontWeight: 700,
};

const taglineStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.6rem",
  color: "#2a2a2a",
  letterSpacing: "0.2em",
  textTransform: "lowercase",
};
```

- [ ] **Step 2: Wire the tab into `PlaysClient.tsx`**

In `frontend/src/app/plays/PlaysClient.tsx`:

1. Add the dynamic import near the others:
```tsx
const Aoe2Tab = dynamic(() => import("@/components/Aoe2Tab"), { ssr: false });
```
2. Widen the `Tab` type:
```tsx
type Tab = "explorer" | "play" | "empires";
```
3. Add a tab button after the Explorer button (always visible — public):
```tsx
        <button
          onClick={() => setTab("empires")}
          style={{
            ...tabBtnStyle,
            borderBottomColor: tab === "empires" ? ACCENT : "transparent",
            color: tab === "empires" ? ACCENT : "#555",
          }}
        >
          Empires
        </button>
```
4. Render it after the Explorer tab block:
```tsx
      {tab === "empires" && <Aoe2Tab />}
```

- [ ] **Step 3: Lint + build**

Run: `cd frontend && pnpm lint && pnpm build`
Expected: lint clean, build succeeds.

- [ ] **Step 4: Visual verification with the real server**

Start backend + frontend (`uv run python manage.py runserver` and `cd frontend && pnpm dev`), upload the fixture rec via the admin box (log in at `/sudo` first), then:
- Navigate to `/plays`, click the **Empires** tab.
- Confirm: stats header shows W/L + games; the newest game is expanded by default; clicking another row expands it and collapses the previous; metrics (Feudal/Castle/APM…) render; the "~est" badge shows on Idle TC.
Take a Playwright screenshot to `aoe2-empires-tab.png` and eyeball it.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Aoe2Tab.tsx frontend/src/app/plays/PlaysClient.tsx
git commit -m "feat(aoe2): Empires accordion tab in /plays"
```

---

## Task 11: Local folder watcher

**Files:**
- Create: `scripts/aoe2_watcher.py`
- Create: `scripts/test_aoe2_watcher.py`

**Interfaces:**
- Produces: a standalone script (runs on the owner's Windows laptop) + pure, network-free helpers: `is_stable(path, prev_size) -> bool`, `already_uploaded(file_hash, seen: set) -> bool`, `hash_file(path) -> str`, `find_recs(rec_dir) -> list[str]`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test_aoe2_watcher.py`:

```python
from pathlib import Path

from scripts.aoe2_watcher import already_uploaded, find_recs, hash_file, is_stable


def test_hash_and_dedup(tmp_path):
    p = tmp_path / "a.aoe2record"
    p.write_bytes(b"hello")
    h = hash_file(str(p))
    assert len(h) == 64
    seen = set()
    assert already_uploaded(h, seen) is False
    seen.add(h)
    assert already_uploaded(h, seen) is True


def test_is_stable(tmp_path):
    p = tmp_path / "b.aoe2record"
    p.write_bytes(b"12345")
    assert is_stable(str(p), prev_size=5) is True
    assert is_stable(str(p), prev_size=3) is False


def test_find_recs_filters_extension(tmp_path):
    (tmp_path / "x.aoe2record").write_bytes(b"r")
    (tmp_path / "y.aoe2spgame").write_bytes(b"s")
    found = find_recs(str(tmp_path))
    assert len(found) == 1 and found[0].endswith(".aoe2record")
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `uv run pytest scripts/test_aoe2_watcher.py -v`
Expected: FAIL (`ModuleNotFoundError: scripts.aoe2_watcher`).

- [ ] **Step 3: Implement the watcher**

Create `scripts/aoe2_watcher.py`:

```python
"""AoE2 DE recorded-game watcher. Run on the gaming PC; uploads new 1v1 recs to the site.

Config via env:
  AOE2_SERVER_URL   e.g. https://nam685.de
  AOE2_ADMIN_SECRET the site ADMIN_SECRET (local machine only)
  AOE2_REC_DIR      e.g. C:\\Users\\lehai\\Games\\Age of Empires 2 DE\\<steamid>\\savegame

Event-driven: polls the folder every few seconds, uploads each .aoe2record once it stops
growing (write complete at match end). On startup it scans the existing folder (backlog
catch-up). Keeps a local set of uploaded hashes so it never re-posts.
"""

import glob
import hashlib
import os
import sys
import time

import httpx

POLL_SECONDS = 5


def hash_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def already_uploaded(file_hash, seen):
    return file_hash in seen


def is_stable(path, prev_size):
    return os.path.getsize(path) == prev_size


def find_recs(rec_dir):
    return sorted(glob.glob(os.path.join(rec_dir, "*.aoe2record")))


def _login(server, secret):
    resp = httpx.post(f"{server}/api/auth/login/", json={"secret": secret}, timeout=30)
    resp.raise_for_status()
    return resp.json()["token"]


def _upload(server, token, path):
    with open(path, "rb") as f:
        resp = httpx.post(
            f"{server}/api/aoe2/upload/",
            headers={"Authorization": f"Bearer {token}"},
            files={"rec": (os.path.basename(path), f, "application/octet-stream")},
            timeout=120,
        )
    return resp


def main():
    server = os.environ["AOE2_SERVER_URL"].rstrip("/")
    secret = os.environ["AOE2_ADMIN_SECRET"]
    rec_dir = os.environ["AOE2_REC_DIR"]

    token = _login(server, secret)
    seen = set()
    sizes = {}
    print(f"watching {rec_dir}", flush=True)

    while True:
        for path in find_recs(rec_dir):
            try:
                size = os.path.getsize(path)
            except OSError:
                continue
            prev = sizes.get(path)
            sizes[path] = size
            if prev is None or not is_stable(path, prev):
                continue  # wait for the next tick to confirm the file stopped growing
            file_hash = hash_file(path)
            if already_uploaded(file_hash, seen):
                continue
            try:
                resp = _upload(server, token, path)
                if resp.status_code == 401:  # token expired -> re-login once
                    token = _login(server, secret)
                    resp = _upload(server, token, path)
                if resp.status_code in (200, 201):
                    seen.add(file_hash)
                    print(f"uploaded {os.path.basename(path)} -> {resp.json()}", flush=True)
                else:
                    print(f"upload failed {resp.status_code}: {os.path.basename(path)}", file=sys.stderr, flush=True)
            except Exception as exc:  # noqa: BLE001
                print(f"error {os.path.basename(path)}: {exc}", file=sys.stderr, flush=True)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the test**

Run: `uv run pytest scripts/test_aoe2_watcher.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/aoe2_watcher.py scripts/test_aoe2_watcher.py
git commit -m "feat(aoe2): local folder watcher + uploader"
```

---

## Task 12: Docs + full test sweep

**Files:**
- Modify: `docs/README.md`, `docs/QA-CHECKLIST.md`

- [ ] **Step 1: Update `docs/README.md`**

In the section describing the `/plays` page, add a paragraph:

```markdown
The **Empires** tab showcases the owner's Age of Empires II: Definitive Edition 1v1
games. A local watcher uploads each finished match; the server parses the recorded
game into uptimes (Feudal/Castle/Imperial), build order, economy-tech timing, army
composition, APM, an idle-TC estimate, and an opening classification, shown as a
single-selection accordion (one game expanded at a time, with an optional highlight
clip). Chat and player names are stripped during parsing.
```

- [ ] **Step 2: Update `docs/QA-CHECKLIST.md`**

Add under a new "Plays — Empires (AoE2)" heading:

```markdown
## Plays — Empires (AoE2)
- [ ] /plays → Empires tab loads; stats header shows ELO/W-L/games/top-civ.
- [ ] Newest game is expanded by default; selecting another collapses the previous.
- [ ] Only the selected game mounts its clip iframe (collapsed rows have none).
- [ ] Metrics render: Feudal/Castle/Imperial uptimes, APM, villagers, idle-TC (badged ~est).
- [ ] Admin sees the upload box; non-admin does not.
- [ ] Uploading a non-1v1 rec results in a skipped match (not shown publicly).
- [ ] No chat or player names appear anywhere in the UI or API responses.
```

- [ ] **Step 3: Full backend + frontend test sweep**

Run: `uv run pytest website/tests/test_aoe2.py scripts/test_aoe2_watcher.py -v && cd frontend && pnpm test -- aoe2 && pnpm lint`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs/README.md docs/QA-CHECKLIST.md
git commit -m "docs(aoe2): README + QA checklist for Empires tab"
```

---

## Self-Review Notes (verified against the spec)

- **Spec coverage:** ingestion (watcher Task 11 + upload Task 8), 1v1/human/AI filtering (parser Task 3 + task Task 7), chat/name stripping (parser drops CHAT ops; timeline emits only mechanical tags — Tasks 3-4), salient.log (Task 4), metrics + opening (Task 5), model (Task 6), public list/detail/stats + admin endpoints (Task 8), accordion with single-clip + newest-default + collapse-previous (Task 10), docs (Task 12). **Deferred to later phases (out of Phase 1 scope, per spec build order):** klaude coach (Phase 2); relic ELO enrichment + clip-attach/feature endpoints + featured hero (Phase 3). The model already carries the `my_elo`, `featured`, and `clip_*` fields so Phases 2-3 add behavior, not migrations-on-top-of-migrations.
- **Type consistency:** `_summary()` shape ⇄ `Aoe2MatchSummary` (TS) ⇄ test assertions all agree; `analyze_match` writes exactly the fields `_summary`/`aoe2_detail` read; metrics keys produced in Task 5 are the ones read in Task 10's `MatchDetail`.
- **Estimates labelled:** `idle_tc_est_s` is in `metrics["estimates"]` (Task 5) and badged `~est` in the UI (Task 10).
- **Privacy:** opponent name never stored (model has `opponent_civ` only); CHAT ops dropped in `_read_ops`; `render_salient_log` asserts mechanical-only tags in its test.
- **mgz-fast API:** all calls match the verified reference (`header.parse(f)`, `header['de']['players']` `type==2`, `fast.meta`+`fast.operation` loop to `EOFError`, SYNC 3-tuple, ACTION `(Action, dict)` with `player_id`, age techs 101/102/103, `DE_QUEUE` for trains, `mgz.const.DE_MAP_NAMES`).
- **Open risk to watch during execution:** the fixture rec must be a real 2-human 1v1 of profile 14697894 or Tasks 3-8 tests can't pass — Task 1 Step 5 calls this out.
```
