import { describe, expect, it } from "vitest";
import { edgeColor, edgeDashed, nodeColor, nodeRadius, toForceData } from "../graph";
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
  it("colors similarity edges accent, co-listen prominent white, structural faint", () => {
    expect(edgeColor("similar_artist")).toContain("249,115,22");
    expect(edgeColor("structural")).toBe("rgba(255,255,255,0.12)");
    // co-listen is the same hue as structural but far more opaque, so it reads as prominent.
    expect(edgeColor("colisten")).toBe("rgba(255,255,255,0.55)");
  });
  it("dashes only structural edges; co-listen and similarity are solid", () => {
    expect(edgeDashed("structural")).toBe(true);
    expect(edgeDashed("colisten")).toBe(false);
    expect(edgeDashed("similar_track")).toBe(false);
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
