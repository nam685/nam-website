import { describe, expect, it } from "vitest";
import { CONTRIB_ACCENT, getContribColor } from "../contributions";

describe("getContribColor", () => {
  it("returns dark background for 0 contributions", () => {
    expect(getContribColor(0)).toBe("#161b22");
  });

  it("returns 25% accent for 1-2 contributions", () => {
    const c1 = getContribColor(1);
    const c2 = getContribColor(2);
    expect(c1).toContain("25%");
    expect(c2).toContain("25%");
    expect(c1).toBe(c2);
  });

  it("returns 45% accent for 3-5 contributions", () => {
    expect(getContribColor(3)).toContain("45%");
    expect(getContribColor(5)).toContain("45%");
  });

  it("returns 65% accent for 6-10 contributions", () => {
    expect(getContribColor(6)).toContain("65%");
    expect(getContribColor(10)).toContain("65%");
  });

  it("returns full accent for 11+ contributions", () => {
    expect(getContribColor(11)).toBe(CONTRIB_ACCENT);
    expect(getContribColor(100)).toBe(CONTRIB_ACCENT);
  });

  it("boundary: 2 is low tier, 3 is mid tier", () => {
    expect(getContribColor(2)).not.toBe(getContribColor(3));
  });

  it("boundary: 5 is mid tier, 6 is high tier", () => {
    expect(getContribColor(5)).not.toBe(getContribColor(6));
  });

  it("boundary: 10 is high tier, 11 is max tier", () => {
    expect(getContribColor(10)).not.toBe(getContribColor(11));
  });
});
