import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatUptime,
  openingColor,
  resultLabel,
} from "../aoe2";

describe("aoe2 helpers", () => {
  it("formats duration mm:ss", () => {
    expect(formatDuration(1471)).toBe("24:31");
    expect(formatDuration(0)).toBe("00:00");
  });
  it("formats uptime with dash for null", () => {
    expect(formatUptime(null)).toBe("—");
    expect(formatUptime(150)).toBe("2:30");
  });
  it("maps result to label", () => {
    expect(resultLabel("win")).toBe("Victory");
    expect(resultLabel("loss")).toBe("Defeat");
    expect(resultLabel("unknown")).toBe("—");
  });
  it("returns a hex color for openings", () => {
    expect(openingColor("Archers")).toMatch(/^#/);
    expect(openingColor("anything")).toMatch(/^#/);
  });
});
