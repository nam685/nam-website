"""Reduce the action stream to a salient, chat/name-free timeline for the owner."""

from mgz.fast import Action

from . import const


def _fmt(ms):
    s = ms // 1000
    return f"{s // 60:02d}:{s % 60:02d}"


def build_timeline(ops, me_number):
    """Build timeline for the owner player only. Used for metrics computation."""
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


def _collapse_spam(lines, window_ms=10_000):
    """Merge consecutive identical (role, tag, name) events within window_ms into 'name xN'.

    Input lines: list of (t_ms, role, tag, name, amount) tuples.
    Output lines: list of (t_ms, role, tag, display_str) tuples.
    """
    if not lines:
        return []

    result = []
    run_t, run_role, run_tag, run_name, run_count = lines[0]
    last_t = run_t  # sliding-window anchor: most recent event in the current run

    for t, role, tag, name, amount in lines[1:]:
        same_event = role == run_role and tag == run_tag and name == run_name
        within_window = (t - last_t) <= window_ms
        if same_event and within_window:
            run_count += amount  # accumulate the event's amount (trains can be >1), not 1
            last_t = t
        else:
            display = f"{run_name} x{run_count}" if run_count > 1 else run_name
            result.append((run_t, run_role, run_tag, display))
            run_t, run_role, run_tag, run_name, run_count = t, role, tag, name, amount
            last_t = t

    display = f"{run_name} x{run_count}" if run_count > 1 else run_name
    result.append((run_t, run_role, run_tag, display))
    return result


def render_salient_log(timeline):
    """Legacy single-player renderer (ME only). Kept for backward compatibility."""
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


def render_dual_log(ops, me_number, opp_number, me_action_count):
    """Produce the coach salient log from both players, asymmetrically.

    ME (owner):  full salient set — AGE_UP, BUILD, TECH (eco), TRAIN.
    OPP (opponent): key strategic markers only —
        - AGE_UP (all ages)
        - BUILD of a military building (in const.MILITARY_BUILDINGS)
        - First TRAIN of each distinct military (non-Villager) unit

    Events are time-sorted across both roles. Consecutive identical events
    within ~10s are collapsed to "name xN".

    Returns the log string with header and trailing APM line.
    """
    age_key = {101: "feudal", 102: "castle", 103: "imperial"}
    me_uptimes = {"feudal": None, "castle": None, "imperial": None}
    opp_uptimes = {"feudal": None, "castle": None, "imperial": None}
    opp_first_units: set[str] = set()

    # Raw event list: (t_ms, role, tag, name, amount)
    raw: list[tuple[int, str, str, str, int]] = []

    for t, action_type, data in ops:
        pid = data.get("player_id")

        if pid == me_number:
            if action_type == Action.RESEARCH:
                tech = data.get("technology_id")
                if tech in age_key and me_uptimes[age_key[tech]] is None:
                    me_uptimes[age_key[tech]] = t
                    raw.append((t, "ME", "AGE_UP", age_key[tech], 1))
                elif tech in const.ECO_TECHS:
                    raw.append((t, "ME", "TECH", const.ECO_TECHS[tech], 1))
            elif action_type == Action.BUILD:
                bname = const.building_name(data.get("building_id"))
                raw.append((t, "ME", "BUILD", bname, 1))
            elif action_type == Action.DE_QUEUE:
                uid = data.get("unit_id")
                amount = int(data.get("amount", 1))
                uname = const.unit_name(uid)
                raw.append((t, "ME", "TRAIN", uname, amount))

        elif pid == opp_number:
            if action_type == Action.RESEARCH:
                tech = data.get("technology_id")
                if tech in age_key and opp_uptimes[age_key[tech]] is None:
                    opp_uptimes[age_key[tech]] = t
                    raw.append((t, "OPP", "AGE_UP", age_key[tech], 1))
                # Exclude all OPP eco techs.
            elif action_type == Action.BUILD:
                bname = const.building_name(data.get("building_id"))
                if bname in const.MILITARY_BUILDINGS:
                    raw.append((t, "OPP", "BUILD", bname, 1))
                # Exclude eco buildings (farms, houses, camps, walls, etc.)
            elif action_type == Action.DE_QUEUE:
                uid = data.get("unit_id")
                uname = const.unit_name(uid)
                # Only military (non-Villager), first occurrence per unit type.
                if uid != const.VILLAGER_ID and uname not in opp_first_units:
                    opp_first_units.add(uname)
                    amount = int(data.get("amount", 1))
                    raw.append((t, "OPP", "TRAIN", uname, amount))

    # Sort by time then role (ME before OPP on tie)
    raw.sort(key=lambda x: (x[0], 0 if x[1] == "ME" else 1))

    # Spam-collapse
    collapsed = _collapse_spam(raw)

    header = (
        "# ME = you (full play). OPP = opponent's key strategic moves only "
        "(age-ups, military buildings, first military unit). "
        "Player names & chat stripped."
    )
    lines = [header]
    for t, role, tag, display in collapsed:
        lines.append(f"{_fmt(t)} {role} {tag} {display}")

    lines.append(f"00:00 APM total_actions={me_action_count}")
    return "\n".join(lines)
