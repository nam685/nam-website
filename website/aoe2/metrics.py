"""Derived metrics + opening classification from the salient timeline."""

from collections import defaultdict


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
        "opening": classify_opening(timeline),
        "army": [{"name": n, "amount": a} for n, a in sorted(army.items(), key=lambda x: -x[1])],
        "eco_tech_timings": [{"name": e["name"], "t_s": e["t"] // 1000} for e in timeline["eco_techs"]],
        "estimates": [],
    }
