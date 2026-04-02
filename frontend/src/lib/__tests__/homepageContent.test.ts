import { describe, expect, it } from "vitest";
import { angleFromCenter, lerpDotColor, DOTS } from "../homepageContent";

describe("angleFromCenter", () => {
  it("returns 0 for directly above center", () => {
    expect(angleFromCenter(0, -10)).toBeCloseTo(0, 0);
  });

  it("returns 90 for directly right of center", () => {
    expect(angleFromCenter(10, 0)).toBeCloseTo(90, 0);
  });

  it("returns 180 for directly below center", () => {
    expect(angleFromCenter(0, 10)).toBeCloseTo(180, 0);
  });

  it("returns 270 for directly left of center", () => {
    expect(angleFromCenter(-10, 0)).toBeCloseTo(270, 0);
  });

  it("returns 45 for top-right diagonal", () => {
    expect(angleFromCenter(10, -10)).toBeCloseTo(45, 0);
  });
});

describe("lerpDotColor", () => {
  it("returns first dot color at its exact angle", () => {
    // DOTS[0] is thinks at 0°, color #FF1744 = rgb(255, 23, 68)
    expect(lerpDotColor(0)).toEqual([255, 23, 68]);
  });

  it("returns second dot color at its exact angle", () => {
    // DOTS[1] is draws at 40°, color #a855f7 = rgb(168, 85, 247)
    expect(lerpDotColor(40)).toEqual([168, 85, 247]);
  });

  it("returns interpolated color at midpoint between two dots", () => {
    const [r, g, b] = lerpDotColor(20);
    // Should be a blend — not equal to either endpoint
    expect([r, g, b]).not.toEqual([255, 23, 68]);
    expect([r, g, b]).not.toEqual([168, 85, 247]);
    // Each channel should be between the two endpoints
    expect(r).toBeGreaterThanOrEqual(168);
    expect(r).toBeLessThanOrEqual(255);
  });

  it("wraps correctly between last dot and first dot", () => {
    const [r, g, b] = lerpDotColor(340);
    // 340° is between bets (320°, #db2777) and thinks (0°, #FF1744)
    // Should be valid channel values
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(255);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
  });
});

describe("DOTS", () => {
  it("has 9 entries", () => {
    expect(DOTS).toHaveLength(9);
  });

  it("each dot has required fields", () => {
    for (const dot of DOTS) {
      expect(dot).toHaveProperty("label");
      expect(dot).toHaveProperty("href");
      expect(dot).toHaveProperty("color");
      expect(dot).toHaveProperty("size");
      expect(dot).toHaveProperty("angle");
      expect(dot).toHaveProperty("desc");
      expect(dot).toHaveProperty("breatheDur");
      expect(dot).toHaveProperty("breatheDelay");
    }
  });

  it("dots are spaced 40° apart", () => {
    for (let i = 0; i < DOTS.length; i++) {
      expect(DOTS[i].angle).toBe(i * 40);
    }
  });
});
