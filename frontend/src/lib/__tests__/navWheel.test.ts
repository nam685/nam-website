import { describe, expect, it } from "vitest";
import {
  SPRING_THRESHOLD,
  circularD,
  shiftCenter,
  springStep,
  wheelTransform,
} from "../navWheel";

const N = 4; // matches production ITEMS.length

describe("circularD", () => {
  it("returns 0 for same position", () => {
    expect(circularD(0, 0, N)).toBe(0);
    expect(circularD(2, 2, N)).toBe(0);
  });

  it("returns positive distance for forward neighbor", () => {
    expect(circularD(1, 0, N)).toBe(1);
    expect(circularD(2, 1, N)).toBe(1);
  });

  it("wraps: item at far edge takes short arc backward (d = -1, not +3)", () => {
    expect(circularD(3, 0, N)).toBe(-1);
  });

  it("wraps: item at other edge takes short arc forward (d = +1, not -3)", () => {
    expect(circularD(0, 3, N)).toBe(1);
  });

  it("works with float center (spring mid-animation)", () => {
    // visualCenter at 0.5 — item 3 should be -1.5, not +2.5
    expect(circularD(3, 0.5, N)).toBeCloseTo(-1.5);
    // item 2 is equally far either way at exactly N/2
    expect(Math.abs(circularD(2, 0, N))).toBe(2);
  });
});

describe("wheelTransform", () => {
  it("center item has x=0, scale=1, opacity=1", () => {
    const t = wheelTransform(0);
    expect(t.x).toBeCloseTo(0);
    expect(t.scale).toBeCloseTo(1);
    expect(t.opacity).toBeCloseTo(1);
  });

  it("off-center item has reduced opacity", () => {
    const t = wheelTransform(1);
    expect(t.opacity).toBeLessThan(1);
    expect(t.opacity).toBeGreaterThan(0);
  });

  it("scale never drops below 0.05 floor", () => {
    const t = wheelTransform(10); // far off-center
    expect(t.scale).toBeGreaterThanOrEqual(0.05);
  });

  it("opacity never goes negative", () => {
    expect(wheelTransform(10).opacity).toBeGreaterThanOrEqual(0);
  });
});

describe("springStep", () => {
  it("moves toward target", () => {
    const vc = springStep(0, 1, N);
    expect(vc).toBeGreaterThan(0);
    expect(vc).toBeLessThan(1);
  });

  it("takes the short arc when wrapping (0 → 3 goes backward, not forward)", () => {
    // Going from 0 toward 3 should decrease (wrap backward), not go 0→1→2→3
    const vc = springStep(0, 3, N);
    // Short arc: delta = -1 → vc decreases (wraps to ~3.82)
    expect(vc).toBeGreaterThan(3);
    expect(vc).toBeLessThan(4);
  });

  it("stays within [0, N)", () => {
    for (let start = 0; start < N; start++) {
      for (let target = 0; target < N; target++) {
        const vc = springStep(start, target, N);
        expect(vc).toBeGreaterThanOrEqual(0);
        expect(vc).toBeLessThan(N);
      }
    }
  });

  it("converges to target after many steps", () => {
    let vc = 0;
    const target = 2;
    for (let i = 0; i < 200; i++) {
      vc = springStep(vc, target, N);
    }
    expect(Math.abs(vc - target)).toBeLessThan(SPRING_THRESHOLD);
  });

  it("converges via short arc (0 → 3 ends at 3, not stuck at 0)", () => {
    let vc = 0;
    for (let i = 0; i < 200; i++) {
      vc = springStep(vc, 3, N);
    }
    expect(vc).toBeCloseTo(3);
  });
});

describe("shiftCenter", () => {
  it("increments with wrap", () => {
    expect(shiftCenter(3, 1, N)).toBe(0);
    expect(shiftCenter(2, 1, N)).toBe(3);
  });

  it("decrements with wrap", () => {
    expect(shiftCenter(0, -1, N)).toBe(3);
    expect(shiftCenter(1, -1, N)).toBe(0);
  });
});
