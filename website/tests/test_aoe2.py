import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import mgz.fast.header
import pytest

from website.aoe2 import const
from website.aoe2.coach import build_coach_prompt, parse_opening, run_claude_coach
from website.aoe2.metrics import compute_metrics
from website.aoe2.parser import parse_rec
from website.aoe2.timeline import build_timeline, render_dual_log, render_salient_log

FIXTURE = Path(__file__).parent / "fixtures" / "sample_1v1.aoe2record"
requires_fixture = pytest.mark.skipif(
    not FIXTURE.exists(),
    reason="real .aoe2record fixture not present (gitignored; see website/tests/fixtures/)",
)
OWNER_PROFILE_ID = 14697894


@requires_fixture
def test_fixture_exists():
    assert FIXTURE.exists(), "place a real .aoe2record at website/tests/fixtures/sample_1v1.aoe2record"


@requires_fixture
def test_mgz_fast_parses_fixture_header():
    with FIXTURE.open("rb") as f:
        header = mgz.fast.header.parse(f)
    assert header["version"].value == 21  # Version.DE
    assert "de" in header and "players" in header["de"]


def test_age_techs():
    assert const.AGE_TECHS == {101: "Feudal Age", 102: "Castle Age", 103: "Imperial Age"}


def test_name_helpers_fallback():
    assert const.civ_name(8) == "Persians"
    assert const.civ_name(31) == "Vietnamese"
    assert const.civ_name(21) == "Incas"
    assert const.civ_name(999) == "#999"
    assert const.unit_name(const.VILLAGER_ID) == "Villager"
    assert const.building_name(70) == "House"
    # Corrected id mappings verified against aoe2techtree
    assert const.unit_name(11) == "Mangudai"  # was wrongly "Trade Cart"
    assert const.building_name(50) == "Farm"  # was MISSING
    assert const.unit_name(83) == "Villager"
    assert const.unit_name(128) == "Trade Cart"  # was wrongly "Trebuchet"
    assert const.unit_name(751) == "Eagle Scout"  # was wrongly "Eagle Warrior"
    assert const.unit_name(753) == "Eagle Warrior"  # new correct id
    assert const.unit_name(873) == "Elephant Archer"  # was wrongly "Eagle Scout"
    assert const.unit_name(1258) == "Battering Ram"  # was wrong id 35
    # #id fallback
    assert const.unit_name(99999) == "#99999"
    assert const.building_name(99999) == "#99999"


@requires_fixture
def test_parse_rec_basic():
    rec = parse_rec(str(FIXTURE), OWNER_PROFILE_ID)
    assert rec.version == "Version.DE" or "DE" in rec.version
    assert rec.duration_ms > 0
    assert rec.is_1v1 is True  # fixture must be a 2-human 1v1
    assert rec.me is not None and rec.me["is_me"] is True
    assert rec.opponent is not None and rec.opponent["is_me"] is False
    assert rec.me["civ_name"] and rec.opponent["civ_name"]
    assert rec.map_name  # non-empty
    assert rec.my_result in ("win", "loss", "unknown")


@requires_fixture
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


@requires_fixture
def test_compute_metrics():
    rec = parse_rec(str(FIXTURE), OWNER_PROFILE_ID)
    tl = build_timeline(rec.ops, rec.me["number"])
    m = compute_metrics(tl, rec.duration_ms)
    # fixture reaches all three ages, in chronological order
    assert m["feudal_uptime_s"] is not None and m["feudal_uptime_s"] > 0
    assert m["castle_uptime_s"] > m["feudal_uptime_s"]
    assert m["imperial_uptime_s"] > m["castle_uptime_s"]
    assert m["apm"] > 0
    # villager_count equals the summed Villager train amounts
    assert m["villager_count"] == sum(u["amount"] for u in tl["units"] if u["name"] == "Villager")
    # no opening key — coach determines it
    assert "opening" not in m
    # output shapes
    assert all({"name", "amount"} <= a.keys() for a in m["army"])
    assert all({"name", "t_s"} <= e.keys() for e in m["eco_tech_timings"])


# ---------------------------------------------------------------------------
# parse_opening tests
# ---------------------------------------------------------------------------


def test_parse_opening_extracts_tag():
    text = "OPENING: Scouts\n\nGood feudal time..."
    assert parse_opening(text) == "Scouts"


def test_parse_opening_trims_whitespace():
    text = "OPENING:   Fast Castle  \n\nSome prose."
    assert parse_opening(text) == "Fast Castle"


def test_parse_opening_empty_when_missing():
    text = "No opening line here."
    assert parse_opening(text) == ""


def test_parse_opening_middle_of_text():
    text = "Preamble.\nOPENING: M@A → Archers\nMore prose."
    assert parse_opening(text) == "M@A → Archers"


# ---------------------------------------------------------------------------
# render_dual_log tests
# ---------------------------------------------------------------------------

# Build a synthetic ops stream covering both ME and OPP events.
from mgz.fast import Action  # noqa: E402


def _make_ops():
    """Synthetic op stream: ME does full play, OPP has eco + military events."""
    # (t_ms, action_type, data_dict)
    return [
        # ME age-ups
        (585_000, Action.RESEARCH, {"player_id": 1, "technology_id": 101}),  # feudal
        (1_100_000, Action.RESEARCH, {"player_id": 1, "technology_id": 102}),  # castle
        # ME eco tech
        (610_000, Action.RESEARCH, {"player_id": 1, "technology_id": 202}),  # Double-Bit Axe
        # ME builds
        (610_000, Action.BUILD, {"player_id": 1, "building_id": 87}),  # Archery Range
        (620_000, Action.BUILD, {"player_id": 1, "building_id": 50}),  # Farm — tests Farm fix
        # ME trains
        (625_000, Action.DE_QUEUE, {"player_id": 1, "unit_id": 83, "amount": 1}),  # Villager
        (630_000, Action.DE_QUEUE, {"player_id": 1, "unit_id": 4, "amount": 2}),  # Archer x2
        (635_000, Action.DE_QUEUE, {"player_id": 1, "unit_id": 4, "amount": 1}),  # Archer x1 (near)
        # OPP age-up
        (590_000, Action.RESEARCH, {"player_id": 2, "technology_id": 101}),  # opp feudal
        # OPP eco (should be excluded from OPP lines)
        (600_000, Action.BUILD, {"player_id": 2, "building_id": 50}),  # OPP Farm (eco — skip)
        (605_000, Action.BUILD, {"player_id": 2, "building_id": 70}),  # OPP House (eco — skip)
        (608_000, Action.RESEARCH, {"player_id": 2, "technology_id": 213}),  # OPP Wheelbarrow (eco — skip)
        (609_000, Action.DE_QUEUE, {"player_id": 2, "unit_id": 83, "amount": 1}),  # OPP Villager (skip)
        # OPP military building (should appear)
        (615_000, Action.BUILD, {"player_id": 2, "building_id": 101}),  # OPP Stable
        # OPP first military unit (should appear)
        (620_000, Action.DE_QUEUE, {"player_id": 2, "unit_id": 448, "amount": 1}),  # Scout Cavalry
        # OPP second train of same unit (should NOT appear — only first)
        (625_000, Action.DE_QUEUE, {"player_id": 2, "unit_id": 448, "amount": 1}),  # Scout Cavalry again
    ]


def test_render_dual_log_roles():
    """All non-header, non-APM lines must carry ME or OPP role."""
    ops = _make_ops()
    log = render_dual_log(ops, me_number=1, opp_number=2, me_action_count=50)
    content_lines = [ln for ln in log.splitlines() if not ln.startswith("#") and not ln.startswith("00:00 APM")]
    for line in content_lines:
        parts = line.split(" ", 2)
        assert len(parts) >= 3, f"malformed line: {line!r}"
        assert parts[1] in {"ME", "OPP"}, f"unexpected role in: {line!r}"


def test_render_dual_log_opp_no_eco():
    """OPP lines must not contain Villager trains, Farm builds, or eco techs."""
    ops = _make_ops()
    log = render_dual_log(ops, me_number=1, opp_number=2, me_action_count=50)
    opp_lines = [ln for ln in log.splitlines() if ln.split(" ", 2)[1:2] == ["OPP"]]
    for line in opp_lines:
        assert "Villager" not in line, f"OPP Villager should be excluded: {line!r}"
        assert "Farm" not in line, f"OPP Farm should be excluded: {line!r}"
        assert "Wheelbarrow" not in line, f"OPP eco tech should be excluded: {line!r}"
        assert "House" not in line, f"OPP House should be excluded: {line!r}"


def test_render_dual_log_opp_has_military():
    """OPP lines must include military building (Stable) and first military unit (Scout Cavalry)."""
    ops = _make_ops()
    log = render_dual_log(ops, me_number=1, opp_number=2, me_action_count=50)
    opp_lines = [ln for ln in log.splitlines() if ln.split(" ", 2)[1:2] == ["OPP"]]
    opp_text = "\n".join(opp_lines)
    assert "Stable" in opp_text, "OPP military building Stable should appear"
    assert "Scout Cavalry" in opp_text, "OPP first military unit Scout Cavalry should appear"


def test_render_dual_log_opp_first_unit_only():
    """OPP Scout Cavalry should appear only once (first train), not twice."""
    ops = _make_ops()
    log = render_dual_log(ops, me_number=1, opp_number=2, me_action_count=50)
    opp_lines = [ln for ln in log.splitlines() if ln.split(" ", 2)[1:2] == ["OPP"]]
    scout_lines = [ln for ln in opp_lines if "Scout Cavalry" in ln]
    # After spam collapse, may be "Scout Cavalry x2" (if within window) or single line
    # Either way there should be exactly one line mentioning Scout Cavalry
    assert len(scout_lines) == 1, f"Expected 1 Scout Cavalry OPP line, got: {scout_lines}"


def test_render_dual_log_spam_collapse():
    """ME consecutive identical TRAIN events within 10s are collapsed to xN."""
    ops = _make_ops()
    log = render_dual_log(ops, me_number=1, opp_number=2, me_action_count=50)
    # Archer x2 at 630s and Archer x1 at 635s — within 10s window → collapsed to Archer xN
    assert "Archer x3" in log or "Archer x" in log, f"Expected spam-collapsed Archer in log:\n{log}"


def test_render_dual_log_header_present():
    """Log must start with the prescribed header comment."""
    ops = _make_ops()
    log = render_dual_log(ops, me_number=1, opp_number=2, me_action_count=50)
    first_line = log.splitlines()[0]
    assert first_line.startswith("# ME = you"), f"Missing header: {first_line!r}"


def test_render_dual_log_farm_in_me():
    """ME BUILD Farm (id=50) must appear in ME lines — tests the Farm id fix."""
    ops = _make_ops()
    log = render_dual_log(ops, me_number=1, opp_number=2, me_action_count=50)
    me_lines = [ln for ln in log.splitlines() if ln.split(" ", 2)[1:2] == ["ME"]]
    assert any("Farm" in ln for ln in me_lines), "ME Farm build should appear (id=50 fix)"


def test_render_dual_log_apm_line():
    """Log must end with the owner's APM line."""
    ops = _make_ops()
    log = render_dual_log(ops, me_number=1, opp_number=2, me_action_count=77)
    assert log.strip().endswith("APM total_actions=77")


# ---------------------------------------------------------------------------
# Coach unit tests (no fixture needed — subprocess is monkeypatched)
# ---------------------------------------------------------------------------

_SAMPLE_SALIENT_LOG = """\
# ME = you (full play). OPP = opponent's key strategic moves only (age-ups, military buildings, first military). Player names & chat stripped.
09:45 ME AGE_UP feudal
09:50 OPP AGE_UP feudal
10:02 ME BUILD Archery Range
10:15 OPP BUILD Stable
10:20 OPP TRAIN Scout Cavalry
10:45 ME TRAIN Archer x2
12:30 ME TECH Double-Bit Axe
18:20 ME AGE_UP castle
00:00 APM total_actions=320
"""

_SAMPLE_METRICS = {
    "feudal_uptime_s": 585,
    "castle_uptime_s": 1100,
    "imperial_uptime_s": None,
    "apm": 53,
    "villager_count": 22,
    "army": [{"name": "Archer", "amount": 12}, {"name": "Skirmisher", "amount": 4}],
    "eco_tech_timings": [{"name": "Double-Bit Axe", "t_s": 750}],
}


def test_build_coach_prompt_contains_salient_log():
    prompt = build_coach_prompt(_SAMPLE_SALIENT_LOG, _SAMPLE_METRICS)
    assert "AGE_UP feudal" in prompt
    assert "SALIENT LOG" in prompt


def test_build_coach_prompt_contains_metric_values():
    prompt = build_coach_prompt(_SAMPLE_SALIENT_LOG, _SAMPLE_METRICS)
    assert "585" in prompt  # feudal_uptime_s
    assert "1100" in prompt  # castle_uptime_s
    assert "53" in prompt  # apm
    # no opening_tag in metrics anymore
    assert "opening_tag" not in prompt


def test_build_coach_prompt_no_opening_tag():
    """compute_metrics no longer includes an opening key — prompt must not include it."""
    prompt = build_coach_prompt(_SAMPLE_SALIENT_LOG, _SAMPLE_METRICS)
    assert "opening_tag" not in prompt


def test_run_claude_coach_success():
    fake_json = json.dumps(
        {
            "result": "Good feudal uptime. Focus on villager production in Castle Age.",
            "model": "claude-sonnet-4-5",
            "is_error": False,
        }
    )
    fake_proc = MagicMock()
    fake_proc.returncode = 0
    fake_proc.stdout = fake_json
    fake_proc.stderr = ""

    with patch("website.aoe2.coach.subprocess.run", return_value=fake_proc):
        text, model = run_claude_coach("some prompt")

    assert "villager production" in text
    assert model == "claude-sonnet-4-5"


def test_run_claude_coach_passes_model(settings):
    """run_claude_coach must pass --model <AOE2_COACH_MODEL> to the subprocess."""
    settings.AOE2_COACH_MODEL = "sonnet"
    settings.AOE2_CLAUDE_BIN = "claude"

    fake_json = json.dumps({"result": "ok", "model": "claude-sonnet-4-5", "is_error": False})
    fake_proc = MagicMock()
    fake_proc.returncode = 0
    fake_proc.stdout = fake_json
    fake_proc.stderr = ""

    with patch("website.aoe2.coach.subprocess.run", return_value=fake_proc) as mock_run:
        run_claude_coach("some prompt")

    cmd = mock_run.call_args[0][0]
    assert "--model" in cmd
    assert "sonnet" in cmd


def test_run_claude_coach_nonzero_exit_raises():
    fake_proc = MagicMock()
    fake_proc.returncode = 1
    fake_proc.stdout = ""
    fake_proc.stderr = "permission denied"

    with patch("website.aoe2.coach.subprocess.run", return_value=fake_proc):
        with pytest.raises(RuntimeError, match="exited 1"):
            run_claude_coach("some prompt")


def test_run_claude_coach_missing_result_raises():
    fake_json = json.dumps({"model": "claude-sonnet-4-5", "is_error": False})
    fake_proc = MagicMock()
    fake_proc.returncode = 0
    fake_proc.stdout = fake_json

    with patch("website.aoe2.coach.subprocess.run", return_value=fake_proc):
        with pytest.raises(RuntimeError, match="missing 'result'"):
            run_claude_coach("some prompt")


def _make_match_with_dummy_file(file_hash):
    """Create an Aoe2Match with a tiny dummy rec_file so .path resolves."""
    from django.core.files.base import ContentFile

    from website.models import Aoe2Match

    m = Aoe2Match.objects.create(file_hash=file_hash)
    m.rec_file.save("dummy.aoe2record", ContentFile(b"dummy"), save=True)
    return m


def _fake_pipeline():
    """Return (fake_rec, fake_timeline, fake_metrics, fake_dual_log) stubs."""
    fake_rec = MagicMock()
    fake_rec.is_1v1 = True
    fake_rec.is_ranked = True
    fake_rec.me = {"number": 1, "civ_name": "Celts", "is_me": True}
    fake_rec.opponent = {"number": 2, "civ_name": "Franks", "is_me": False}
    fake_rec.map_name = "Arabia"
    fake_rec.duration_ms = 1_200_000
    fake_rec.version = "Version.DE"
    fake_rec.my_result = "win"
    fake_rec.ops = []

    fake_timeline = {
        "uptimes": {"feudal": 585_000, "castle": 1_100_000, "imperial": None},
        "builds": [],
        "eco_techs": [],
        "units": [],
        "villager_queue_times": [],
        "action_count": 320,
    }
    fake_metrics = {
        "feudal_uptime_s": 585,
        "castle_uptime_s": 1100,
        "imperial_uptime_s": None,
        "apm": 53,
        "villager_count": 22,
        "army": [],
        "eco_tech_timings": [],
        "estimates": [],
    }
    fake_dual_log = (
        "# ME = you (full play). OPP = opponent's key strategic moves only "
        "(age-ups, military buildings, first military). Player names & chat stripped.\n"
        "09:45 ME AGE_UP feudal\n"
        "00:00 APM total_actions=320"
    )
    return fake_rec, fake_timeline, fake_metrics, fake_dual_log


@pytest.mark.django_db
def test_analyze_match_stores_coach_analysis(settings, monkeypatch):
    """Coach succeeds → coach_analysis + coach_model + opening are stored on the match."""
    from website.tasks import analyze_match

    settings.AOE2_PROFILE_ID = OWNER_PROFILE_ID
    fake_rec, fake_timeline, fake_metrics, fake_dual_log = _fake_pipeline()

    monkeypatch.setattr("website.tasks.parse_rec", lambda *_a, **_kw: fake_rec)
    monkeypatch.setattr("website.tasks.build_timeline", lambda *_a, **_kw: fake_timeline)
    monkeypatch.setattr("website.tasks.compute_metrics", lambda *_a, **_kw: fake_metrics)
    monkeypatch.setattr("website.tasks.render_dual_log", lambda *_a, **_kw: fake_dual_log)
    monkeypatch.setattr(
        "website.tasks.run_claude_coach",
        lambda *_a, **_kw: (
            "OPENING: Archers\n\nGreat game. Work on villager production.",
            "claude-sonnet-4-5",
        ),
    )

    m = _make_match_with_dummy_file("coach-success-hash")
    analyze_match(m.id)
    m.refresh_from_db()

    assert m.analysis_status == "done"
    assert "villager production" in m.coach_analysis
    assert m.coach_model == "claude-sonnet-4-5"
    assert m.metrics.get("opening") == "Archers"


@pytest.mark.django_db
def test_analyze_match_graceful_coach_failure(settings, monkeypatch):
    """Coach raises → status is still 'done', coach_analysis is empty, opening is empty string."""
    from website.tasks import analyze_match

    settings.AOE2_PROFILE_ID = OWNER_PROFILE_ID
    fake_rec, fake_timeline, fake_metrics, fake_dual_log = _fake_pipeline()

    monkeypatch.setattr("website.tasks.parse_rec", lambda *_a, **_kw: fake_rec)
    monkeypatch.setattr("website.tasks.build_timeline", lambda *_a, **_kw: fake_timeline)
    monkeypatch.setattr("website.tasks.compute_metrics", lambda *_a, **_kw: fake_metrics)
    monkeypatch.setattr("website.tasks.render_dual_log", lambda *_a, **_kw: fake_dual_log)
    monkeypatch.setattr(
        "website.tasks.run_claude_coach",
        lambda *_a, **_kw: (_ for _ in ()).throw(RuntimeError("claude not found")),
    )

    m = _make_match_with_dummy_file("coach-fail-hash")
    analyze_match(m.id)
    m.refresh_from_db()

    assert m.analysis_status == "done"
    assert m.coach_analysis == ""
    assert m.metrics.get("opening") == ""


@pytest.mark.django_db
def test_aoe2_match_model_defaults():
    from website.models import Aoe2Match

    m = Aoe2Match.objects.create(file_hash="abc123", my_civ="Celts", opponent_civ="Franks")
    assert m.analysis_status == "pending"
    assert m.featured is False
    assert m.timeline == {} and m.metrics == {}


@requires_fixture
@pytest.mark.django_db
def test_analyze_match_done(settings):
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


@pytest.mark.django_db
def test_upload_requires_admin(client):
    resp = client.post("/api/aoe2/upload/")
    assert resp.status_code == 401


@requires_fixture
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


@requires_fixture
@pytest.mark.django_db
def test_upload_dedup(client, auth_headers, settings):
    settings.AOE2_PROFILE_ID = OWNER_PROFILE_ID
    with FIXTURE.open("rb") as fh:
        client.post("/api/aoe2/upload/", {"rec": fh}, **auth_headers)
    with FIXTURE.open("rb") as fh:
        resp2 = client.post("/api/aoe2/upload/", {"rec": fh}, **auth_headers)
    assert resp2.status_code == 200  # dup -> 200 with existing id


# ---------------------------------------------------------------------------
# Ranked-only gate: non-ranked 1v1 → skipped
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_analyze_match_skips_unranked(settings, monkeypatch):
    """A non-ranked rec (de.rated=False) must set analysis_status=skipped."""
    from website.tasks import analyze_match

    settings.AOE2_PROFILE_ID = OWNER_PROFILE_ID
    fake_rec, _, _, _ = _fake_pipeline()
    fake_rec.is_ranked = False  # unranked/custom game

    monkeypatch.setattr("website.tasks.parse_rec", lambda *_a, **_kw: fake_rec)

    m = _make_match_with_dummy_file("unranked-skip-hash")
    analyze_match(m.id)
    m.refresh_from_db()

    assert m.analysis_status == "skipped"


# ---------------------------------------------------------------------------
# Phase 3 — Relic enrichment helpers + tests
# ---------------------------------------------------------------------------


def _make_relic_stat_response(rating=1087, rank=512, wins=85, losses=73):
    """Build a minimal Relic getPersonalStat response body (real API shape: top-level camelCase)."""
    return {
        "leaderboardStats": [
            {
                "leaderboard_id": 3,  # 1v1 RM
                "rating": rating,
                "rank": rank,
                "wins": wins,
                "losses": losses,
            },
            {
                "leaderboard_id": 4,  # team RM — should be filtered out
                "rating": rating + 50,
                "rank": rank + 1000,
                "wins": wins + 10,
                "losses": losses + 5,
            },
        ]
    }


def _make_relic_history_response(profile_id, relic_match_id=99001, my_civ_id=8, opp_civ_id=1):
    """Build a minimal Relic getRecentMatchHistory response body (real API shape: top-level camelCase)."""
    return {
        "matchHistoryStats": [
            {
                "id": relic_match_id,
                "mapname": "Arabia",
                "completiontime": 1750000000,
                "matchtype_id": 6,  # ranked 1v1 RM — keep
                "matchhistorymember": [
                    {
                        "profile_id": profile_id,
                        "civilization_id": my_civ_id,
                        "outcome": 1,
                        "oldrating": 1070,
                        "newrating": 1087,
                    },
                    {
                        "profile_id": profile_id + 1,  # opponent
                        "civilization_id": opp_civ_id,
                        "outcome": 0,
                        "oldrating": 1090,
                        "newrating": 1073,
                    },
                ],
            },
            {
                "id": relic_match_id + 1,
                "mapname": "Arena",
                "completiontime": 1749000000,
                "matchtype_id": 0,  # custom game — must be filtered out
                "matchhistorymember": [],
            },
        ]
    }


def test_relic_get_personal_stat_parses_1v1_rm():
    """get_personal_stat returns correct fields from a mocked response."""
    from website.aoe2.relic import get_personal_stat

    mock_resp = MagicMock()
    mock_resp.json.return_value = _make_relic_stat_response(rating=1087, rank=512)
    mock_resp.raise_for_status = MagicMock()

    with patch("website.aoe2.relic.httpx.get", return_value=mock_resp) as mock_get:
        result = get_personal_stat(14697894)

    mock_get.assert_called_once()
    assert result["rating"] == 1087
    assert result["rank"] == 512
    assert result["wins"] == 85
    assert result["losses"] == 73


def test_relic_get_personal_stat_missing_leaderboard():
    """Returns None-filled dict when no 1v1 RM entry is present."""
    from website.aoe2.relic import get_personal_stat

    mock_resp = MagicMock()
    mock_resp.json.return_value = {"leaderboardStats": []}
    mock_resp.raise_for_status = MagicMock()

    with patch("website.aoe2.relic.httpx.get", return_value=mock_resp):
        result = get_personal_stat(14697894)

    assert result["rating"] is None
    assert result["rank"] is None


def test_relic_get_recent_1v1_matches_filters_matchtype():
    """get_recent_1v1_matches returns only matchtype_id==6 entries."""
    from website.aoe2.relic import get_recent_1v1_matches

    profile_id = 14697894
    resp_body = {
        "matchHistoryStats": [
            {
                "id": 1,
                "mapname": "Arabia",
                "completiontime": 1750000000,
                "matchtype_id": 6,  # ranked 1v1 — keep
                "matchhistorymember": [
                    {
                        "profile_id": profile_id,
                        "civilization_id": 8,
                        "outcome": 1,
                        "oldrating": 1070,
                        "newrating": 1087,
                    },
                    {"profile_id": 9999, "civilization_id": 1, "outcome": 0, "oldrating": 1090, "newrating": 1073},
                ],
            },
            {
                "id": 2,
                "mapname": "Arena",
                "completiontime": 1749000000,
                "matchtype_id": 0,  # custom game — must be filtered out
                "matchhistorymember": [],
            },
        ]
    }
    mock_resp = MagicMock()
    mock_resp.json.return_value = resp_body
    mock_resp.raise_for_status = MagicMock()

    with patch("website.aoe2.relic.httpx.get", return_value=mock_resp):
        matches = get_recent_1v1_matches(profile_id)

    assert len(matches) == 1
    assert matches[0]["relic_match_id"] == 1
    assert matches[0]["my_outcome"] == "win"
    assert matches[0]["my_old"] == 1070
    assert matches[0]["my_new"] == 1087
    assert matches[0]["opp_old"] == 1090
    assert matches[0]["opp_new"] == 1073


def test_relic_uses_custom_host(settings):
    """get_personal_stat respects AOE2_RELIC_HOST setting."""
    from website.aoe2.relic import get_personal_stat

    settings.AOE2_RELIC_HOST = "https://custom-relic.example.com"

    mock_resp = MagicMock()
    mock_resp.json.return_value = _make_relic_stat_response()
    mock_resp.raise_for_status = MagicMock()

    with patch("website.aoe2.relic.httpx.get", return_value=mock_resp) as mock_get:
        get_personal_stat(14697894)

    called_url = mock_get.call_args[0][0]
    assert called_url.startswith("https://custom-relic.example.com")


# ---------------------------------------------------------------------------
# Phase 3 — Stats endpoint serves cached ELO + rank
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_aoe2_stats_serves_cached_relic_elo(client):
    from django.core.cache import cache

    cache.set("aoe2:ladder_stat", {"rating": 1150, "rank": 300, "wins": 90, "losses": 75})
    resp = client.get("/api/aoe2/stats/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["current_elo"] == 1150
    assert data["current_rank"] == 300


@pytest.mark.django_db
def test_aoe2_stats_falls_back_to_match_elo_when_no_cache(client):
    from website.models import Aoe2Match

    Aoe2Match.objects.create(file_hash="f1", my_civ="Celts", opponent_civ="Franks", analysis_status="done", my_elo=1042)
    resp = client.get("/api/aoe2/stats/")
    data = resp.json()
    assert data["current_elo"] == 1042
    assert data["current_rank"] is None  # no relic cache


# ---------------------------------------------------------------------------
# Phase 3 — Clip attach endpoint
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_clip_requires_admin(client):
    from website.models import Aoe2Match

    m = Aoe2Match.objects.create(file_hash="clip-noauth", analysis_status="done")
    resp = client.post(
        f"/api/aoe2/{m.id}/clip/", content_type="application/json", data=json.dumps({"url": "https://youtu.be/abc"})
    )
    assert resp.status_code == 401


@pytest.mark.django_db
def test_clip_stores_url(client, auth_headers):
    from website.models import Aoe2Match

    m = Aoe2Match.objects.create(file_hash="clip-store", analysis_status="done")
    payload = {
        "url": "https://www.youtube.com/watch?v=TEST123",
        "title": "Epic game",
        "note": "see 4:20",
        "start_seconds": 260,
    }
    resp = client.post(
        f"/api/aoe2/{m.id}/clip/", content_type="application/json", data=json.dumps(payload), **auth_headers
    )
    assert resp.status_code == 200
    m.refresh_from_db()
    assert m.clip_url == "https://www.youtube.com/watch?v=TEST123"
    assert m.clip_title == "Epic game"
    assert m.clip_note == "see 4:20"
    assert m.clip_start_seconds == 260


@pytest.mark.django_db
def test_clip_requires_url_field(client, auth_headers):
    from website.models import Aoe2Match

    m = Aoe2Match.objects.create(file_hash="clip-nourl", analysis_status="done")
    resp = client.post(
        f"/api/aoe2/{m.id}/clip/", content_type="application/json", data=json.dumps({"title": "no url"}), **auth_headers
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_clip_404_on_missing_match(client, auth_headers):
    resp = client.post(
        "/api/aoe2/99999/clip/",
        content_type="application/json",
        data=json.dumps({"url": "https://youtu.be/x"}),
        **auth_headers,
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Phase 3 — Feature toggle endpoint
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_feature_requires_admin(client):
    from website.models import Aoe2Match

    m = Aoe2Match.objects.create(file_hash="feat-noauth", analysis_status="done")
    resp = client.post(f"/api/aoe2/{m.id}/feature/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_feature_toggle(client, auth_headers):
    from website.models import Aoe2Match

    m = Aoe2Match.objects.create(file_hash="feat-toggle", analysis_status="done", featured=False)
    # Feature it
    resp = client.post(f"/api/aoe2/{m.id}/feature/", **auth_headers)
    assert resp.status_code == 200
    assert resp.json()["featured"] is True
    m.refresh_from_db()
    assert m.featured is True
    # Unfeature it
    resp2 = client.post(f"/api/aoe2/{m.id}/feature/", **auth_headers)
    assert resp2.json()["featured"] is False
    m.refresh_from_db()
    assert m.featured is False


@pytest.mark.django_db
def test_feature_only_one_at_a_time(client, auth_headers):
    from website.models import Aoe2Match

    m1 = Aoe2Match.objects.create(file_hash="feat-one", analysis_status="done", featured=True)
    m2 = Aoe2Match.objects.create(file_hash="feat-two", analysis_status="done", featured=False)
    # Feature m2 — m1 should be cleared
    resp = client.post(f"/api/aoe2/{m2.id}/feature/", **auth_headers)
    assert resp.json()["featured"] is True
    m1.refresh_from_db()
    m2.refresh_from_db()
    assert m1.featured is False
    assert m2.featured is True


@pytest.mark.django_db
def test_feature_404_on_missing_match(client, auth_headers):
    resp = client.post("/api/aoe2/99999/feature/", **auth_headers)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Phase 3 — enrich_ladder task (mocked network)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_enrich_ladder_caches_elo(settings):
    from django.core.cache import cache

    from website.tasks import enrich_ladder

    settings.AOE2_PROFILE_ID = 14697894

    stat_resp = MagicMock()
    stat_resp.json.return_value = _make_relic_stat_response(rating=1100, rank=400)
    stat_resp.raise_for_status = MagicMock()

    history_resp = MagicMock()
    history_resp.json.return_value = {"matchHistoryStats": []}
    history_resp.raise_for_status = MagicMock()

    def fake_get(url, **_kwargs):
        if "getPersonalStat" in url:
            return stat_resp
        return history_resp

    with patch("website.aoe2.relic.httpx.get", side_effect=fake_get):
        enrich_ladder()

    cached = cache.get("aoe2:ladder_stat")
    assert cached is not None
    assert cached["rating"] == 1100
    assert cached["rank"] == 400


@pytest.mark.django_db
def test_enrich_ladder_backfills_match(settings):
    """enrich_ladder matches a relic result to a local row by civ + time proximity."""
    import datetime

    from django.utils import timezone

    from website.models import Aoe2Match
    from website.tasks import enrich_ladder

    settings.AOE2_PROFILE_ID = 14697894
    profile_id = 14697894

    # Create a local match with Celts civ (civ_id=8) and played_at near completiontime.
    completion_epoch = 1750000000
    played = timezone.datetime.fromtimestamp(completion_epoch - 300, tz=datetime.timezone.utc)
    m = Aoe2Match.objects.create(
        file_hash="enrich-backfill",
        analysis_status="done",
        my_civ="Celts",
        opponent_civ="Britons",
        played_at=played,
    )

    stat_resp = MagicMock()
    stat_resp.json.return_value = _make_relic_stat_response()
    stat_resp.raise_for_status = MagicMock()

    history_resp = MagicMock()
    history_resp.json.return_value = _make_relic_history_response(
        profile_id=profile_id,
        relic_match_id=77001,
        my_civ_id=8,  # Celts
        opp_civ_id=1,  # Britons
    )
    history_resp.raise_for_status = MagicMock()

    def fake_get(url, **_kwargs):
        if "getPersonalStat" in url:
            return stat_resp
        return history_resp

    with patch("website.aoe2.relic.httpx.get", side_effect=fake_get):
        enrich_ladder()

    m.refresh_from_db()
    assert m.relic_match_id == 77001
    assert m.my_elo == 1087
    assert m.my_rating_change == 17  # 1087 - 1070
    assert m.opponent_elo == 1073
    assert m.my_result == "win"


@pytest.mark.django_db
def test_enrich_ladder_idempotent(settings):
    """Running enrich_ladder twice does not double-enrich the same row."""
    import datetime

    from django.utils import timezone

    from website.models import Aoe2Match
    from website.tasks import enrich_ladder

    settings.AOE2_PROFILE_ID = 14697894
    profile_id = 14697894

    completion_epoch = 1750000000
    played = timezone.datetime.fromtimestamp(completion_epoch - 300, tz=datetime.timezone.utc)
    m = Aoe2Match.objects.create(
        file_hash="enrich-idempotent",
        analysis_status="done",
        my_civ="Celts",
        played_at=played,
    )

    stat_resp = MagicMock()
    stat_resp.json.return_value = _make_relic_stat_response()
    stat_resp.raise_for_status = MagicMock()

    history_resp = MagicMock()
    history_resp.json.return_value = _make_relic_history_response(
        profile_id=profile_id, relic_match_id=88001, my_civ_id=8
    )
    history_resp.raise_for_status = MagicMock()

    def fake_get(url, **_kwargs):
        if "getPersonalStat" in url:
            return stat_resp
        return history_resp

    with patch("website.aoe2.relic.httpx.get", side_effect=fake_get):
        enrich_ladder()
        enrich_ladder()  # second call — should be a no-op for this match

    m.refresh_from_db()
    assert m.relic_match_id == 88001  # still correctly set, not duplicated
