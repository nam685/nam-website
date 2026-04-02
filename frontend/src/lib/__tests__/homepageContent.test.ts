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
    const c = lerpDotColor(0);
    expect(c).toBe("rgb(255,23,68)");
  });

  it("returns second dot color at its exact angle", () => {
    const c = lerpDotColor(40);
    expect(c).toBe("rgb(168,85,247)");
  });

  it("returns interpolated color at midpoint between two dots", () => {
    const c = lerpDotColor(20);
    expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    expect(c).not.toBe("rgb(255,23,68)");
    expect(c).not.toBe("rgb(168,85,247)");
  });

  it("wraps correctly between last dot and first dot", () => {
    const c = lerpDotColor(340);
    expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
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
