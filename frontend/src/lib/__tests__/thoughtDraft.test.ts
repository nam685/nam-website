import { describe, expect, it } from "vitest";

import { type Thought } from "../api";
import { withImages } from "../thoughtDraft";

const mk = (id: number, image: string | null): Thought => ({
  id,
  content: "",
  image,
  video: null,
  created_at: "2026-01-01T00:00:00Z",
});

describe("withImages", () => {
  it("keeps only posts that have an image, preserving order", () => {
    const all = [mk(1, "/a.png"), mk(2, null), mk(3, "/c.png")];
    expect(withImages(all).map((t) => t.id)).toEqual([1, 3]);
  });

  it("returns empty when nothing has an image", () => {
    expect(withImages([mk(1, null)])).toEqual([]);
  });
});
