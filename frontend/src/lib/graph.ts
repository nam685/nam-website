import type { GraphEdgeType, GraphNode, GraphPatch } from "./api";

/** Node circle radius in px, scaled by play count and capped. */
export function nodeRadius(playCount: number): number {
  return Math.min(6 + Math.sqrt(Math.max(playCount, 0)) * 2, 26);
}

/** Accent for similarity edges, faint white for structural/co-listen. */
export function edgeColor(edgeType: GraphEdgeType): string {
  return edgeType === "similar_artist" || edgeType === "similar_track"
    ? "rgba(249,115,22,0.45)"
    : "rgba(255,255,255,0.12)";
}

/** Structural and co-listen edges render dashed; similarity edges solid. */
export function edgeDashed(edgeType: GraphEdgeType): boolean {
  return edgeType === "structural" || edgeType === "colisten";
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
