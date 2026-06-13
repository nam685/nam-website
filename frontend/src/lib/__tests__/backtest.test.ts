import { describe, expect, it } from "vitest";

import { fmtMoney, fmtPct } from "../backtest";

describe("backtest helpers", () => {
  it("formats percentages with sign", () => {
    expect(fmtPct(12.345)).toBe("+12.35%");
    expect(fmtPct(-3.2)).toBe("-3.20%");
    expect(fmtPct(null)).toBe("—");
  });

  it("formats money", () => {
    expect(fmtMoney(1234.5)).toBe("$1,234.50");
  });
});
