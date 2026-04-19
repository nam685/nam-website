import { describe, it, expect } from "vitest";
import {
  MAX_FILES_PER_TURN,
  MAX_SINGLE_FILE,
  MAX_TOTAL_UPLOAD,
  TEXT_EXTENSIONS,
  ALLOWED_EXTENSIONS,
  formatSize,
  validateFiles,
} from "../slopsLimits";

describe("slopsLimits constants", () => {
  it("mirrors backend numbers", () => {
    expect(MAX_FILES_PER_TURN).toBe(5);
    expect(MAX_SINGLE_FILE).toBe(5 * 1024 * 1024);
    expect(MAX_TOTAL_UPLOAD).toBe(10 * 1024 * 1024);
  });

  it("text extensions subset of allowed", () => {
    for (const ext of TEXT_EXTENSIONS) {
      expect(ALLOWED_EXTENSIONS.has(ext)).toBe(true);
    }
  });
});

describe("formatSize", () => {
  it("formats bytes/KB/MB", () => {
    expect(formatSize(500)).toBe("500 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("validateFiles", () => {
  const mk = (name: string, size: number): File =>
    new File([new Uint8Array(size)], name);

  it("accepts valid batch", () => {
    const res = validateFiles([mk("a.txt", 100), mk("b.pdf", 200)]);
    expect(res.ok).toBe(true);
  });

  it("rejects too many files", () => {
    const files = Array.from({ length: 6 }, (_, i) => mk(`f${i}.txt`, 1));
    const res = validateFiles(files);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/too many/i);
  });

  it("rejects oversize single", () => {
    const res = validateFiles([mk("big.txt", MAX_SINGLE_FILE + 1)]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/too large/i);
  });

  it("rejects oversize total", () => {
    // Each file is under MAX_SINGLE_FILE, but three together exceed MAX_TOTAL_UPLOAD.
    const each = Math.floor(MAX_TOTAL_UPLOAD / 3) + 1;
    const res = validateFiles([
      mk("a.txt", each),
      mk("b.txt", each),
      mk("c.txt", each),
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/total/i);
  });

  it("rejects disallowed extension", () => {
    const res = validateFiles([mk("evil.exe", 100)]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/\.exe/);
  });

  it("rejects dotfile", () => {
    const res = validateFiles([mk(".env", 100)]);
    expect(res.ok).toBe(false);
  });
});
