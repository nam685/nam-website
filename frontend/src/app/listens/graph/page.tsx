"use client";

import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API, type GraphFull, type GraphFullNode } from "@/lib/api";
import { getAdminToken } from "@/lib/auth";
import { componentColor, degreeRadius, edgeVisible, EDGE_FILTER_KEYS, shouldMinimal } from "@/lib/graph";

// Cast to a permissive type at the import boundary — react-force-graph-2d's prop
// callback types expect its own NodeObject/LinkObject generics, incompatible with
// our strongly-typed shapes. Casting here avoids `as any` on every prop.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as React.ComponentType<Record<string, unknown>>;

const ACCENT = "#f97316";

// Below this zoom, draw flat dots and hide edges — dropping per-node shadowBlur and
// ~thousands of edge line-draws is what keeps the overview smooth. Above it, the full
// diagnostic rendering (glow, focus ring, labels) kicks back in.
const MINIMAL_ZOOM = 1.5;

type FullForceNode = GraphFullNode & { x?: number; y?: number };

const FILTER_LABELS: Record<string, string> = {
  structural: "STRUCTURAL",
  tag: "TAG",
  colisten: "CO-LISTEN",
  similar_artist: "SIM ARTIST",
  similar_track: "SIM TRACK",
  content: "CONTENT",
};

// Which summary count feeds each filter row (structural/tag from edge_type_counts,
// affinity source_kinds from source_kind_counts).
const AFFINITY_KEYS = new Set(["colisten", "similar_artist", "similar_track", "content"]);

export default function ListensGraphDiagnosticPage() {
  const [full, setFull] = useState<GraphFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(() => new Set(EDGE_FILTER_KEYS));

  const fgRef = useRef<{
    zoomToFit?: (ms: number, px: number) => void;
    centerAt?: (x?: number, y?: number, ms?: number) => void;
    zoom?: (k: number, ms?: number) => void;
    d3Force?: (name: string) => { strength?: (n: number) => void; distance?: (n: number) => void } | undefined;
  } | null>(null);
  const fittedRef = useRef(false);
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

  // Fetch the full graph once, admin-gated.
  useEffect(() => {
    const token = getAdminToken(); // redirects to /sudo if absent
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/api/listens/graph/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) {
          if (typeof window !== "undefined") window.location.href = "/sudo?from=/listens/graph";
          return;
        }
        if (!res.ok) throw new Error(`graph fetch failed: ${res.status}`);
        const data: GraphFull = await res.json();
        if (!cancelled) setFull(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load graph.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep node objects stable across filter toggles so positions persist (react-force-graph
  // mutates x/y onto these objects). Only the link set is recomputed on filter change.
  const nodes = useMemo<FullForceNode[]>(() => (full ? full.nodes.map((n) => ({ ...n })) : []), [full]);

  const links = useMemo(
    () =>
      full
        ? full.edges
            .filter((e) => edgeVisible(e, activeFilters))
            .map((e) => ({ source: e.source, target: e.target, edge_type: e.edge_type, source_kind: e.source_kind, weight: e.weight }))
        : [],
    [full, activeFilters],
  );

  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  const nodeById = useMemo(() => {
    const m = new Map<string, FullForceNode>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  // Spread the (large) full graph so components separate visibly instead of collapsing.
  useEffect(() => {
    fittedRef.current = false;
    if (!full) return;
    fgRef.current?.d3Force?.("charge")?.strength?.(-160);
    fgRef.current?.d3Force?.("link")?.distance?.(40);
  }, [full]);

  const toggleFilter = useCallback((key: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const focusNode = useCallback(
    (id: string) => {
      const n = nodeById.get(id);
      if (!n) return;
      setFocusId(id);
      if (typeof n.x === "number" && typeof n.y === "number") {
        fgRef.current?.centerAt?.(n.x, n.y, 600);
        fgRef.current?.zoom?.(4, 600);
      }
    },
    [nodeById],
  );

  const summary = full?.summary ?? null;

  return (
    <div style={{ position: "relative" }}>
      <div style={{ padding: "12px 4px 8px" }}>
        <h1 style={{ color: ACCENT, fontSize: 15, fontFamily: "monospace", letterSpacing: 2, margin: 0 }}>
          MUSIC GRAPH — DIAGNOSTIC
        </h1>
        <p style={{ color: "#666", fontSize: 11, fontFamily: "monospace", margin: "4px 0 0", lineHeight: 1.5 }}>
          Full graph. Color = connected component (orange = giant; islands = fragmentation). Size = degree.
        </p>
      </div>

      {loading && (
        <div style={{ color: "#888", fontFamily: "monospace", fontSize: 12, padding: "40px 4px" }}>Loading graph…</div>
      )}
      {error && (
        <div style={{ color: "#f87171", fontFamily: "monospace", fontSize: 12, padding: "40px 4px" }}>{error}</div>
      )}

      {full && (
        <div
          ref={containerRef}
          style={{
            position: "relative",
            width: "100vw",
            marginLeft: "calc(50% - 50vw)",
            height: "calc(100vh - 160px)",
            minHeight: 520,
            borderTop: "1px solid rgba(255,255,255,0.06)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            overflow: "hidden",
            background: "radial-gradient(circle at 50% 42%, rgba(249,115,22,0.06) 0%, #0a0a0a 68%)",
          }}
        >
          <ForceGraph2D
            ref={fgRef as never}
            width={dims.width}
            height={dims.height}
            graphData={graphData}
            backgroundColor="rgba(0,0,0,0)"
            nodeRelSize={1}
            cooldownTicks={140}
            warmupTicks={20}
            onEngineStop={() => {
              if (!fittedRef.current) {
                fgRef.current?.zoomToFit?.(400, 60);
                fittedRef.current = true;
              }
            }}
            onZoom={(t: { k: number }) => {
              zoomRef.current = t.k;
            }}
            linkColor={() => "rgba(200,200,200,0.14)"}
            linkWidth={0.4}
            linkVisibility={() => !shouldMinimal(zoomRef.current, MINIMAL_ZOOM)}
            onNodeHover={(node: FullForceNode | null) => setHovered(node ? node.id : null)}
            onNodeClick={(node: FullForceNode) => focusNode(node.id)}
            nodePointerAreaPaint={(
              node: FullForceNode & { x: number; y: number },
              color: string,
              ctx: CanvasRenderingContext2D,
              scale: number,
            ) => {
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(node.x, node.y, (degreeRadius(node.degree) + 2) / scale, 0, 2 * Math.PI);
              ctx.fill();
            }}
            nodeCanvasObject={(
              node: FullForceNode & { x: number; y: number },
              ctx: CanvasRenderingContext2D,
              scale: number,
            ) => {
              // Zoomed out: one flat filled dot per node — no save/restore, no shadowBlur,
              // no focus ring, no label. shadowBlur per node/frame is the dominant cost.
              if (shouldMinimal(scale, MINIMAL_ZOOM)) {
                const r = degreeRadius(node.degree) / scale;
                ctx.beginPath();
                ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
                ctx.fillStyle = componentColor(node.component);
                ctx.fill();
                return;
              }

              const isHovered = hovered === node.id;
              const isFocus = focusId === node.id;
              const r = (degreeRadius(node.degree) * (isHovered || isFocus ? 1.5 : 1)) / scale;
              const fill = componentColor(node.component);
              ctx.save();
              ctx.shadowColor = fill;
              ctx.shadowBlur = r * (isHovered || isFocus ? 2.4 : 1.4);
              ctx.globalAlpha = isHovered || isFocus ? 1 : 0.9;
              ctx.beginPath();
              ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
              ctx.fillStyle = fill;
              ctx.fill();
              ctx.restore();
              if (isFocus) {
                ctx.strokeStyle = "rgba(255,255,255,0.95)";
                ctx.lineWidth = 1.6 / scale;
                ctx.beginPath();
                ctx.arc(node.x, node.y, r + 4 / scale, 0, 2 * Math.PI);
                ctx.stroke();
              }
              if (isHovered || isFocus || scale > 2) {
                const label = node.title.length > 22 ? node.title.slice(0, 21) + "…" : node.title;
                ctx.font = `${10 / scale}px monospace`;
                ctx.fillStyle = "#ddd";
                ctx.textAlign = "center";
                ctx.fillText(label, node.x, node.y + r + 9 / scale);
              }
            }}
          />

          <DiagnosticPanel
            summary={summary}
            activeFilters={activeFilters}
            onToggleFilter={toggleFilter}
            onFocus={focusNode}
            focusId={focusId}
          />
        </div>
      )}
    </div>
  );
}

/* ── Side panel ────────────────────────────────────────── */

function DiagnosticPanel({
  summary,
  activeFilters,
  onToggleFilter,
  onFocus,
  focusId,
}: {
  summary: GraphFull["summary"] | null;
  activeFilters: Set<string>;
  onToggleFilter: (key: string) => void;
  onFocus: (id: string) => void;
  focusId: string | null;
}) {
  if (!summary) return null;

  const histEntries = Object.entries(summary.degree.histogram)
    .map(([deg, count]) => ({ deg: Number(deg), count }))
    .sort((a, b) => a.deg - b.deg);
  const histMax = histEntries.reduce((m, e) => Math.max(m, e.count), 1);

  const filterCount = (key: string): number =>
    (AFFINITY_KEYS.has(key) ? summary.source_kind_counts[key] : summary.edge_type_counts[key]) ?? 0;

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        width: 316,
        maxHeight: "calc(100% - 24px)",
        overflowY: "auto",
        background: "rgba(12,12,12,0.92)",
        border: "1px solid rgba(249,115,22,0.25)",
        borderRadius: 8,
        padding: 14,
        fontFamily: "monospace",
        color: "#ccc",
        fontSize: 11,
        backdropFilter: "blur(4px)",
      }}
    >
      {/* Headline counts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        <Stat label="NODES" value={summary.node_count.toLocaleString()} />
        <Stat label="EDGES" value={summary.edge_count.toLocaleString()} />
        <Stat label="COMPONENTS" value={summary.component_count.toLocaleString()} warn={summary.component_count > 1} />
        <Stat label="GIANT" value={summary.giant_size.toLocaleString()} />
      </div>

      {/* Degree histogram */}
      <Section title="DEGREE DISTRIBUTION">
        <div style={{ color: "#666", fontSize: 9, marginBottom: 6 }}>
          min {summary.degree.min} · med {summary.degree.median} · mean {summary.degree.mean.toFixed(1)} · max{" "}
          {summary.degree.max}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 44 }}>
          {histEntries.map((e) => (
            <div
              key={e.deg}
              title={`degree ${e.deg}: ${e.count}`}
              style={{
                flex: 1,
                minWidth: 2,
                height: `${Math.max(2, (e.count / histMax) * 44)}px`,
                background: ACCENT,
                opacity: 0.75,
              }}
            />
          ))}
        </div>
      </Section>

      {/* Edge-type filters */}
      <Section title="EDGE FILTERS">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {EDGE_FILTER_KEYS.map((key) => {
            const on = activeFilters.has(key);
            return (
              <button
                key={key}
                onClick={() => onToggleFilter(key)}
                style={{
                  background: on ? "rgba(249,115,22,0.18)" : "transparent",
                  border: `1px solid ${on ? ACCENT : "rgba(255,255,255,0.15)"}`,
                  color: on ? ACCENT : "#777",
                  borderRadius: 5,
                  padding: "4px 8px",
                  fontSize: 9,
                  fontFamily: "monospace",
                  letterSpacing: 0.5,
                  cursor: "pointer",
                }}
              >
                {FILTER_LABELS[key]} · {filterCount(key).toLocaleString()}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Top hubs */}
      <Section title={`TOP HUBS (${summary.top_hubs.length})`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {summary.top_hubs.map((h) => (
            <EntryRow
              key={h.id}
              active={focusId === h.id}
              onClick={() => onFocus(h.id)}
              type={h.node_type}
              title={h.title}
              meta={`deg ${h.degree}`}
            />
          ))}
        </div>
      </Section>

      {/* Islands */}
      <Section title={`ISLANDS (${summary.islands.length})`}>
        {summary.islands.length === 0 ? (
          <div style={{ color: "#4ade80", fontSize: 10 }}>None — no small disconnected clusters.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {summary.islands.map((isl) => (
              <div
                key={isl.component}
                style={{ borderLeft: `2px solid ${componentColor(isl.component)}`, paddingLeft: 8 }}
              >
                <div style={{ color: "#888", fontSize: 9, marginBottom: 2 }}>
                  component {isl.component} · {isl.size} node{isl.size === 1 ? "" : "s"}
                </div>
                {isl.nodes.map((n) => (
                  <EntryRow
                    key={n.id}
                    active={focusId === n.id}
                    onClick={() => onFocus(n.id)}
                    type={n.node_type}
                    title={n.title}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Structural weak points */}
      <Section title="STRUCTURE">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <KV label="articulation points" value={summary.articulation_points.length} />
          <KV label="bridges" value={summary.bridges.length} />
          <KV label="tagless artists" value={summary.tagless_artists} warn={summary.tagless_artists > 0} />
        </div>
        {summary.articulation_points.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
            {summary.articulation_points.slice(0, 12).map((a) => (
              <EntryRow
                key={a.id}
                active={focusId === a.id}
                onClick={() => onFocus(a.id)}
                type={a.node_type}
                title={a.title}
              />
            ))}
            {summary.articulation_points.length > 12 && (
              <div style={{ color: "#555", fontSize: 9 }}>+{summary.articulation_points.length - 12} more…</div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 5, padding: "6px 8px" }}>
      <div style={{ color: warn ? "#f87171" : ACCENT, fontSize: 15 }}>{value}</div>
      <div style={{ color: "#666", fontSize: 8, letterSpacing: 1 }}>{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ color: "#888", fontSize: 9, letterSpacing: 1.5, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function KV({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "#777", fontSize: 10 }}>{label}</span>
      <span style={{ color: warn ? "#f87171" : "#ccc", fontSize: 10 }}>{value}</span>
    </div>
  );
}

function EntryRow({
  type,
  title,
  meta,
  active,
  onClick,
}: {
  type: string;
  title: string;
  meta?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(249,115,22,0.12)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = active ? "rgba(249,115,22,0.12)" : "transparent")}
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 6,
        padding: "2px 4px",
        borderRadius: 4,
        cursor: "pointer",
        background: active ? "rgba(249,115,22,0.12)" : "transparent",
      }}
    >
      <span style={{ color: ACCENT, fontSize: 8, minWidth: 42 }}>{type.toUpperCase()}</span>
      <span style={{ color: "#ccc", fontSize: 10, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </span>
      {meta && <span style={{ color: "#666", fontSize: 9 }}>{meta}</span>}
    </div>
  );
}
