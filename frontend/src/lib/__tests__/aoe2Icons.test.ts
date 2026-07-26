import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AOE2_ICON_BY_NAME, aoe2IconUrl } from "../aoe2Icons";
import CONST_NAMES from "./aoe2ConstNames.json";

// aoe2ConstNames.json is the union of every display name in aoe2coach const.py
// (UNIT_NAMES, BUILDING_NAMES, MILITARY_TECHS, UNIVERSITY_TECHS, ECO_TECHS, AGE_TECHS).
// Regenerate it together with the icon map via scripts/gen_aoe2_icons.py.

const here = dirname(fileURLToPath(import.meta.url));
const ICON_DIR = join(here, "..", "..", "..", "public", "aoe2-icons");

describe("aoe2 icon coverage", () => {
  it("every const display name resolves to a bundled icon (no glyph fallback)", () => {
    const missing = (CONST_NAMES as string[]).filter(
      (name) => aoe2IconUrl(name) === null,
    );
    expect(missing).toEqual([]);
  });

  it("every mapped icon file actually exists on disk", () => {
    const broken = Object.entries(AOE2_ICON_BY_NAME)
      .filter(([, file]) => !existsSync(join(ICON_DIR, file)))
      .map(([name, file]) => `${name} -> ${file}`);
    expect(broken).toEqual([]);
  });

  it("returns null for a genuinely-unknown name (glyph/question-mark fallback path)", () => {
    expect(aoe2IconUrl("Totally Made Up Unit 9000")).toBeNull();
    expect(aoe2IconUrl(null)).toBeNull();
    expect(aoe2IconUrl(undefined)).toBeNull();
  });
});
