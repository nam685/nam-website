"""Reduce the action stream to a salient, chat/name-free timeline for the owner."""

from mgz.fast import Action

from . import const


def _fmt(ms):
    s = ms // 1000
    return f"{s // 60:02d}:{s % 60:02d}"


def build_timeline(ops, me_number):
    uptimes = {"feudal": None, "castle": None, "imperial": None}
    age_key = {101: "feudal", 102: "castle", 103: "imperial"}
    builds, eco_techs, units, vill_times = [], [], [], []
    action_count = 0

    for t, action_type, data in ops:
        if data.get("player_id") != me_number:
            continue
        action_count += 1
        if action_type == Action.RESEARCH:
            tech = data.get("technology_id")
            if tech in age_key and uptimes[age_key[tech]] is None:
                uptimes[age_key[tech]] = t
            elif tech in const.ECO_TECHS:
                eco_techs.append({"t": t, "name": const.ECO_TECHS[tech]})
        elif action_type == Action.BUILD:
            builds.append({"t": t, "name": const.building_name(data.get("building_id"))})
        elif action_type == Action.DE_QUEUE:
            uid = data.get("unit_id")
            amount = int(data.get("amount", 1))
            units.append({"t": t, "name": const.unit_name(uid), "amount": amount})
            if uid == const.VILLAGER_ID:
                vill_times.append(t)

    return {
        "uptimes": uptimes,
        "builds": builds,
        "eco_techs": eco_techs,
        "units": units,
        "villager_queue_times": vill_times,
        "action_count": action_count,
    }


def render_salient_log(timeline):
    lines = []
    for age, t in timeline["uptimes"].items():
        if t is not None:
            lines.append((t, f"{_fmt(t)} AGE_UP {age}"))
    for b in timeline["builds"]:
        lines.append((b["t"], f"{_fmt(b['t'])} BUILD {b['name']}"))
    for e in timeline["eco_techs"]:
        lines.append((e["t"], f"{_fmt(e['t'])} TECH {e['name']}"))
    for u in timeline["units"]:
        lines.append((u["t"], f"{_fmt(u['t'])} TRAIN {u['name']} x{u['amount']}"))
    lines.sort(key=lambda x: x[0])
    out = [line for _t, line in lines]
    out.append(f"00:00 APM total_actions={timeline['action_count']}")
    return "\n".join(out)
