from pathlib import Path

import mgz.fast.header
import pytest

from website.aoe2 import const
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
    assert const.civ_name(8) == "Celts"
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
