import type { GraphEdgeType, GraphFullEdge, GraphNode, GraphNodeType, GraphPatch } from "./api";

/** Node circle radius in px, scaled by play count and capped.
 * Deliberately small so dense patches stay legible rather than clumping into blobs. */
export function nodeRadius(playCount: number): number {
  // Log scale so heavy-rotation tracks don't dwarf everything; small overall.
  return Math.min(2 + Math.log2(Math.max(playCount, 0) + 1) * 1.4, 10);
}

/** True when zoomed out far enough to use the cheap flat-dot draw path.
 * `threshold` of 0 disables minimal mode (small patch views are always detailed). */
export function shouldMinimal(scale: number, threshold: number): boolean {
  return scale < threshold;
}

/** Node fill by type — orange-anchored palette (song = the page's primary orange). */
export const NODE_COLORS: Record<GraphNodeType, string> = {
  track: "#f97316", // song — primary orange
  artist: "#fbbf24", // amber/gold
  album: "#2dd4bf", // teal (cool complement)
};

export function nodeColor(type: GraphNodeType): string {
  return NODE_COLORS[type] ?? "#f97316";
}

// Every edge is the same neutral gray, drawn at a fixed thin width. Prominence is
// encoded by brightness alone. Only co-listen edges carry a frequency count, so only
// they scale: opacity grows with the log of the co-listen count, from barely visible
// to moderately visible (but always dimmer than the node labels). Edges with no
// co-listen concept (structural, similarity) render at a fixed default prominence.
const EDGE_MIN_ALPHA = 0.05; // barely visible — a one-off co-listen
const EDGE_MAX_ALPHA = 0.4; // moderately visible, still dimmer than the #ccc label text
const EDGE_DEFAULT_ALPHA = 0.15; // edges without a co-listen frequency (structural / similarity)

/** Edge opacity. Co-listen edges scale with log(count); all others use a fixed default. */
export function edgeOpacity(edgeType: GraphEdgeType, weight: number): number {
  if (edgeType !== "colisten") return EDGE_DEFAULT_ALPHA;
  return Math.min(EDGE_MIN_ALPHA + Math.log2(Math.max(weight, 0) + 1) * 0.06, EDGE_MAX_ALPHA);
}

/** Uniform gray for all edges; only the alpha (brightness) varies. */
export function edgeColor(edgeType: GraphEdgeType, weight: number): string {
  return `rgba(200,200,200,${edgeOpacity(edgeType, weight).toFixed(3)})`;
}

export interface ForceNode extends GraphNode {
  id: string;
}

export interface ForceLink {
  source: string;
  target: string;
  edge_type: GraphEdgeType;
  weight: number;
}

/* ── Full-graph diagnostic helpers ─────────────────────── */

/** The giant component is always the page's primary orange. */
const GIANT_COMPONENT_COLOR = "#f97316";

/**
 * Stable, high-contrast color per connected component. Component 0 (the giant
 * component) is always the page orange; every other component id maps to a
 * distinct hue on the HSL wheel via a small integer hash so islands pop and the
 * same id always yields the same color.
 */
export function componentColor(component: number): string {
  if (component === 0) return GIANT_COMPONENT_COLOR;
  // Spread hues around the wheel using the golden-angle so adjacent ids land far
  // apart; the hash keeps it deterministic per id. Avoid orange's ~25° band so
  // islands never masquerade as the giant component.
  const hue = Math.round((component * 137.508 + 60) % 360);
  const sat = 70 + (component % 3) * 8; // 70/78/86 — all vivid
  const light = 55 + (component % 2) * 6; // 55/61 — bright on the dark canvas
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/** Node radius scaled by total degree (log scale, capped). Degree 0 → base size. */
const DEGREE_BASE_RADIUS = 2;
const DEGREE_MAX_RADIUS = 14;
export function degreeRadius(degree: number): number {
  return Math.min(DEGREE_BASE_RADIUS + Math.log2(Math.max(degree, 0) + 1) * 1.6, DEGREE_MAX_RADIUS);
}

/**
 * Filter-group key for a full-graph edge. Structural and tag edges group by
 * their edge_type; affinity edges group by their source_kind
 * (colisten / similar_artist / similar_track / content).
 */
export function edgeFilterKey(edge: Pick<GraphFullEdge, "edge_type" | "source_kind">): string {
  return edge.edge_type === "affinity" ? edge.source_kind : edge.edge_type;
}

/** All edge-filter group keys, in display order. */
export const EDGE_FILTER_KEYS = [
  "structural",
  "tag",
  "colisten",
  "similar_artist",
  "similar_track",
  "content",
] as const;

/** True when an edge's filter group is currently active. */
export function edgeVisible(
  edge: Pick<GraphFullEdge, "edge_type" | "source_kind">,
  activeFilters: Set<string>,
): boolean {
  return activeFilters.has(edgeFilterKey(edge));
}

/** Convert an API patch into react-force-graph's {nodes, links} shape. Drops dangling edges. */
export function toForceData(patch: GraphPatch): { nodes: ForceNode[]; links: ForceLink[] } {
  const keys = new Set(patch.nodes.map((n) => n.key));
  return {
    nodes: patch.nodes.map((n) => ({ ...n, id: n.key })),
    links: patch.edges
      .filter((e) => keys.has(e.source) && keys.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        edge_type: e.edge_type,
        weight: e.weight,
      })),
  };
}
