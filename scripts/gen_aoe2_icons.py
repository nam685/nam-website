#!/usr/bin/env python3
"""Regenerate frontend/src/lib/aoe2Icons.ts + the bundled PNGs under
frontend/public/aoe2-icons/, achieving 100% icon coverage for every display name in
aoe2coach const.py (UNIT_NAMES, BUILDING_NAMES, MILITARY_TECHS, UNIVERSITY_TECHS, ECO_TECHS,
AGE_TECHS).

Source of truth: SiegeEngineers/aoe2techtree. aoe2techtree names its icon PNGs by the genie
*picture_index*, NOT the entity id. The per-civ tree JSONs under data/trees/<CIV>.json carry,
for every node, both `node_id` (== the entity id used in const.py) and `picture_index`
(== the icon file stem under img/{Unit,Building,Tech}/<picture_index>.png).

We download every per-civ tree, aggregate node_id->picture_index and name->picture_index across
all civs (the union covers every entity), resolve each const.py name (id first, then name, then a
cross-type name match for unit-line techs, then a small MANUAL table for entities aoe2techtree's
visual tree omits), download the referenced PNGs, prune orphans, and emit the TS map.

Usage:
    AOE2COACH=/path/to/aoe2coach python3 scripts/gen-aoe2-icons.py
Requires network access to raw.githubusercontent.com. Idempotent.
"""

import importlib.util
import json
import os
import re
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ICON_DIR = REPO / "frontend" / "public" / "aoe2-icons"
TS_OUT = REPO / "frontend" / "src" / "lib" / "aoe2Icons.ts"
NAMES_OUT = REPO / "frontend" / "src" / "lib" / "__tests__" / "aoe2ConstNames.json"
AOE2COACH = Path(os.environ.get("AOE2COACH", Path.home() / "projects" / "aoe2coach"))

RAW = "https://raw.githubusercontent.com/SiegeEngineers/aoe2techtree/master"
# Standard + DLC civs whose tree JSONs exist (union covers every entity in const.py).
CIVS = [
    "ARMENIANS",
    "AZTECS",
    "BENGALIS",
    "BERBERS",
    "BOHEMIANS",
    "BRITONS",
    "BULGARIANS",
    "BURGUNDIANS",
    "BURMESE",
    "BYZANTINES",
    "CELTS",
    "CHINESE",
    "CUMANS",
    "DRAVIDIANS",
    "ETHIOPIANS",
    "FRANKS",
    "GEORGIANS",
    "GOTHS",
    "GURJARAS",
    "HINDUSTANIS",
    "HUNS",
    "INCAS",
    "ITALIANS",
    "JAPANESE",
    "KHMER",
    "KOREANS",
    "LITHUANIANS",
    "MAGYARS",
    "MALAY",
    "MALIANS",
    "MAYANS",
    "MONGOLS",
    "PERSIANS",
    "POLES",
    "PORTUGUESE",
    "ROMANS",
    "SARACENS",
    "SICILIANS",
    "SLAVS",
    "SPANISH",
    "TATARS",
    "TEUTONS",
    "TURKS",
    "VIETNAMESE",
    "VIKINGS",
    "SHU",
    "WU",
    "WEI",
    "JURCHENS",
    "KHITANS",
    "MUISCA",
    "MAPUCHE",
    "TUPI",
]

# Entities aoe2techtree's *visual* tree doesn't expose a researchable node for (passive/auto
# techs, scenario units, gate variants). Resolved by id-alias to the canonical entity / proxy.
# (use_type, entity_id) -> (use_type, picture_index). Verified against the repo img set.
MANUAL = {
    ("Unit", 42): ("Unit", 29),  # Trebuchet (civ-specific id) -> packed-treb icon
    ("Unit", 1252): ("Unit", 249),  # Konnik (Dismounted) -> Konnik
    ("Unit", 1253): ("Unit", 506),  # Elite Konnik (Dismounted) -> Elite Konnik
    ("Unit", 1738): ("Unit", 389),  # Ratha (Melee) -> Ratha
    ("Unit", 1740): ("Unit", 389),  # Elite Ratha (Melee) -> Ratha
    ("Unit", 1570): ("Unit", 109),  # Xolotl Warrior (scenario) -> Eagle Scout proxy
    ("Building", 665): ("Building", 36),
    ("Building", 673): ("Building", 36),
    ("Building", 796): ("Building", 36),
    ("Building", 800): ("Building", 36),
    ("Building", 804): ("Building", 36),
    ("Tech", 716): ("Tech", 174),  # Supplies (passive) -> genie pic 174
    ("Tech", 90): ("Tech", 83),  # Tracking (passive) -> genie pic 83
}
PFX = {"Unit": "unit", "Building": "building", "Tech": "tech"}
AGES = {
    "Feudal Age": "age_base_feudal_age.png",
    "Castle Age": "age_base_castle_age.png",
    "Imperial Age": "age_base_imperial_age.png",
}


def load_const():
    spec = importlib.util.spec_from_file_location("aoe2const", AOE2COACH / "aoe2coach" / "const.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def walk(o):
    """Yield every dict in a tree JSON that carries both node_id and picture_index."""
    if isinstance(o, dict):
        if o.get("node_id") is not None and o.get("picture_index") is not None:
            yield o
        for v in o.values():
            yield from walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk(v)


def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read()


def main():
    const = load_const()
    by_id, by_name = {}, {}
    for civ in CIVS:
        try:
            data = json.loads(fetch(f"{RAW}/data/trees/{civ}.json"))
        except Exception:
            continue
        for n in walk(data):
            ut = n.get("use_type") or n.get("node_type")
            ut = {"BuildingTech": "Building", "UnitUpgrade": "Unit"}.get(ut, ut)
            if ut not in PFX:
                continue
            pic, nid, nm = n["picture_index"], n["node_id"], n.get("name")
            by_id.setdefault((ut, nid), pic)
            if nm:
                by_name.setdefault((ut, nm), pic)

    targets = []
    for uid, name in const.UNIT_NAMES.items():
        targets.append((name, "Unit", uid))
    for bid, name in const.BUILDING_NAMES.items():
        targets.append((name, "Building", bid))
    for tid, name in {**const.MILITARY_TECHS, **const.UNIVERSITY_TECHS, **const.ECO_TECHS}.items():
        targets.append((name, "Tech", tid))

    resolved, needed, unresolved = {}, set(), []
    for name, ut, eid in targets:
        pic, rut = by_id.get((ut, eid)), ut
        if pic is None:
            pic = by_name.get((ut, name))
        if pic is None and ut == "Tech":
            for au in ("Unit", "Building"):
                if (p2 := by_name.get((au, name))) is not None:
                    pic, rut = p2, au
                    break
        if pic is None and (ut, eid) in MANUAL:
            rut, pic = MANUAL[(ut, eid)]
        if pic is None:
            unresolved.append((name, ut, eid))
            continue
        resolved.setdefault(name, f"{PFX[rut]}_{pic}.png")
        needed.add((rut, pic))

    if unresolved:
        raise SystemExit(f"UNRESOLVED const names (no icon): {unresolved}")

    resolved.update(AGES)

    # Emit the coverage-test fixture: the union of every const.py display name.
    all_names = sorted(set(resolved) | set(const.AGE_TECHS.values()))
    NAMES_OUT.write_text(json.dumps(all_names, indent=2) + "\n")  # 2-space = Prettier default

    # Download PNGs; prune orphans.
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    keep = set(resolved.values())
    for ut, pic in sorted(needed):
        fn = f"{PFX[ut]}_{pic}.png"
        dst = ICON_DIR / fn
        if dst.exists():
            continue
        dst.write_bytes(fetch(f"{RAW}/img/{ut}/{pic}.png"))
    for f in ICON_DIR.glob("*.png"):
        if f.name not in keep:
            f.unlink()

    # Emit TS.
    rows = []
    for name, fn in sorted(resolved.items()):
        key = name if re.match(r"^[A-Za-z_$][A-Za-z0-9_$]*$", name) else json.dumps(name)
        rows.append(f"  {key}: {json.dumps(fn)},")
    TS_OUT.write_text(
        "// AUTO-GENERATED — do not edit by hand. Regenerate via scripts/gen_aoe2_icons.py.\n"
        "// Maps aoe2coach display names (techs / units / buildings / ages) to a bundled icon file\n"
        "// under /aoe2-icons/ (sourced from SiegeEngineers/aoe2techtree, same-origin / CSP-safe).\n"
        "//\n"
        "// aoe2techtree names its icon PNGs by the genie *picture_index*, NOT the entity id. This map\n"
        "// is built from aoe2techtree's per-civ tree JSONs (node_id / name -> picture_index -> file)\n"
        "// and covers EVERY display name in aoe2coach const.py — verified by the aoe2Icons coverage\n"
        "// test. A name absent here is a genuinely-unknown string (e.g. a brand-new unit not yet in\n"
        "// const.py); the UI then renders a question-mark icon, never a broken image.\n\n"
        "export const AOE2_ICON_BY_NAME: Record<string, string> = {\n" + "\n".join(rows) + "\n};\n\n"
        "/** Resolve an aoe2coach name to its bundled icon URL, or null when unmapped. */\n"
        "export function aoe2IconUrl(name: string | null | undefined): string | null {\n"
        "  if (!name) return null;\n"
        "  const f = AOE2_ICON_BY_NAME[name];\n"
        "  return f ? `/aoe2-icons/${f}` : null;\n"
        "}\n"
    )
    print(f"resolved={len(resolved)} icons={len(keep)} -> {TS_OUT}")


if __name__ == "__main__":
    main()
