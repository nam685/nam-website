// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import type { AudiobookManifest } from "../api";
import {
  chapterForChunk,
  loadPosition,
  nextChunkId,
  savePosition,
} from "../audiobookPlayerHelpers";

const MANIFEST: AudiobookManifest = {
  slug: "ddia",
  title: "DDIA",
  author: "K",
  voice: "Charon",
  chapters: [
    { id: "preface", label: "Preface", chunk_start: 0 },
    { id: "ch01", label: "Ch 1", chunk_start: 5 },
    { id: "ch02", label: "Ch 2", chunk_start: 10 },
  ],
  chunks: Array.from({ length: 15 }, (_, i) => ({
    id: i,
    text: `chunk ${i}`,
    duration_s: 30,
    kind: "prose" as const,
  })),
};

describe("nextChunkId", () => {
  it("advances within range", () => {
    expect(nextChunkId(MANIFEST, 0)).toBe(1);
    expect(nextChunkId(MANIFEST, 13)).toBe(14);
  });
  it("returns null at end", () => {
    expect(nextChunkId(MANIFEST, 14)).toBe(null);
  });
});

describe("chapterForChunk", () => {
  it("finds chapter for chunk in middle of chapter range", () => {
    expect(chapterForChunk(MANIFEST, 0)?.id).toBe("preface");
    expect(chapterForChunk(MANIFEST, 4)?.id).toBe("preface");
    expect(chapterForChunk(MANIFEST, 5)?.id).toBe("ch01");
    expect(chapterForChunk(MANIFEST, 9)?.id).toBe("ch01");
    expect(chapterForChunk(MANIFEST, 14)?.id).toBe("ch02");
  });
  it("returns null when chapters list is empty", () => {
    expect(chapterForChunk({ ...MANIFEST, chapters: [] }, 0)).toBe(null);
  });
});

describe("savePosition / loadPosition", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  it("round-trips a position", () => {
    savePosition("ddia", 138, 12.5);
    expect(loadPosition("ddia")).toEqual({ chunkId: 138, offsetS: 12.5 });
  });
  it("returns null when no saved position", () => {
    expect(loadPosition("ddia")).toBe(null);
  });
  it("returns null when stored JSON is corrupt", () => {
    localStorage.setItem("audiobook-position-ddia", "not json");
    expect(loadPosition("ddia")).toBe(null);
  });
});
