import { describe, expect, it } from "vitest";
import {
  NAV_DEG,
  NAV_DEG_MOBILE,
  SPRING_THRESHOLD,
  circularD,
  shiftCenter,
  springStep,
  wheelTransform,
} from "../navWheel";

const N = 9; // matches production ITEMS.length

describe("circularD", () => {
  it("returns 0 for same position", () => {
    expect(circularD(0, 0, N)).toBe(0);
    expect(circularD(4, 4, N)).toBe(0);
  });

  it("returns positive distance for forward neighbor", () => {
    expect(circularD(1, 0, N)).toBe(1);
    expect(circularD(3, 2, N)).toBe(1);
  });

  it("wraps: takes short arc backward (d=-1 not +8)", () => {
    expect(circularD(8, 0, N)).toBe(-1);
  });

  it("wraps: takes short arc forward (d=+1 not -8)", () => {
    expect(circularD(0, 8, N)).toBe(1);
  });

  it("handles halfway point", () => {
    // N=9, half = 4.5, so d=4 is forward, d=5 wraps to -4
    expect(circularD(4, 0, N)).toBe(4);
    expect(circularD(5, 0, N)).toBe(-4);
  });

  it("works with float center (spring mid-animation)", () => {
    expect(circularD(8, 0.5, N)).toBeCloseTo(-1.5);
  });
});

describe("wheelTransform", () => {
  const R = 300;

  it("center item has x=0, scale=1, opacity=1", () => {
    const t = wheelTransform(0, R);
    expect(t.x).toBeCloseTo(0);
    expect(t.scale).toBeCloseTo(1);
    expect(t.opacity).toBeCloseTo(1);
  });

  it("d=±1 clearly visible (opacity ≥ 0.4)", () => {
    const t = wheelTransform(1, R);
    expect(t.opacity).toBeGreaterThanOrEqual(0.4);
    expect(t.opacity).toBeLessThan(1);
  });

  it("d=±1 scale is ≥ 0.7 (readable, not tiny)", () => {
    const t = wheelTransform(1, R);
    expect(t.scale).toBeGreaterThanOrEqual(0.7);
  });

  it("d=±2 visible (opacity ≈ 0.5) with DEG=30", () => {
    const t = wheelTransform(2, R);
    expect(t.opacity).toBeCloseTo(0.5, 1);
  });

  it("d=±3 invisible (opacity ≈ 0) with DEG=30", () => {
    const t = wheelTransform(3, R);
    expect(t.opacity).toBeLessThan(0.01);
  });

  it("mobile: d=±1 invisible with DEG=90", () => {
    const t = wheelTransform(1, R, NAV_DEG_MOBILE);
    expect(t.opacity).toBeLessThan(0.01);
  });

  it("items beyond d=3 stay at 0 opacity (not negative)", () => {
    const t = wheelTransform(4, R);
    expect(t.opacity).toBe(0);
  });

  it("scale never drops below 0.05 floor", () => {
    expect(wheelTransform(10, R).scale).toBeGreaterThanOrEqual(0.05);
  });

  it("x scales with radius", () => {
    const small = wheelTransform(1, 100);
    const large = wheelTransform(1, 400);
    expect(large.x).toBeGreaterThan(small.x);
    expect(large.x / small.x).toBeCloseTo(4);
  });
});

describe("springStep", () => {
  it("moves toward target", () => {
    const vc = springStep(0, 1, N);
    expect(vc).toBeGreaterThan(0);
    expect(vc).toBeLessThan(1);
  });

  it("takes the short arc when wrapping (0 → 8 goes backward)", () => {
    const vc = springStep(0, 8, N);
    // Short arc: delta = -1 → vc wraps to ~8.82
    expect(vc).toBeGreaterThan(8);
    expect(vc).toBeLessThan(9);
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
    const target = 5;
    for (let i = 0; i < 300; i++) {
      vc = springStep(vc, target, N);
    }
    expect(Math.abs(vc - target)).toBeLessThan(SPRING_THRESHOLD);
  });

  it("converges via short arc (0 → 8 ends at 8)", () => {
    let vc = 0;
    for (let i = 0; i < 300; i++) {
      vc = springStep(vc, 8, N);
    }
    expect(vc).toBeCloseTo(8);
  });
});

describe("shiftCenter", () => {
  it("increments with wrap", () => {
    expect(shiftCenter(8, 1, N)).toBe(0);
    expect(shiftCenter(4, 1, N)).toBe(5);
  });

  it("decrements with wrap", () => {
    expect(shiftCenter(0, -1, N)).toBe(8);
    expect(shiftCenter(3, -1, N)).toBe(2);
  });
});
