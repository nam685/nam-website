import { describe, expect, it } from "vitest";
import { polarToXY } from "../homeField";

describe("polarToXY", () => {
  const cx = 200;
  const cy = 150;
  const R = 80;

  it("maps θ = 0 straight up from the centre", () => {
    const [x, y] = polarToXY(1, 0, cx, cy, R);
    expect(x).toBeCloseTo(cx, 6);
    expect(y).toBeCloseTo(cy - R, 6);
  });

  it("maps θ = 90° (π/2) straight right from the centre", () => {
    const [x, y] = polarToXY(1, Math.PI / 2, cx, cy, R);
    expect(x).toBeCloseTo(cx + R, 6);
    expect(y).toBeCloseTo(cy, 6);
  });

  it("scales linearly with r", () => {
    const [x1, y1] = polarToXY(1, 0.7, cx, cy, R);
    const [x2, y2] = polarToXY(2, 0.7, cx, cy, R);
    expect(x2 - cx).toBeCloseTo(2 * (x1 - cx), 6);
    expect(y2 - cy).toBeCloseTo(2 * (y1 - cy), 6);
  });
});
