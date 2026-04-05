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
    // DOTS[0] is listens at 0°, color #f97316 = rgb(249, 115, 22)
    expect(lerpDotColor(0)).toEqual([249, 115, 22]);
  });

  it("returns second dot color at its exact angle", () => {
    // DOTS[1] is grinds at 36°, color #f59e0b = rgb(245, 158, 11)
    expect(lerpDotColor(36)).toEqual([245, 158, 11]);
  });

  it("returns interpolated color at midpoint between two dots", () => {
    const [r, g, b] = lerpDotColor(18);
    // Should be a blend — not equal to either endpoint
    expect([r, g, b]).not.toEqual([249, 115, 22]);
    expect([r, g, b]).not.toEqual([245, 158, 11]);
    // Each channel should be between the two endpoints
    expect(r).toBeGreaterThanOrEqual(168);
    expect(r).toBeLessThanOrEqual(255);
  });

  it("wraps correctly between last dot and first dot", () => {
    const [r, g, b] = lerpDotColor(342);
    // 342° is between thinks (324°, #FF1744) and listens (0°, #f97316)
    // Should be valid channel values
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(255);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
  });
});

describe("DOTS", () => {
  it("has 10 entries", () => {
    expect(DOTS).toHaveLength(10);
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

  it("dots are spaced 36° apart", () => {
    for (let i = 0; i < DOTS.length; i++) {
      expect(DOTS[i].angle).toBe(i * 36);
    }
  });
});
