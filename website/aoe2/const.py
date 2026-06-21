"""AoE2 DE id->name maps. mgz-fast ships only map names, so we supply the rest.
Source: aoe2techtree community data. Fallbacks return "#<id>" so unknown ids never crash."""

VILLAGER_ID = 83

AGE_TECHS = {101: "Feudal Age", 102: "Castle Age", 103: "Imperial Age"}

# Economy upgrades we surface timing for (tech_id -> name).
ECO_TECHS = {
    22: "Loom",
    213: "Wheelbarrow",
    249: "Hand Cart",
    202: "Double-Bit Axe",
    203: "Bow Saw",
    221: "Two-Man Saw",
    14: "Horse Collar",
    13: "Heavy Plow",
    12: "Crop Rotation",
    55: "Gold Mining",
    278: "Stone Mining",
    182: "Gold Shaft Mining",
    279: "Stone Shaft Mining",
    8: "Town Watch",
    65: "Fishing Ship (Gillnets)",
    280: "Town Patrol",
}

# AoE2 DE "dat" civilization_id -> name (DE reordered these vs classic AoC ids).
CIV_NAMES = {
    1: "Britons",
    2: "Franks",
    3: "Goths",
    4: "Teutons",
    5: "Japanese",
    6: "Chinese",
    7: "Byzantines",
    8: "Persians",
    9: "Saracens",
    10: "Turks",
    11: "Vikings",
    12: "Mongols",
    13: "Celts",
    14: "Spanish",
    15: "Aztecs",
    16: "Mayans",
    17: "Huns",
    18: "Koreans",
    19: "Italians",
    20: "Hindustanis",
    21: "Incas",
    22: "Magyars",
    23: "Slavs",
    24: "Portuguese",
    25: "Ethiopians",
    26: "Malians",
    27: "Berbers",
    28: "Khmer",
    29: "Malay",
    30: "Burmese",
    31: "Vietnamese",
    32: "Bulgarians",
    33: "Tatars",
    34: "Cumans",
    35: "Lithuanians",
    36: "Burgundians",
    37: "Sicilians",
    38: "Poles",
    39: "Bohemians",
    40: "Dravidians",
    41: "Bengalis",
    42: "Gurjaras",
    # 43-45 in DE are Random/Mirror/Full Random (never a resolved game civ).
    # Newer civs (Romans/Armenians/Georgians/Three Kingdoms) use ids >=46 and are not yet
    # mapped — civ_name() falls back to "#<id>" for them.
}

# Common buildings (building_id -> name).
BUILDING_NAMES = {
    70: "House",
    68: "Mill",
    562: "Lumber Camp",
    584: "Mining Camp",
    109: "Town Center",
    12: "Barracks",
    87: "Archery Range",
    101: "Stable",
    49: "Siege Workshop",
    79: "Watch Tower",
    84: "Market",
    103: "Blacksmith",
    209: "University",
    104: "Monastery",
    117: "Stone Wall",
    72: "Palisade Wall",
    487: "Gate",
    199: "Fish Trap",
    45: "Dock",
    82: "Castle",
    276: "Wonder",
    463: "Krepost",
    1665: "Donjon",
    1251: "Folwark",
}

# Common units (unit_id -> name).
UNIT_NAMES = {
    83: "Villager",
    448: "Scout Cavalry",
    4: "Archer",
    24: "Crossbowman",
    7: "Skirmisher",
    74: "Militia",
    75: "Man-at-Arms",
    77: "Long Swordsman",
    38: "Knight",
    39: "Cavalry Archer",
    329: "Camel Rider",
    125: "Monk",
    280: "Mangonel",
    36: "Bombard Cannon",
    35: "Battering Ram",
    11: "Trade Cart",
    17: "Trade Cog",
    13: "Fishing Ship",
    128: "Trebuchet",
    1103: "Fire Galley",
    250: "Longboat",
    5: "Hand Cannoneer",
    873: "Eagle Scout",
    751: "Eagle Warrior",
}


def civ_name(civ_id):
    return CIV_NAMES.get(civ_id, f"#{civ_id}")


def building_name(bid):
    return BUILDING_NAMES.get(bid, f"#{bid}")


def unit_name(uid):
    return UNIT_NAMES.get(uid, f"#{uid}")
