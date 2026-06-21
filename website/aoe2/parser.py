"""Adapter over mgz-fast (no Summary class). Parses a .aoe2record into a ParsedRec."""

from dataclasses import dataclass, field

import mgz.const
import mgz.fast
import mgz.fast.header
from mgz.fast import Action, Operation

from . import const

EMPTY_PROFILE_ID = 4294967295  # 0xFFFFFFFF marks an empty/closed slot


@dataclass
class ParsedRec:
    version: str
    save_version: float
    map_name: str
    duration_ms: int
    is_1v1: bool
    is_ranked: bool
    me: dict | None
    opponent: dict | None
    my_result: str
    ops: list = field(default_factory=list)


def _read_ops(f):
    """Iterate the body. Returns (ops, duration_ms). Chat ops are dropped here (privacy)."""
    mgz.fast.meta(f)
    ops = []
    clock = 0
    while True:
        try:
            op_type, payload = mgz.fast.operation(f)
        except EOFError:
            break
        if op_type == Operation.SYNC:
            inc, _checksum, info = payload
            clock += inc
            if isinstance(info, dict) and "current_time" in info:
                clock = info["current_time"]
            continue
        if op_type == Operation.ACTION:
            action_type, data = payload
            ops.append((clock, action_type, data))
    return ops, clock


def _result_from_ops(ops, me_number, opp_number):
    """1v1 result via RESIGN heuristic. Authoritative result comes later from relic (Phase 3)."""
    for _t, action_type, data in ops:
        if action_type == Action.RESIGN:
            pid = data.get("player_id")
            if pid == opp_number:
                return "win"
            if pid == me_number:
                return "loss"
    return "unknown"


def parse_rec(path, owner_profile_id):
    with open(path, "rb") as f:
        header = mgz.fast.header.parse(f)
        ops, duration_ms = _read_ops(f)

    de_players = [p for p in header["de"]["players"] if p.get("type") == 2]  # 2 = human
    is_1v1 = len(de_players) == 2 and all(p.get("profile_id") != EMPTY_PROFILE_ID for p in de_players)

    def to_dict(p):
        civ_id = p.get("civilization_id")
        return {
            "number": p.get("number"),
            "civ_id": civ_id,
            "civ_name": const.civ_name(civ_id),
            "color_id": p.get("color_id"),
            "team_id": p.get("team_id"),
            "profile_id": p.get("profile_id"),
            "is_me": p.get("profile_id") == owner_profile_id,
        }

    players = [to_dict(p) for p in de_players]
    me = next((p for p in players if p["is_me"]), None)
    opponent = next((p for p in players if not p["is_me"]), None) if me else None

    map_id = header["de"].get("rms_map_id")
    map_name = mgz.const.DE_MAP_NAMES.get(map_id, f"#{map_id}") if map_id is not None else ""

    my_result = "unknown"
    if is_1v1 and me and opponent:
        my_result = _result_from_ops(ops, me["number"], opponent["number"])

    # header["de"]["rated"] is True for ranked matches, False for unranked/custom.
    # This field is present in all DE recs (verified across 327 samples).
    is_ranked = bool(header["de"].get("rated", False))

    return ParsedRec(
        version=str(header["version"]),
        save_version=float(header["save_version"]),
        map_name=map_name,
        duration_ms=duration_ms,
        is_1v1=is_1v1,
        is_ranked=is_ranked,
        me=me,
        opponent=opponent,
        my_result=my_result,
        ops=ops,
    )
