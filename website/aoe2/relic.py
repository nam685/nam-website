"""Relic ladder API helpers for AoE2 DE.

Base host is configurable via settings.AOE2_RELIC_HOST (default:
https://aoe-api.worldsedgelink.com).  All functions return plain dicts so they
are easy to mock in tests.  No auth required; daily polling is safe per spec.
"""

import logging

import httpx
from django.conf import settings

logger = logging.getLogger(__name__)

_LEADERBOARD_1V1_RM = 3
_MATCHTYPE_1V1_RM = 6


def _host() -> str:
    return getattr(settings, "AOE2_RELIC_HOST", "https://aoe-api.worldsedgelink.com")


def get_personal_stat(profile_id: int) -> dict:
    """Return current ELO/rank/win-loss for the given profile on 1v1 RM (leaderboard_id=3).

    Returns a dict with keys: rating, rank, wins, losses.
    Raises httpx.HTTPError on network failure (caller decides whether to propagate).
    """
    url = f"{_host()}/community/leaderboard/getPersonalStat"
    params = {"title": "age2", "profile_ids": f"[{profile_id}]"}
    resp = httpx.get(url, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    # Response shape: {"result": {"leaderboard_stats": [{leaderboard_id, wins, losses, rating, rank, ...}]}}
    stats_list = data.get("result", {}).get("leaderboard_stats", [])
    for entry in stats_list:
        if entry.get("leaderboard_id") == _LEADERBOARD_1V1_RM:
            return {
                "rating": entry.get("rating"),
                "rank": entry.get("rank"),
                "wins": entry.get("wins", 0),
                "losses": entry.get("losses", 0),
            }
    logger.warning("get_personal_stat: no 1v1 RM entry found for profile_id=%s", profile_id)
    return {"rating": None, "rank": None, "wins": 0, "losses": 0}


def get_recent_1v1_matches(profile_id: int) -> list[dict]:
    """Return recent ranked 1v1 RM matches for the profile, newest first.

    Each dict has:
      relic_match_id, completiontime (epoch int), map,
      my_outcome ('win'|'loss'|'unknown'),
      my_old (oldrating), my_new (newrating),
      opp_old (opponent oldrating), opp_new (opponent newrating),
      my_civ_id (int), opp_civ_id (int).

    Filters matchtype_id==6 (ranked 1v1 RM).
    Raises httpx.HTTPError on network failure.
    """
    url = f"{_host()}/community/leaderboard/getRecentMatchHistory"
    params = {"title": "age2", "profile_ids": f"[{profile_id}]"}
    resp = httpx.get(url, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    matches_raw = data.get("result", {}).get("matchhistorymatch", []) or []
    result = []
    for match in matches_raw:
        if match.get("matchtype_id") != _MATCHTYPE_1V1_RM:
            continue

        members = match.get("matchhistorymember", []) or []
        me = None
        opp = None
        for m in members:
            if m.get("profile_id") == profile_id:
                me = m
            else:
                opp = m

        if me is None or opp is None:
            continue  # unexpected shape, skip

        outcome_raw = me.get("outcome", -1)
        if outcome_raw == 1:
            outcome = "win"
        elif outcome_raw == 0:
            outcome = "loss"
        else:
            outcome = "unknown"

        result.append(
            {
                "relic_match_id": match.get("id"),
                "completiontime": match.get("completiontime"),
                "map": match.get("mapname", ""),
                "my_outcome": outcome,
                "my_old": me.get("oldrating"),
                "my_new": me.get("newrating"),
                "opp_old": opp.get("oldrating"),
                "opp_new": opp.get("newrating"),
                "my_civ_id": me.get("civilization_id"),
                "opp_civ_id": opp.get("civilization_id"),
            }
        )

    return result
