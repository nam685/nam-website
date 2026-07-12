import { describe, expect, it } from "vitest";
import {
  BEAM_MAX_ASPECT,
  DEFAULT_FIELD_PARAMS,
  beamAspect,
  circleRadius,
  polarToXY,
  xyToPolar,
} from "../homeField";

describe("circleRadius", () => {
  it("starts at k1 when i = 0 (r_0 = k1)", () => {
    expect(circleRadius(0, 1, 0.04)).toBe(1);
    expect(circleRadius(0, 2.5, 0.2)).toBe(2.5);
  });

  it("grows super-exponentially in i", () => {
    const r1 = circleRadius(1, 1, 0.04);
    const r2 = circleRadius(2, 1, 0.04);
    const r3 = circleRadius(3, 1, 0.04);
    expect(r1).toBeGreaterThan(1);
    expect(r2 - r1).toBeGreaterThan(r1 - 1); // spacing widens each step
    expect(r3 - r2).toBeGreaterThan(r2 - r1);
  });
});

describe("beamAspect", () => {
  const { rdot, rmax } = DEFAULT_FIELD_PARAMS;

  it("is round (1) at or inside r_dot", () => {
    expect(beamAspect(0.5, rdot, rmax)).toBe(1);
    expect(beamAspect(rdot, rdot, rmax)).toBe(1);
  });

  it("is continuous across r_dot (no jump into the ellipse regime)", () => {
    const justAbove = beamAspect(rdot + 1e-4, rdot, rmax);
    expect(justAbove).toBeGreaterThanOrEqual(1);
    expect(justAbove).toBeLessThan(1.01);
  });

  it("is continuous across r_max (the old divergence is gone)", () => {
    const below = beamAspect(rmax - 1e-4, rdot, rmax);
    const above = beamAspect(rmax + 1e-4, rdot, rmax);
    expect(Math.abs(above - below)).toBeLessThan(1e-2);
  });

  it("increases monotonically and stays capped below E", () => {
    let prev = -Infinity;
    for (let rc = rdot; rc <= 40; rc += 0.25) {
      const a = beamAspect(rc, rdot, rmax);
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(a).toBeLessThan(BEAM_MAX_ASPECT);
      prev = a;
    }
  });
});

describe("polar ↔ cartesian", () => {
  const cx = 200;
  const cy = 150;
  const R = 80;

  it("maps θ = 0 straight up from the centre", () => {
    const [x, y] = polarToXY(1, 0, cx, cy, R);
    expect(x).toBeCloseTo(cx, 6);
    expect(y).toBeCloseTo(cy - R, 6);
  });

  it("round-trips through xyToPolar", () => {
    for (const [r, theta] of [
      [1, 0.3],
      [2.5, -1.2],
      [4, 2.0],
    ] as const) {
      const [x, y] = polarToXY(r, theta, cx, cy, R);
      const back = xyToPolar(x - cx, y - cy, R);
      expect(back.r).toBeCloseTo(r, 6);
      expect(back.theta).toBeCloseTo(theta, 6);
    }
  });
});
