import { describe, expect, it } from "vitest";
import {
  componentColor,
  degreeRadius,
  edgeColor,
  edgeFilterKey,
  edgeOpacity,
  edgeVisible,
  nodeColor,
  nodeRadius,
  shouldMinimal,
  toForceData,
} from "../graph";
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
    expect(edgeColor("colisten", 1)).toMatch(/^rgba\(200,200,200,/);
    expect(edgeColor("structural", 1)).toMatch(/^rgba\(200,200,200,/);
  });
  it("scales co-listen brightness with log(count), clamped", () => {
    // Barely visible at the low end, brighter with more co-listens, never opaque.
    expect(edgeOpacity("colisten", 1)).toBeGreaterThanOrEqual(0.05);
    expect(edgeOpacity("colisten", 50)).toBeGreaterThan(edgeOpacity("colisten", 1));
    expect(edgeOpacity("colisten", 1_000_000)).toBeLessThanOrEqual(0.4);
    // Log scale: each doubling of count adds a constant, diminishing-return step.
    expect(edgeOpacity("colisten", 3) - edgeOpacity("colisten", 1)).toBeCloseTo(
      edgeOpacity("colisten", 7) - edgeOpacity("colisten", 3),
      5,
    );
  });
  it("shows edges with no co-listen concept at a fixed default prominence", () => {
    const def = edgeOpacity("structural", 0.5);
    // Same default regardless of the (non-frequency) weight or which non-co-listen type.
    expect(edgeOpacity("similar_artist", 0.9)).toBe(def);
    expect(edgeOpacity("similar_track", 0.1)).toBe(def);
    // Default sits between barely-visible and the bright cap, not pinned to the floor.
    expect(def).toBeGreaterThan(0.05);
    expect(def).toBeLessThan(0.4);
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

describe("componentColor", () => {
  it("paints the giant component (0) the page orange", () => {
    expect(componentColor(0)).toBe("#f97316");
  });
  it("gives islands distinct colors from the giant and from each other", () => {
    expect(componentColor(1)).not.toBe(componentColor(0));
    expect(componentColor(1)).not.toBe(componentColor(2));
    expect(componentColor(2)).not.toBe(componentColor(3));
  });
  it("is stable for the same component id", () => {
    expect(componentColor(7)).toBe(componentColor(7));
    expect(componentColor(42)).toBe(componentColor(42));
  });
});

describe("degreeRadius", () => {
  it("returns the base size at degree 0", () => {
    expect(degreeRadius(0)).toBe(2);
  });
  it("is monotonic non-decreasing in degree", () => {
    for (let d = 0; d < 200; d++) {
      expect(degreeRadius(d + 1)).toBeGreaterThanOrEqual(degreeRadius(d));
    }
  });
  it("is capped for very high degree", () => {
    expect(degreeRadius(1_000_000)).toBeLessThanOrEqual(14);
    expect(degreeRadius(50)).toBeGreaterThan(degreeRadius(1));
  });
});

describe("edgeFilterKey", () => {
  it("groups structural/tag by edge_type", () => {
    expect(edgeFilterKey({ edge_type: "structural", source_kind: "" })).toBe("structural");
    expect(edgeFilterKey({ edge_type: "tag", source_kind: "" })).toBe("tag");
  });
  it("groups affinity edges by their source_kind", () => {
    expect(edgeFilterKey({ edge_type: "affinity", source_kind: "colisten" })).toBe("colisten");
    expect(edgeFilterKey({ edge_type: "affinity", source_kind: "similar_artist" })).toBe("similar_artist");
    expect(edgeFilterKey({ edge_type: "affinity", source_kind: "similar_track" })).toBe("similar_track");
  });
});

describe("edgeVisible", () => {
  it("shows an edge only when its filter group is active", () => {
    const active = new Set(["structural", "colisten"]);
    expect(edgeVisible({ edge_type: "structural", source_kind: "" }, active)).toBe(true);
    expect(edgeVisible({ edge_type: "affinity", source_kind: "colisten" }, active)).toBe(true);
    expect(edgeVisible({ edge_type: "tag", source_kind: "" }, active)).toBe(false);
    expect(edgeVisible({ edge_type: "affinity", source_kind: "similar_track" }, active)).toBe(false);
  });
  it("hides everything when no filters are active", () => {
    const none = new Set<string>();
    expect(edgeVisible({ edge_type: "structural", source_kind: "" }, none)).toBe(false);
    expect(edgeVisible({ edge_type: "affinity", source_kind: "colisten" }, none)).toBe(false);
  });
});

describe("shouldMinimal", () => {
  it("uses minimal path when zoomed out below the threshold", () => {
    expect(shouldMinimal(0.5, 1.5)).toBe(true);
    expect(shouldMinimal(1.49, 1.5)).toBe(true);
  });
  it("uses the detailed path at or above the threshold", () => {
    expect(shouldMinimal(1.5, 1.5)).toBe(false);
    expect(shouldMinimal(3, 1.5)).toBe(false);
  });
  it("threshold 0 never selects minimal (patch view is always detailed)", () => {
    expect(shouldMinimal(0.01, 0)).toBe(false);
    expect(shouldMinimal(5, 0)).toBe(false);
  });
});
