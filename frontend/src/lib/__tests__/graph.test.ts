import { describe, expect, it } from "vitest";
import { edgeColor, edgeOpacity, nodeColor, nodeRadius, toForceData } from "../graph";
import type { GraphPatch } from "../api";

describe("nodeRadius", () => {
  it("grows with play count and is capped", () => {
    expect(nodeRadius(0)).toBeGreaterThan(0);
    expect(nodeRadius(100)).toBeGreaterThan(nodeRadius(1));
    expect(nodeRadius(1_000_000)).toBeLessThanOrEqual(10);
  });
});

describe("nodeColor", () => {
  it("maps each type to a distinct color, song = orange", () => {
    expect(nodeColor("track")).toBe("#f97316");
    expect(new Set([nodeColor("track"), nodeColor("artist"), nodeColor("album")]).size).toBe(3);
  });
});

describe("edge styling", () => {
  it("uses one neutral gray for every edge, varying only alpha", () => {
    expect(edgeColor(1)).toMatch(/^rgba\(200,200,200,/);
    expect(edgeColor(50)).toMatch(/^rgba\(200,200,200,/);
  });
  it("encodes prominence as brightness that grows with log(weight), clamped", () => {
    // Barely visible at the low end, brighter with more co-listens, never opaque.
    expect(edgeOpacity(1)).toBeGreaterThanOrEqual(0.05);
    expect(edgeOpacity(50)).toBeGreaterThan(edgeOpacity(1));
    expect(edgeOpacity(1_000_000)).toBeLessThanOrEqual(0.4);
    // Log scale: each doubling of weight adds a constant, diminishing-return step.
    expect(edgeOpacity(3) - edgeOpacity(1)).toBeCloseTo(edgeOpacity(7) - edgeOpacity(3), 5);
  });
});

describe("toForceData", () => {
  const patch: GraphPatch = {
    seed: "v1",
    nodes: [
      { key: "v1", node_type: "track", title: "A", subtitle: "", thumbnail_url: "",
        video_id: "v1", play_count: 3, is_liked: false, is_subscribed: false, in_library: false },
      { key: "radiohead", node_type: "artist", title: "Radiohead", subtitle: "", thumbnail_url: "",
        video_id: "", play_count: 3, is_liked: false, is_subscribed: false, in_library: false },
    ],
    edges: [
      { source: "v1", target: "radiohead", edge_type: "structural", weight: 0.5 },
      { source: "v1", target: "ghost", edge_type: "similar_track", weight: 0.9 }, // dangling
    ],
  };
  it("maps keys to ids and drops edges to missing nodes", () => {
    const data = toForceData(patch);
    expect(data.nodes.map((n) => n.id)).toEqual(["v1", "radiohead"]);
    expect(data.links).toHaveLength(1);
    expect(data.links[0].source).toBe("v1");
  });
});
