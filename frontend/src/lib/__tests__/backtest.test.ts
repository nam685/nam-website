import { describe, expect, it } from "vitest";

import { curveToPoints, fmtMoney, fmtPct } from "../backtest";

describe("backtest helpers", () => {
  it("maps a curve to SVG points within the viewbox", () => {
    const pts = curveToPoints([100, 150, 200], 100, 50);
    const coords = pts.split(" ").map((p) => p.split(",").map(Number));
    expect(coords).toHaveLength(3);
    expect(coords[0][0]).toBe(0); // first x at 0
    expect(coords[2][0]).toBe(100); // last x at width
    expect(coords[0][1]).toBe(50); // min value -> bottom (y=height)
    expect(coords[2][1]).toBe(0); // max value -> top (y=0)
  });

  it("formats percentages with sign", () => {
    expect(fmtPct(12.345)).toBe("+12.35%");
    expect(fmtPct(-3.2)).toBe("-3.20%");
    expect(fmtPct(null)).toBe("—");
  });

  it("formats money", () => {
    expect(fmtMoney(1234.5)).toBe("$1,234.50");
  });
});
