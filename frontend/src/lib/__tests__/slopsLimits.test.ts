import { describe, it, expect } from "vitest";
import {
  MAX_FILES_PER_TURN,
  MAX_SINGLE_FILE,
  MAX_TOTAL_UPLOAD,
  formatSize,
} from "../slopsLimits";

describe("slopsLimits constants", () => {
  it("mirrors backend values", () => {
    expect(MAX_FILES_PER_TURN).toBe(5);
    expect(MAX_SINGLE_FILE).toBe(5 * 1024 * 1024);
    expect(MAX_TOTAL_UPLOAD).toBe(10 * 1024 * 1024);
  });
});

describe("formatSize", () => {
  it("formats bytes", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
  });
  it("formats kilobytes with one decimal", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
  });
  it("formats megabytes with one decimal", () => {
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatSize(10 * 1024 * 1024)).toBe("10.0 MB");
  });
});
