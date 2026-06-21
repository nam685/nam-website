from pathlib import Path

import mgz.fast.header

from website.aoe2 import const

FIXTURE = Path(__file__).parent / "fixtures" / "sample_1v1.aoe2record"


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
