from pathlib import Path

import mgz.fast.header

from website.aoe2 import const
from website.aoe2.metrics import classify_opening, compute_metrics
from website.aoe2.parser import parse_rec
from website.aoe2.timeline import build_timeline, render_salient_log

FIXTURE = Path(__file__).parent / "fixtures" / "sample_1v1.aoe2record"
OWNER_PROFILE_ID = 14697894


def test_fixture_exists():
    assert FIXTURE.exists(), "place a real .aoe2record at website/tests/fixtures/sample_1v1.aoe2record"


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
    # the idle-TC estimate is labelled as an estimate
    assert "idle_tc_est_s" in m["estimates"]
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


import pytest


@pytest.mark.django_db
def test_aoe2_match_model_defaults():
    from website.models import Aoe2Match

    m = Aoe2Match.objects.create(file_hash="abc123", my_civ="Celts", opponent_civ="Franks")
    assert m.analysis_status == "pending"
    assert m.featured is False
    assert m.timeline == {} and m.metrics == {}
