import { describe, expect, it } from "vitest";
import {
  analysisProgress,
  formatBytes,
  formatMeasure,
  localIsoDate,
  parseTrackedUploads,
  statusLabel,
  visibleRows,
} from "../badminton";

describe("formatMeasure", () => {
  it("shows small lengths in cm and larger in m", () => {
    expect(formatMeasure(0.35, "m")).toBe("35 cm");
    expect(formatMeasure(-0.04, "m")).toBe("-4 cm");
    expect(formatMeasure(1.234, "m")).toBe("1.23 m");
  });
  it("formats the other units", () => {
    expect(formatMeasure(166.4, "deg")).toBe("166°");
    expect(formatMeasure(12.345, "m/s")).toBe("12.3 m/s");
    expect(formatMeasure(0.123, "s")).toBe("0.12 s");
    expect(formatMeasure(87.6, "ms")).toBe("88 ms");
    expect(formatMeasure(0.456, "ratio")).toBe("0.46");
    expect(formatMeasure(1.5, "torso")).toBe("1.50 torso");
    expect(formatMeasure(3, "furlong")).toBe("3 furlong");
  });
  it("hides missing values", () => {
    expect(formatMeasure(null, "m")).toBe("");
    expect(formatMeasure(Number.NaN, "m")).toBe("");
  });
});

describe("analysisProgress", () => {
  it("is monotonic through the pipeline", () => {
    const seq: [string, string | null][] = [
      ["downloading", null],
      ["sending", null],
      ["analyzing", "split_0"],
      ["analyzing", "measure_body"],
      ["analyzing", "measure_racket"],
      ["analyzing", "body3d"],
      ["analyzing", "metrics"],
      ["judging", null],
      ["rendering", null],
      ["uploading", null],
    ];
    const values = seq.map(([s, st]) => analysisProgress(s, st));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
    expect(values[values.length - 1]).toBeLessThanOrEqual(1);
  });
  it("is 0 for unknown steps", () => {
    expect(analysisProgress(null, null)).toBe(0);
    expect(analysisProgress("mystery", "x")).toBe(0);
  });
});

describe("misc", () => {
  it("formatBytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(5 * 1024 ** 2)).toBe("5 MB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });
  it("statusLabel", () => {
    expect(statusLabel("pending")).toMatch(/approve/);
    expect(statusLabel("approved", 3)).toBe("queued (#3)");
  });
  it("visibleRows drops empty values", () => {
    expect(
      visibleRows([
        { label: "a", value: 1, unit: "m" },
        { label: "b", value: null, unit: "m" },
      ]).map((r) => r.label),
    ).toEqual(["a"]);
    expect(visibleRows(undefined)).toEqual([]);
  });
  it("localIsoDate pads", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 10).getTime())).toBe("2026-01-05");
  });
  it("parseTrackedUploads tolerates junk", () => {
    expect(parseTrackedUploads(null)).toEqual([]);
    expect(parseTrackedUploads("{")).toEqual([]);
    expect(parseTrackedUploads('{"a":1}')).toEqual([]);
    expect(
      parseTrackedUploads(
        '[{"id":1,"name":"Nam","recorded_on":"2026-09-17"},{"id":"x"}]',
      ),
    ).toEqual([{ id: 1, name: "Nam", recorded_on: "2026-09-17" }]);
  });
});
