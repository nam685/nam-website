"""Derived metrics from the salient timeline. Opening classification is handled by the coach."""

from collections import defaultdict

from .timeline import AGE_RESEARCH_MS


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

    def _arrival_s(age):
        click_ms = up[age]
        if click_ms is None:
            return None
        return (click_ms + AGE_RESEARCH_MS[age]) // 1000

    return {
        "feudal_uptime_s": _arrival_s("feudal"),
        "castle_uptime_s": _arrival_s("castle"),
        "imperial_uptime_s": _arrival_s("imperial"),
        "apm": apm,
        "villager_count": villagers,
        "army": [{"name": n, "amount": a} for n, a in sorted(army.items(), key=lambda x: -x[1])],
        "eco_tech_timings": [{"name": e["name"], "t_s": e["t"] // 1000} for e in timeline["eco_techs"]],
        "estimates": [],
    }
