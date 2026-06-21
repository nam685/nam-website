from pathlib import Path

import mgz.fast.header

from website.aoe2 import const
from website.aoe2.parser import parse_rec

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
