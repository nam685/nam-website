"""Derived metrics from the salient timeline. Opening classification is handled by the coach."""

from collections import defaultdict


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
        "army": [{"name": n, "amount": a} for n, a in sorted(army.items(), key=lambda x: -x[1])],
        "eco_tech_timings": [{"name": e["name"], "t_s": e["t"] // 1000} for e in timeline["eco_techs"]],
        "estimates": [],
    }
