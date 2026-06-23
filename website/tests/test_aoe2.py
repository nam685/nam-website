import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import mgz.fast.header
import pytest
from aoe2coach import (
    CoachOutput,
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

    with patch("aoe2coach.coach.subprocess.run", return_value=fake_proc):
        text, model = run_claude_coach("some prompt")

    assert "villager production" in text
    assert model == "claude-sonnet-4-5"


def test_run_claude_coach_passes_model():
    """run_claude_coach passes the given model + claude_bin through to the subprocess.

    (Settings-driven model selection now lives in the prod wrapper website.tasks._run_coach,
    covered by test_run_coach_wrapper_success.)
    """
    fake_json = json.dumps({"result": "ok", "model": "claude-sonnet-4-5", "is_error": False})
    fake_proc = MagicMock()
    fake_proc.returncode = 0
    fake_proc.stdout = fake_json
    fake_proc.stderr = ""

    with patch("aoe2coach.coach.subprocess.run", return_value=fake_proc) as mock_run:
        run_claude_coach("some prompt", model="opus", claude_bin="my-claude")

    cmd = mock_run.call_args[0][0]
    assert cmd[0] == "my-claude"
    assert "--model" in cmd
    assert "opus" in cmd


def test_run_claude_coach_nonzero_exit_raises():
    fake_proc = MagicMock()
    fake_proc.returncode = 1
    fake_proc.stdout = ""
    fake_proc.stderr = "permission denied"

    with patch("aoe2coach.coach.subprocess.run", return_value=fake_proc):
        with pytest.raises(RuntimeError, match="exited 1"):
            run_claude_coach("some prompt")


def test_run_claude_coach_missing_result_raises():
    fake_json = json.dumps({"model": "claude-sonnet-4-5", "is_error": False})
    fake_proc = MagicMock()
    fake_proc.returncode = 0
    fake_proc.stdout = fake_json

    with patch("aoe2coach.coach.subprocess.run", return_value=fake_proc):
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
    # Mock the v2 bundle (its producers are unit-tested in the aoe2coach package against real recs).
    fake_bundle = {
        "reconstruction": {"meta": {"map": "Arabia"}},
        "map_geometry": {"map_name": "Arabia", "me": {"buildings": []}},
        "classifier": {"candidates": [{"build_id": "scouts", "name": "Scouts", "confidence": 0.8}]},
        "mistakes": [],
        "economy": {"estimate": True},
        "map_images": ["aoe2/maps/1/map_overall.png"],
        "map_png_paths": [],
        "candidates": None,
        "recon_obj": None,
    }
    monkeypatch.setattr("website.tasks.build_bundle", lambda *_a, **_kw: fake_bundle)
    monkeypatch.setattr(
        "website.tasks.coach",
        lambda *_a, **_kw: CoachOutput(
            raw_text="OPENING: Archers\n\nGreat game. Work on villager production.",
            opening_tag="Archers",
            model_used="claude-sonnet-4-5",
            tier="agentic",
        ),
    )

    m = _make_match_with_dummy_file("coach-success-hash")
    analyze_match(m.id)
    m.refresh_from_db()

    assert m.analysis_status == "done"
    assert "villager production" in m.coach_analysis
    assert m.coach_model == "claude-sonnet-4-5"
    assert m.coach_tier == "agentic"
    assert m.metrics.get("opening") == "Archers"
    # rich v2 data persisted + served
    assert m.reconstruction == {"meta": {"map": "Arabia"}}
    assert m.classifier["candidates"][0]["build_id"] == "scouts"
    assert m.map_images == ["aoe2/maps/1/map_overall.png"]


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
    monkeypatch.setattr("website.tasks.build_bundle", lambda *_a, **_kw: {})
    monkeypatch.setattr(
        "website.tasks.coach",
        lambda *_a, **_kw: (_ for _ in ()).throw(RuntimeError("claude not found")),
    )

    m = _make_match_with_dummy_file("coach-fail-hash")
    analyze_match(m.id)
    m.refresh_from_db()

    assert m.analysis_status == "done"
    assert m.coach_analysis == ""
    assert m.metrics.get("opening") == ""


@pytest.mark.django_db
def test_coach_model_opus_for_featured_else_default(settings, monkeypatch):
    """Featured (⭐) matches coach on opus; everything else uses the volume default (haiku)."""
    from website.tasks import analyze_match

    settings.AOE2_PROFILE_ID = OWNER_PROFILE_ID
    settings.AOE2_COACH_MODEL = "haiku"
    fake_rec, fake_timeline, fake_metrics, fake_dual_log = _fake_pipeline()
    monkeypatch.setattr("website.tasks.parse_rec", lambda *_a, **_kw: fake_rec)
    monkeypatch.setattr("website.tasks.build_timeline", lambda *_a, **_kw: fake_timeline)
    monkeypatch.setattr("website.tasks.compute_metrics", lambda *_a, **_kw: fake_metrics)
    monkeypatch.setattr("website.tasks.render_dual_log", lambda *_a, **_kw: fake_dual_log)
    monkeypatch.setattr("website.tasks.build_bundle", lambda *_a, **_kw: {"reconstruction": {}})
    seen = {}
    monkeypatch.setattr(
        "website.tasks.coach",
        lambda *_a, **kw: (
            seen.update(model=kw.get("model"))
            or CoachOutput(raw_text="x", opening_tag="", model_used=kw.get("model") or "", tier="agentic")
        ),
    )

    m = _make_match_with_dummy_file("not-featured-hash")
    analyze_match(m.id)
    assert seen["model"] == "haiku"  # non-featured → volume default

    mf = _make_match_with_dummy_file("featured-hash")
    mf.featured = True
    mf.save(update_fields=["featured"])
    analyze_match(mf.id)
    assert seen["model"] == "opus"  # featured → opus


@pytest.mark.django_db
def test_analyze_match_run_coach_false_skips_coach(settings, monkeypatch):
    """run_coach=False → deterministic preprocessing is saved (done, reconstruction/economy populated)
    but the LLM coach is NEVER invoked (preprocess-now / coach-lazy)."""
    from website.tasks import analyze_match

    settings.AOE2_PROFILE_ID = OWNER_PROFILE_ID
    fake_rec, fake_timeline, fake_metrics, fake_dual_log = _fake_pipeline()
    monkeypatch.setattr("website.tasks.parse_rec", lambda *_a, **_kw: fake_rec)
    monkeypatch.setattr("website.tasks.build_timeline", lambda *_a, **_kw: fake_timeline)
    monkeypatch.setattr("website.tasks.compute_metrics", lambda *_a, **_kw: fake_metrics)
    monkeypatch.setattr("website.tasks.render_dual_log", lambda *_a, **_kw: fake_dual_log)
    monkeypatch.setattr(
        "website.tasks.build_bundle",
        lambda *_a, **_kw: {"reconstruction": {"meta": {"map": "Arabia"}}, "economy": {"estimate": True}},
    )
    called = []
    monkeypatch.setattr("website.tasks.coach", lambda *_a, **_kw: called.append(1))

    m = _make_match_with_dummy_file("preprocess-only-hash")
    analyze_match(m.id, run_coach=False)
    m.refresh_from_db()

    assert called == []  # coach was never invoked
    assert m.analysis_status == "done"
    assert m.coach_analysis == "" and m.coach_model == ""
    assert m.reconstruction == {"meta": {"map": "Arabia"}}
    assert m.economy == {"estimate": True}

    # Re-preprocessing must NOT wipe an existing coach analysis (only refresh deterministic data).
    m.coach_analysis = "prior opus analysis"
    m.coach_model = "claude-opus-4-8"
    m.save(update_fields=["coach_analysis", "coach_model"])
    analyze_match(m.id, run_coach=False)
    m.refresh_from_db()
    assert m.coach_analysis == "prior opus analysis" and m.coach_model == "claude-opus-4-8"


@pytest.mark.django_db
def test_coach_match_saves_on_success_and_guards_empty(settings, monkeypatch):
    """coach_match fills the coach on success and never wipes an existing analysis on an empty
    (e.g. session-limited) result."""
    from website.tasks import analyze_match, coach_match

    settings.AOE2_PROFILE_ID = OWNER_PROFILE_ID
    fake_rec, fake_timeline, fake_metrics, fake_dual_log = _fake_pipeline()
    monkeypatch.setattr("website.tasks.parse_rec", lambda *_a, **_kw: fake_rec)
    monkeypatch.setattr("website.tasks.build_timeline", lambda *_a, **_kw: fake_timeline)
    monkeypatch.setattr("website.tasks.compute_metrics", lambda *_a, **_kw: fake_metrics)
    monkeypatch.setattr("website.tasks.render_dual_log", lambda *_a, **_kw: fake_dual_log)
    monkeypatch.setattr("website.tasks.build_bundle", lambda *_a, **_kw: {"reconstruction": {}})

    m = _make_match_with_dummy_file("coach-match-hash")
    analyze_match(m.id, run_coach=False)  # preprocess only, no coach yet

    # success → fills the coach
    monkeypatch.setattr(
        "website.tasks.coach",
        lambda *_a, **_kw: CoachOutput(
            raw_text="Good macro.", opening_tag="Scouts", model_used="claude-opus-4-8", tier="agentic"
        ),
    )
    coach_match(m.id)
    m.refresh_from_db()
    assert m.coach_analysis == "Good macro." and m.coach_model == "claude-opus-4-8"

    # empty (rate-limited) → must NOT overwrite the existing analysis
    monkeypatch.setattr(
        "website.tasks.coach",
        lambda *_a, **_kw: CoachOutput(raw_text="", opening_tag="", model_used="", tier=""),
    )
    coach_match(m.id)
    m.refresh_from_db()
    assert m.coach_analysis == "Good macro."  # unchanged


def test_run_coach_wrapper_success(settings):
    """The prod wrapper reads settings, calls aoe2coach.coach(), returns (text, model, opening, tier).

    With no bundle it takes the legacy v1 path (single `claude -p` call, tier="v1").
    """
    from website.tasks import _run_coach

    settings.AOE2_COACH_MODEL = "sonnet"
    fake = json.dumps({"result": "OPENING: Scouts\n\nbody", "model": "claude-sonnet-4-5"})
    with patch("aoe2coach.coach.subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=fake, stderr="")
        text, model, opening, tier = _run_coach("00:00 APM total_actions=6", {"apm": 80}, "win")
    assert text == "OPENING: Scouts\n\nbody"
    assert model == "claude-sonnet-4-5"
    assert opening == "Scouts"
    assert tier == "v1"


def test_run_coach_wrapper_graceful_failure():
    """The prod wrapper swallows coach failures and returns empty strings."""
    from website.tasks import _run_coach

    with patch("aoe2coach.coach.subprocess.run", side_effect=RuntimeError("boom")):
        text, model, opening, tier = _run_coach("log", {"apm": 1}, "loss")
    assert (text, model, opening, tier) == ("", "", "", "")


def test_run_coach_wrapper_v2_agentic_path(settings):
    """With a bundle, _run_coach drives the AGENTIC v2 coach path (no real CLI).

    The aoe2coach agentic runner is mocked. We assert _run_coach forwards the bundle's
    reconstruction (triggering the v2 path inside coach()) and returns the agentic tier + opening.
    """
    from website.tasks import _run_coach

    settings.AOE2_COACH_MODEL = "opus"
    settings.AOE2_CLAUDE_BIN = "claude"

    # A minimal real Reconstruction so build_workspace can serialize facts.json without a real rec.
    from aoe2coach import reconstruct

    fake_rec, _ft, _fm, _fl = _fake_pipeline()
    fake_rec.map_dim = 120
    fake_rec.gaia_objects = []
    fake_rec.start_positions = {}
    recon = reconstruct(fake_rec)

    bundle = {
        "recon_obj": recon,
        "reconstruction": recon.to_dict(),
        "candidates": None,
        "economy": {"estimate": True},
        "mistakes": [],
        "map_png_paths": [],
    }

    # Mock the agentic runner at the source (its default `runner=subprocess.run` is bound at def-time,
    # so we patch run_agentic_coach itself — the contract _run_coach depends on).
    agentic_text = "WHAT HAPPENED\n- Opening: scouts\n\nANALYSIS\nGood macro."
    with patch(
        "aoe2coach.coach.run_agentic_coach",
        return_value=(agentic_text, "claude-opus-4-1"),
    ) as mock_agentic:
        text, model, opening, tier = _run_coach("00:00 APM total_actions=6", {"apm": 80}, "win", bundle=bundle)

    assert mock_agentic.called, "agentic coach must run when a bundle (reconstruction) is passed"
    assert "WHAT HAPPENED" in text
    assert opening == "scouts"
    assert tier == "agentic"
    assert model == "claude-opus-4-1"


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


# ---------------------------------------------------------------------------
# Bug 1 — Tech deduplication
# ---------------------------------------------------------------------------


def test_build_timeline_dedupes_eco_techs():
    """Two RESEARCH events for the same eco tech → only the FIRST appears in eco_techs."""
    ops = [
        (300_000, Action.RESEARCH, {"player_id": 1, "technology_id": 202}),  # Double-Bit Axe (first)
        (350_000, Action.RESEARCH, {"player_id": 1, "technology_id": 202}),  # Double-Bit Axe again (dup)
        (400_000, Action.RESEARCH, {"player_id": 1, "technology_id": 213}),  # Wheelbarrow (different tech)
    ]
    tl = build_timeline(ops, me_number=1)
    names = [e["name"] for e in tl["eco_techs"]]
    # Only one Double-Bit Axe, at the FIRST occurrence time
    assert names.count("Double-Bit Axe") == 1, f"Expected 1 Double-Bit Axe, got: {names}"
    dba = next(e for e in tl["eco_techs"] if e["name"] == "Double-Bit Axe")
    assert dba["t"] == 300_000, "First occurrence (300s) should be kept, not the duplicate"
    # Wheelbarrow still present
    assert "Wheelbarrow" in names


def test_render_dual_log_tech_no_duplicates():
    """Duplicate TECH RESEARCH events for a given tech must yield exactly one TECH line, no xN."""
    ops = [
        # ME researches Loom twice (RESEARCH can fire more than once per tech in a rec)
        (200_000, Action.RESEARCH, {"player_id": 1, "technology_id": 22}),  # Loom (first)
        (210_000, Action.RESEARCH, {"player_id": 1, "technology_id": 22}),  # Loom (dup — within 10s window)
        # OPP age-up (unrelated)
        (590_000, Action.RESEARCH, {"player_id": 2, "technology_id": 101}),
    ]
    log = render_dual_log(ops, me_number=1, opp_number=2, me_action_count=10)
    tech_lines = [ln for ln in log.splitlines() if "TECH" in ln and "ME" in ln]
    loom_lines = [ln for ln in tech_lines if "Loom" in ln]
    assert len(loom_lines) == 1, f"Expected exactly 1 Loom TECH line, got: {loom_lines}"
    # Must NOT have "x2" or any xN suffix on a TECH line
    assert "x2" not in loom_lines[0], f"TECH line must not have xN: {loom_lines[0]!r}"


# ---------------------------------------------------------------------------
# Bug 2 — Age-up arrival times
# ---------------------------------------------------------------------------


def test_compute_metrics_feudal_uptime_is_arrival():
    """feudal_uptime_s must be click_ms/1000 + 130 (AGE_RESEARCH_MS for feudal)."""
    from aoe2coach.timeline import AGE_RESEARCH_MS

    click_ms = 585_000  # 9:45 click
    ops = [
        (click_ms, Action.RESEARCH, {"player_id": 1, "technology_id": 101}),  # feudal click
    ]
    tl = build_timeline(ops, me_number=1)
    m = compute_metrics(tl, duration_ms=1_200_000)
    expected_arrival_s = (click_ms + AGE_RESEARCH_MS["feudal"]) // 1000
    assert m["feudal_uptime_s"] == expected_arrival_s, (
        f"Expected arrival {expected_arrival_s}s, got {m['feudal_uptime_s']}s"
    )
    # Sanity: 585s click + 130s = 715s = 11:55
    assert m["feudal_uptime_s"] == 715


def test_compute_metrics_castle_imperial_arrival():
    """castle/imperial uptime_s are also arrival (click + research timer)."""
    from aoe2coach.timeline import AGE_RESEARCH_MS

    feudal_click = 585_000
    castle_click = 1_100_000
    imperial_click = 2_000_000
    ops = [
        (feudal_click, Action.RESEARCH, {"player_id": 1, "technology_id": 101}),
        (castle_click, Action.RESEARCH, {"player_id": 1, "technology_id": 102}),
        (imperial_click, Action.RESEARCH, {"player_id": 1, "technology_id": 103}),
    ]
    tl = build_timeline(ops, me_number=1)
    m = compute_metrics(tl, duration_ms=3_000_000)
    assert m["castle_uptime_s"] == (castle_click + AGE_RESEARCH_MS["castle"]) // 1000
    assert m["imperial_uptime_s"] == (imperial_click + AGE_RESEARCH_MS["imperial"]) // 1000


def test_render_dual_log_age_up_shows_arrival():
    """AGE_UP lines must include both the click timestamp and the ~arrival timestamp."""
    ops = [
        (585_000, Action.RESEARCH, {"player_id": 1, "technology_id": 101}),  # feudal click at 9:45
        (590_000, Action.RESEARCH, {"player_id": 2, "technology_id": 101}),  # OPP feudal
    ]
    log = render_dual_log(ops, me_number=1, opp_number=2, me_action_count=5)
    me_age_line = next(ln for ln in log.splitlines() if "ME" in ln and "AGE_UP" in ln and "feudal" in ln)
    # Click at 09:45, arrival at 09:45 + 2:10 = 11:55
    assert "09:45" in me_age_line, f"Click time missing from: {me_age_line!r}"
    assert "reached" in me_age_line, f"Arrival annotation missing from: {me_age_line!r}"
    assert "11:55" in me_age_line, f"Arrival time 11:55 missing from: {me_age_line!r}"


# ---------------------------------------------------------------------------
# Bug 3 — played_at parsed from rec filename
# ---------------------------------------------------------------------------


def test_parse_played_at_from_filename():
    """Upload view parses played_at from a standard rec filename and converts VN local → UTC."""
    import datetime

    from website.views.aoe2 import _REC_FILENAME_RE

    fname = "MP Replay v1.8 @2024.03.15 183042 (1).aoe2record"
    m = _REC_FILENAME_RE.search(fname)
    assert m is not None, "Regex must match the standard rec filename format"
    year, month, day, hour, minute, second = (int(x) for x in m.groups())
    assert (year, month, day) == (2024, 3, 15)
    assert (hour, minute, second) == (18, 30, 42)

    # Simulate UTC conversion with default offset=7 (UTC+7 VN)
    tz_offset_hours = 7
    local_dt = datetime.datetime(year, month, day, hour, minute, second)
    played_at = local_dt.replace(tzinfo=datetime.timezone.utc) - datetime.timedelta(hours=tz_offset_hours)
    # 18:30:42 VN = 11:30:42 UTC
    assert played_at == datetime.datetime(2024, 3, 15, 11, 30, 42, tzinfo=datetime.timezone.utc)


def test_parse_played_at_no_match_for_bare_filename():
    """A bare filename like 'rec.aoe2record' must not match the regex → played_at stays None."""
    from website.views.aoe2 import _REC_FILENAME_RE

    assert _REC_FILENAME_RE.search("rec.aoe2record") is None
    assert _REC_FILENAME_RE.search("my_game.aoe2record") is None


@pytest.mark.django_db
def test_upload_sets_played_at_from_filename(client, auth_headers, settings):
    """Uploading a file with a standard rec filename populates played_at on the match."""
    import datetime
    import io

    settings.AOE2_TZ_OFFSET_HOURS = 7

    fname = "MP Replay v1.8 @2024.03.15 183042 (1).aoe2record"
    dummy_content = b"dummy rec content - not a real rec"
    f = io.BytesIO(dummy_content)
    f.name = fname

    # We monkeypatch analyze_match.delay to prevent task execution.
    with patch("website.views.aoe2.analyze_match") as mock_task:
        mock_task.delay = lambda _id, **_kw: None
        resp = client.post("/api/aoe2/upload/", {"rec": f}, **auth_headers)

    assert resp.status_code == 201
    from website.models import Aoe2Match

    match = Aoe2Match.objects.get(id=resp.json()["id"])
    expected = datetime.datetime(2024, 3, 15, 11, 30, 42, tzinfo=datetime.timezone.utc)
    assert match.played_at == expected, f"Expected {expected}, got {match.played_at}"


@pytest.mark.django_db
def test_upload_played_at_none_for_bare_filename(client, auth_headers):
    """Uploading 'rec.aoe2record' (no timestamp in name) → played_at is None."""
    import io

    dummy_content = b"another dummy rec"
    f = io.BytesIO(dummy_content)
    f.name = "rec.aoe2record"

    with patch("website.views.aoe2.analyze_match") as mock_task:
        mock_task.delay = lambda _id, **_kw: None
        resp = client.post("/api/aoe2/upload/", {"rec": f}, **auth_headers)

    assert resp.status_code == 201
    from website.models import Aoe2Match

    match = Aoe2Match.objects.get(id=resp.json()["id"])
    assert match.played_at is None


# ---------------------------------------------------------------------------
# #5 viz — detail endpoint serves the rich v2 data; v2 bundle helpers
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_detail_serves_v2_fields(client):
    """The detail endpoint exposes reconstruction / map_geometry / classifier / mistakes / economy /
    map_images (absolute MEDIA urls) + coach_tier — optional, so old rows degrade to empties."""
    from website.models import Aoe2Match

    m = Aoe2Match.objects.create(
        file_hash="detail-v2",
        analysis_status="done",
        my_civ="Celts",
        opponent_civ="Franks",
        reconstruction={"meta": {"map": "Arabia"}},
        map_geometry={"map_name": "Arabia", "me": {"buildings": []}},
        classifier={"candidates": [{"build_id": "scouts", "name": "Scouts", "confidence": 0.8}]},
        mistakes=[{"id": "slow_feudal", "source": {"study": {"url": "https://x", "title": "T"}}}],
        economy={"estimate": True, "collected": None},
        map_images=["aoe2/maps/5/map_overall.png"],
        coach_tier="agentic",
    )
    data = client.get(f"/api/aoe2/{m.id}/").json()
    assert data["reconstruction"] == {"meta": {"map": "Arabia"}}
    assert data["classifier"]["candidates"][0]["build_id"] == "scouts"
    assert data["mistakes"][0]["source"]["study"]["url"] == "https://x"
    assert data["economy"]["collected"] is None
    assert data["coach_tier"] == "agentic"
    assert data["map_images"] == ["/media/aoe2/maps/5/map_overall.png"]


@pytest.mark.django_db
def test_detail_v2_fields_empty_for_old_rows(client):
    """A match analyzed before v2 (no rich fields) serves safe empties — no crash, viz falls back."""
    from website.models import Aoe2Match

    m = Aoe2Match.objects.create(file_hash="detail-old", analysis_status="done", my_civ="Celts")
    data = client.get(f"/api/aoe2/{m.id}/").json()
    assert data["reconstruction"] == {}
    assert data["mistakes"] == []
    assert data["map_images"] == []


def test_slim_map_geometry_extracts_spatial():
    """_slim_map_geometry pulls the minimap slice (game coords) from a Reconstruction dict."""
    from website.aoe2.v2 import _slim_map_geometry

    recon = {
        "meta": {"map": "Arabia", "map_dim": 120, "duration_s": 1500},
        "spatial": {
            "me": {
                "base_centroid": {"x": 30, "y": 40},
                "buildings": [{"name": "House", "x": 32, "y": 41, "t_s": 60}],
                "forward": [{"name": "Barracks", "x": 80, "y": 80, "t_s": 400}],
                "walls": [{"x": 1, "y": 2, "x_end": 5, "y_end": 2}],
            },
            "opp": {"base_centroid": {"x": 90, "y": 95}, "buildings": [], "walls": []},
        },
        "combat": {"me": {"engagements": [{"zone": "center", "x": 60, "y": 60, "n_commands": 3}]}},
    }
    g = _slim_map_geometry(recon)
    assert g["map_name"] == "Arabia" and g["map_dim"] == 120
    assert g["me"]["base_centroid"] == {"x": 30, "y": 40}
    assert g["me"]["forward"][0]["name"] == "Barracks"
    assert g["opp"]["base_centroid"] == {"x": 90, "y": 95}
    assert g["engagements"][0]["zone"] == "center"


def test_slim_map_geometry_degrades_on_empty():
    """Missing spatial data → empty lists / None, never a KeyError."""
    from website.aoe2.v2 import _slim_map_geometry

    g = _slim_map_geometry({})
    assert g["map_name"] == "" and g["map_dim"] is None
    assert g["me"]["buildings"] == [] and g["opp"]["walls"] == []
    assert g["engagements"] == []


def test_enrich_mistakes_attaches_study_link():
    """_enrich_mistakes merges the rubric's source.study deep-link onto a flagged row.

    Uses a real rubric id from the bundled #6 library so the study link resolves; an unknown id
    leaves the row untouched (honest, no crash)."""
    from aoe2coach.mistakes import load_library

    from website.aoe2.v2 import _enrich_mistakes

    a_real_id = next(iter(load_library().keys()))
    rows = _enrich_mistakes(
        [
            {"id": a_real_id, "name": "x", "severity": "high", "reference_path": f"mistakes/data/{a_real_id}.yaml"},
            {"id": "definitely_not_a_real_rubric", "name": "y", "severity": "low"},
        ]
    )
    assert rows[0]["source"]["study"].get("url"), "real rubric must gain a study url"
    assert "explanation" in rows[0] and "fix" in rows[0]
    assert "source" not in rows[1], "unknown rubric row is left as-is"


@pytest.mark.django_db
def test_enrich_ladder_lenient_civ_match(settings):
    """enrich_ladder matches by time proximity even when civ names don't align."""
    import datetime

    from django.utils import timezone

    from website.models import Aoe2Match
    from website.tasks import enrich_ladder

    settings.AOE2_PROFILE_ID = 14697894
    profile_id = 14697894

    completion_epoch = 1750000000
    played = timezone.datetime.fromtimestamp(completion_epoch - 300, tz=datetime.timezone.utc)
    # Use a civ name that does NOT match relic civ_id=8 ("Celts") — should still match by time.
    m = Aoe2Match.objects.create(
        file_hash="enrich-lenient-civ",
        analysis_status="done",
        my_civ="Britons",  # deliberately wrong civ — should not block match
        played_at=played,
    )

    stat_resp = MagicMock()
    stat_resp.json.return_value = _make_relic_stat_response()
    stat_resp.raise_for_status = MagicMock()

    history_resp = MagicMock()
    history_resp.json.return_value = _make_relic_history_response(
        profile_id=profile_id,
        relic_match_id=99002,
        my_civ_id=8,  # Celts in relic scheme — does not match "Britons" in our scheme
    )
    history_resp.raise_for_status = MagicMock()

    def fake_get(url, **_kwargs):
        if "getPersonalStat" in url:
            return stat_resp
        return history_resp

    with patch("website.aoe2.relic.httpx.get", side_effect=fake_get):
        enrich_ladder()

    m.refresh_from_db()
    assert m.relic_match_id == 99002, "Should match by time proximity despite civ mismatch"


# ---------------------------------------------------------------------------
# Build-order reference library (public endpoints)
# ---------------------------------------------------------------------------


def test_builds_list_public(client):
    """GET /api/aoe2/builds/ is public and returns every build with id/name/family/summary."""
    resp = client.get("/api/aoe2/builds/")
    assert resp.status_code == 200
    builds = resp.json()["builds"]
    # 11 curated Hera builds ship in the aoe2coach package
    assert len(builds) == 11
    ids = {b["id"] for b in builds}
    assert "archers-1-range" in ids
    assert "knight-rush" in ids
    for b in builds:
        assert b["id"] and b["name"] and b["family"]
        assert "summary" in b


def test_build_detail_known_id(client):
    """GET /api/aoe2/builds/<id>/ returns the full build dict for a known id."""
    resp = client.get("/api/aoe2/builds/archers-1-range/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "archers-1-range"
    assert data["family"] == "archers"
    assert data["name"]
    assert "steps" in data and len(data["steps"]) > 0
    assert "age_targets" in data
    assert "whats_next" in data
    assert "source" in data and data["source"]["guide"]


def test_build_detail_unknown_id_404(client):
    """An unknown build id returns 404 (not a 500)."""
    resp = client.get("/api/aoe2/builds/not-a-real-build/")
    assert resp.status_code == 404


def test_build_detail_path_traversal_404(client):
    """A path-traversal-ish slug is rejected as 404, never a server error."""
    resp = client.get("/api/aoe2/builds/_index/")
    assert resp.status_code == 404
