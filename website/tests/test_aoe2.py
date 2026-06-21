import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import mgz.fast.header
import pytest

from website.aoe2 import const
from website.aoe2.coach import build_coach_prompt, run_claude_coach
from website.aoe2.metrics import classify_opening, compute_metrics
from website.aoe2.parser import parse_rec
from website.aoe2.timeline import build_timeline, render_salient_log

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
    # fixture is an archery-range (Archers) opening
    assert m["opening"] == "Archers"
    # output shapes
    assert all({"name", "amount"} <= a.keys() for a in m["army"])
    assert all({"name", "t_s"} <= e.keys() for e in m["eco_tech_timings"])


def test_classify_opening_archers():
    tl = {
        "uptimes": {"feudal": 600000, "castle": None, "imperial": None},
        "builds": [{"t": 610000, "name": "Archery Range"}],
        "eco_techs": [],
        "units": [{"t": 620000, "name": "Archer", "amount": 1}],
        "villager_queue_times": [],
        "action_count": 50,
    }
    assert classify_opening(tl) == "Archers"


# ---------------------------------------------------------------------------
# Coach unit tests (no fixture needed — subprocess is monkeypatched)
# ---------------------------------------------------------------------------

_SAMPLE_SALIENT_LOG = """\
09:45 AGE_UP feudal
10:02 BUILD Archery Range
10:45 TRAIN Archer x2
12:30 TECH Double-Bit Axe
18:20 AGE_UP castle
00:00 APM total_actions=320
"""

_SAMPLE_METRICS = {
    "feudal_uptime_s": 585,
    "castle_uptime_s": 1100,
    "imperial_uptime_s": None,
    "apm": 53,
    "villager_count": 22,
    "opening": "Archers",
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
    assert "Archers" in prompt  # opening tag
    assert "53" in prompt  # apm


def test_run_claude_coach_success():
    fake_json = json.dumps(
        {
            "result": "Good feudal uptime. Focus on villager production in Castle Age.",
            "model": "claude-opus-4-5",
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
    assert model == "claude-opus-4-5"


def test_run_claude_coach_nonzero_exit_raises():
    fake_proc = MagicMock()
    fake_proc.returncode = 1
    fake_proc.stdout = ""
    fake_proc.stderr = "permission denied"

    with patch("website.aoe2.coach.subprocess.run", return_value=fake_proc):
        with pytest.raises(RuntimeError, match="exited 1"):
            run_claude_coach("some prompt")


def test_run_claude_coach_missing_result_raises():
    fake_json = json.dumps({"model": "claude-opus-4-5", "is_error": False})
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
    """Return (fake_rec, fake_timeline, fake_metrics, fake_salient) stubs."""
    fake_rec = MagicMock()
    fake_rec.is_1v1 = True
    fake_rec.is_ranked = True
    fake_rec.me = {"number": 1, "civ_name": "Celts", "is_me": True}
    fake_rec.opponent = {"civ_name": "Franks", "is_me": False}
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
        "opening": "Archers",
        "army": [],
        "eco_tech_timings": [],
        "estimates": [],
    }
    fake_salient = "09:45 AGE_UP feudal\n00:00 APM total_actions=320"
    return fake_rec, fake_timeline, fake_metrics, fake_salient


@pytest.mark.django_db
def test_analyze_match_stores_coach_analysis(settings, monkeypatch):
    """Coach succeeds → coach_analysis + coach_model are stored on the match."""
    from website.tasks import analyze_match

    settings.AOE2_PROFILE_ID = OWNER_PROFILE_ID
    fake_rec, fake_timeline, fake_metrics, fake_salient = _fake_pipeline()

    monkeypatch.setattr("website.tasks.parse_rec", lambda *_a, **_kw: fake_rec)
    monkeypatch.setattr("website.tasks.build_timeline", lambda *_a, **_kw: fake_timeline)
    monkeypatch.setattr("website.tasks.compute_metrics", lambda *_a, **_kw: fake_metrics)
    monkeypatch.setattr("website.tasks.render_salient_log", lambda *_a, **_kw: fake_salient)
    monkeypatch.setattr(
        "website.tasks.run_claude_coach",
        lambda *_a, **_kw: ("Great game. Work on villager production.", "claude-opus-4-5"),
    )

    m = _make_match_with_dummy_file("coach-success-hash")
    analyze_match(m.id)
    m.refresh_from_db()

    assert m.analysis_status == "done"
    assert "villager production" in m.coach_analysis
    assert m.coach_model == "claude-opus-4-5"


@pytest.mark.django_db
def test_analyze_match_graceful_coach_failure(settings, monkeypatch):
    """Coach raises → status is still 'done', coach_analysis is empty string."""
    from website.tasks import analyze_match

    settings.AOE2_PROFILE_ID = OWNER_PROFILE_ID
    fake_rec, fake_timeline, fake_metrics, fake_salient = _fake_pipeline()

    monkeypatch.setattr("website.tasks.parse_rec", lambda *_a, **_kw: fake_rec)
    monkeypatch.setattr("website.tasks.build_timeline", lambda *_a, **_kw: fake_timeline)
    monkeypatch.setattr("website.tasks.compute_metrics", lambda *_a, **_kw: fake_metrics)
    monkeypatch.setattr("website.tasks.render_salient_log", lambda *_a, **_kw: fake_salient)
    monkeypatch.setattr(
        "website.tasks.run_claude_coach",
        lambda *_a, **_kw: (_ for _ in ()).throw(RuntimeError("claude not found")),
    )

    m = _make_match_with_dummy_file("coach-fail-hash")
    analyze_match(m.id)
    m.refresh_from_db()

    assert m.analysis_status == "done"
    assert m.coach_analysis == ""


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
    assert "opening" in m.metrics


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
