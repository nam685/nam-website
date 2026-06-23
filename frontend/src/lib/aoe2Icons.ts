// AUTO-GENERATED — do not edit by hand. Regenerate via scratchpad mapping script.
// Maps aoe2coach display names (techs / units / buildings / ages) to a bundled icon file
// under /aoe2-icons/ (sourced from SiegeEngineers/aoe2techtree, same-origin / CSP-safe).
//
// IMPORTANT: aoe2techtree names its icon PNGs by the genie *picture_index*, NOT the entity
// id. The previous map wrongly paired names with <type>_<entityId>.png, so most tech/unit
// icons showed the wrong art. This map is rebuilt from aoe2techtree's per-civ tree JSONs
// (name_string_id -> display name, picture_index -> file). Names without a bundled icon are
// absent here; the UI falls back to a monogram glyph.

export const AOE2_ICON_BY_NAME: Record<string, string> = {
  Arbalester: "unit_90.png",
  "Archery Range": "building_0.png",
  Ballistics: "tech_25.png",
  Banking: "tech_3.png",
  Blacksmith: "building_4.png",
  "Bodkin Arrow": "tech_35.png",
  "Bombard Cannon": "unit_30.png",
  "Bow Saw": "tech_71.png",
  Bracer: "tech_37.png",
  "Castle Age": "age_base_castle_age.png",
  Cataphract: "unit_35.png",
  "Cavalry Archer": "unit_19.png",
  "Chain Barding Armor": "tech_23.png",
  "Chain Mail Armor": "tech_22.png",
  Champion: "unit_72.png",
  "Chu Ko Nu": "unit_36.png",
  Coinage: "tech_7.png",
  Conscription: "tech_91.png",
  "Crop Rotation": "tech_0.png",
  Crossbowman: "unit_18.png",
  "Demolition Ship": "unit_84.png",
  "Double-Bit Axe": "tech_70.png",
  "Eagle Scout": "unit_109.png",
  "Elite Cataphract": "unit_476.png",
  "Elite Eagle Warrior": "unit_149.png",
  "Elite Huskarl": "unit_478.png",
  "Elite Mameluke": "unit_479.png",
  "Elite Teutonic Knight": "unit_477.png",
  "Feudal Age": "age_base_feudal_age.png",
  "Fishing Ship": "unit_24.png",
  Fletching: "tech_34.png",
  "Fortified Wall": "tech_46.png",
  Gillnets: "tech_41.png",
  "Guard Tower": "tech_76.png",
  Guilds: "tech_58.png",
  "Hand Cart": "tech_42.png",
  "Heavy Cavalry Archer": "unit_71.png",
  "Heavy Demo Ship": "unit_83.png",
  "Heavy Demolition Ship": "unit_83.png",
  "Heavy Plow": "tech_1.png",
  "Heavy Scorpion": "unit_89.png",
  "Horse Collar": "tech_2.png",
  Huskarl: "unit_50.png",
  "Imperial Age": "age_base_imperial_age.png",
  Janissary: "unit_39.png",
  Keep: "tech_16.png",
  Knight: "unit_1.png",
  "Light Cavalry": "unit_91.png",
  Longbowman: "unit_41.png",
  Loom: "tech_6.png",
  Mangudai: "unit_42.png",
  Market: "building_16.png",
  Masonry: "tech_13.png",
  Militia: "unit_8.png",
  Monastery: "building_10.png",
  "Murder Holes": "tech_61.png",
  Onager: "unit_101.png",
  "Plate Barding Armor": "tech_65.png",
  Samurai: "unit_44.png",
  "Scale Barding Armor": "tech_66.png",
  "Siege Ram": "unit_73.png",
  Slinger: "unit_143.png",
  Spearman: "unit_31.png",
  Stable: "building_23.png",
  "Teutonic Knight": "unit_45.png",
  "Town Center": "building_28.png",
  "Trade Cog": "unit_23.png",
  "Transport Ship": "unit_95.png",
  "Two-Handed Swordsman": "unit_12.png",
  Villager: "unit_15.png",
  "War Galley": "unit_25.png",
  "Woad Raider": "unit_47.png",
};

/** Resolve an aoe2coach name to its bundled icon URL, or null when unmapped. */
export function aoe2IconUrl(name: string | null | undefined): string | null {
  if (!name) return null;
  const f = AOE2_ICON_BY_NAME[name];
  return f ? `/aoe2-icons/${f}` : null;
}
