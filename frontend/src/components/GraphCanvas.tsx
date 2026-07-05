"use client";

import dynamic from "next/dynamic";
import React, { useEffect, useRef, useState } from "react";
import { edgeColor, nodeColor, nodeRadius, shouldMinimal, type ForceLink, type ForceNode } from "@/lib/graph";

// Cast at the import boundary: react-force-graph-2d's callback prop types expect
// its own NodeObject/LinkObject generics, incompatible with our ForceNode/ForceLink.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as React.ComponentType<Record<string, unknown>>;

const ACCENT = "#f97316";
// Zoom level to settle at when centering on a patch seed — tuned so a ~40-node
// patch's labels are legible without framing the whole (possibly sprawling) patch.
const PATCH_SEED_ZOOM = 2.5;

type FgRef = {
  zoomToFit?: (_ms: number, _px: number) => void;
  centerAt?: (_x: number, _y: number, _ms: number) => void;
  zoom?: (_z?: number, _ms?: number) => number;
  d3Force?: (_name: string) => { strength?: (_n: number) => void; distance?: (_n: number) => void } | undefined;
} | null;

export interface GraphCanvasProps {
  data: { nodes: ForceNode[]; links: ForceLink[] };
  seedKey?: string | null;
  hovered: string | null;
  onNodeHover: (_node: ForceNode | null) => void;
  onNodeClick: (_node: ForceNode) => void;
  alwaysLabel?: boolean;
  centerOnSeed?: boolean;
  minimalThreshold?: number;
}

export default function GraphCanvas({
  data,
  seedKey = null,
  hovered,
  onNodeHover,
  onNodeClick,
  alwaysLabel = false,
  centerOnSeed = false,
  minimalThreshold = 1.5,
}: GraphCanvasProps) {
  const fgRef = useRef<FgRef>(null);
  // Auto-fit/recenter only once per data set (on first settle) — not on every
  // engine stop, or dragging a node (which reheats the sim) would yank the view.
  const fittedRef = useRef(false);
  // Track live zoom so linkVisibility can cull edges without reading fgRef each call.
  const zoomRef = useRef(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 1000, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setDims({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // On each new data set: allow one auto-fit, and spread nodes apart so a dense
  // set sprawls to fill the canvas instead of collapsing into a tight ball.
  useEffect(() => {
    fittedRef.current = false;
    fgRef.current?.d3Force?.("charge")?.strength?.(-320);
    fgRef.current?.d3Force?.("link")?.distance?.(70);
  }, [data]);

  return (
    <div
      ref={containerRef}
      style={{
        // Full-bleed: break out of the centered max-width layout to span page width.
        width: "100vw",
        marginLeft: "calc(50% - 50vw)",
        height: "calc(100vh - 200px)",
        minHeight: 480,
        borderTop: "1px solid rgba(255,255,255,0.06)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        overflow: "hidden",
        background: "radial-gradient(circle at 50% 42%, rgba(249,115,22,0.07) 0%, #0a0a0a 68%)",
      }}
    >
      <ForceGraph2D
        ref={fgRef as never}
        width={dims.width}
        height={dims.height}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={1}
        cooldownTicks={120}
        onZoom={(t: { k: number }) => {
          zoomRef.current = t.k;
        }}
        onEngineStop={() => {
          if (fittedRef.current) return;
          fittedRef.current = true;
          if (centerOnSeed && seedKey) {
            const seed = data.nodes.find((n) => n.key === seedKey) as
              | (ForceNode & { x?: number; y?: number })
              | undefined;
            if (seed && seed.x != null && seed.y != null) {
              fgRef.current?.centerAt?.(seed.x, seed.y, 400);
              fgRef.current?.zoom?.(PATCH_SEED_ZOOM, 400);
              return;
            }
          }
          fgRef.current?.zoomToFit?.(400, 80);
        }}
        linkColor={(l: ForceLink) => edgeColor(l.edge_type, l.weight)}
        linkWidth={0.5}
        // Cull edges when zoomed out into minimal mode — ~thousands of line draws
        // are the other big cost alongside per-node shadowBlur.
        linkVisibility={() => !shouldMinimal(zoomRef.current, minimalThreshold)}
        onNodeClick={(node: ForceNode) => onNodeClick(node)}
        onNodeHover={(node: ForceNode | null) => onNodeHover(node)}
        nodePointerAreaPaint={(
          node: ForceNode & { x: number; y: number },
          color: string,
          ctx: CanvasRenderingContext2D,
          scale: number,
        ) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x, node.y, (nodeRadius(node.play_count) + 2) / scale, 0, 2 * Math.PI);
          ctx.fill();
        }}
        nodeCanvasObject={(node: ForceNode & { x: number; y: number }, ctx: CanvasRenderingContext2D, scale: number) => {
          const fill = nodeColor(node.node_type);
          // MINIMAL PATH: zoomed out — one flat filled dot, no save/restore, no
          // shadowBlur, no rings, no labels. shadowBlur run per-node/frame is the
          // dominant cost; dropping it is the whole point.
          if (shouldMinimal(scale, minimalThreshold)) {
            const r = nodeRadius(node.play_count) / scale;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = fill;
            ctx.fill();
            return;
          }
          // DETAILED PATH: the existing rich rendering (glow + rings + labels).
          const isSeed = seedKey === node.key;
          const isHovered = hovered === node.key;
          const r = (nodeRadius(node.play_count) * (isHovered ? 1.6 : 1)) / scale;
          ctx.save();
          ctx.shadowColor = fill;
          ctx.shadowBlur = r * (isSeed || isHovered ? 2.4 : 1.5);
          ctx.globalAlpha = isHovered ? 1 : 0.92;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.restore();
          if (isSeed) {
            ctx.strokeStyle = "rgba(255,255,255,0.9)";
            ctx.lineWidth = 1.5 / scale;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 3 / scale, 0, 2 * Math.PI);
            ctx.stroke();
          }
          if (node.is_liked) {
            ctx.strokeStyle = "#ffd400";
            ctx.lineWidth = 2 / scale;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 2 / scale, 0, 2 * Math.PI);
            ctx.stroke();
          }
          if (node.is_subscribed) {
            ctx.strokeStyle = ACCENT;
            ctx.setLineDash([2, 2]);
            ctx.lineWidth = 1.5 / scale;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 4 / scale, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          if (alwaysLabel || isSeed || isHovered || scale > 1.6) {
            const label = node.title.length > 18 ? node.title.slice(0, 17) + "…" : node.title;
            ctx.font = `${10 / scale}px monospace`;
            ctx.fillStyle = "#ccc";
            ctx.textAlign = "center";
            ctx.fillText(label, node.x, node.y + r + 9 / scale);
          }
        }}
      />
    </div>
  );
}
