"use client";

import { diamondCorners, mapCoordToDiamond, MapGeometry } from "@/lib/aoe2";

/**
 * V1 — the headline building-map minimap (#5 spec). A clean SVG schematic drawn from EXACT BUILD
 * coordinates (game tile units): ME = accent (blue) / OPP = muted red, walls as line segments,
 * forward buildings ringed, base centroids marked, engagement markers from aggressive-command
 * activity. No tileset art — schematic only. Entirely exact → solid strokes, no badge.
 *
 * The minimap shows where things were *built*, not what survived (a razed building still shows).
 */
const SVG_W = 320;
const SVG_H = 160; // AoE2 minimap is a wide diamond (~2:1)
const ME = "var(--accent)";
const OPP = "#e04848";
const FORWARD = "#b478f5";
const ENGAGE = "#f0c440";

export default function Aoe2BuildingMap({
  geometry,
}: {
  geometry: MapGeometry;
}) {
  const me = geometry.me ?? {};
  const opp = geometry.opp ?? {};
  const meBld = me.buildings ?? [];
  const meFwd = me.forward ?? [];
  const meWalls = me.walls ?? [];
  const oppBld = opp.buildings ?? [];
  const oppWalls = opp.walls ?? [];
  const engagements = geometry.engagements ?? [];

  const hasAny =
    meBld.length ||
    meFwd.length ||
    oppBld.length ||
    me.base_centroid ||
    opp.base_centroid;
  if (!hasAny) {
    return (
      <p style={{ color: "#555", fontStyle: "italic", fontSize: "0.75rem" }}>
        No spatial data reconstructed for this match.
      </p>
    );
  }

  // Coords project directly onto the fixed diamond (full map extent) — no auto-fit needed.
  const p = (x: number, y: number) =>
    mapCoordToDiamond(x, y, geometry.map_dim, SVG_W, SVG_H);
  const corners = diamondCorners(SVG_W, SVG_H);

  return (
    <div>
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        style={{
          maxWidth: SVG_W,
          aspectRatio: "2 / 1",
          background: "#0c0f14",
          border: "1px solid #1d232c",
          borderRadius: "4px",
          display: "block",
        }}
        role="img"
        aria-label="strategic building map"
      >
        {/* diamond boundary + N–S / E–W centre lines */}
        <polygon
          points={corners}
          fill="#0a0d12"
          stroke="#222a34"
          strokeWidth={1}
        />
        <g stroke="#161b22" strokeWidth={1}>
          <line x1={SVG_W / 2} y1={0} x2={SVG_W / 2} y2={SVG_H} />
          <line x1={0} y1={SVG_H / 2} x2={SVG_W} y2={SVG_H / 2} />
        </g>

        {/* walls */}
        {meWalls.map((w, i) => {
          const a = p(w.x, w.y);
          const b = p(w.x_end, w.y_end);
          return (
            <line
              key={`mw${i}`}
              x1={a.px}
              y1={a.py}
              x2={b.px}
              y2={b.py}
              stroke={ME}
              strokeWidth={2}
              opacity={0.4}
            />
          );
        })}
        {oppWalls.map((w, i) => {
          const a = p(w.x, w.y);
          const b = p(w.x_end, w.y_end);
          return (
            <line
              key={`ow${i}`}
              x1={a.px}
              y1={a.py}
              x2={b.px}
              y2={b.py}
              stroke={OPP}
              strokeWidth={2}
              opacity={0.4}
            />
          );
        })}

        {/* buildings (small dim squares) */}
        {oppBld.map((b, i) => {
          const q = p(b.x, b.y);
          return (
            <rect
              key={`ob${i}`}
              x={q.px - 2}
              y={q.py - 2}
              width={4}
              height={4}
              fill={OPP}
              opacity={0.55}
            >
              <title>{b.name}</title>
            </rect>
          );
        })}
        {meBld.map((b, i) => {
          const q = p(b.x, b.y);
          return (
            <rect
              key={`mb${i}`}
              x={q.px - 2}
              y={q.py - 2}
              width={4}
              height={4}
              fill={ME}
              opacity={0.7}
            >
              <title>{b.name}</title>
            </rect>
          );
        })}

        {/* forward buildings (ringed glow) */}
        {meFwd.map((b, i) => {
          const q = p(b.x, b.y);
          return (
            <g key={`mf${i}`}>
              <circle
                cx={q.px}
                cy={q.py}
                r={5}
                fill="none"
                stroke={FORWARD}
                strokeWidth={1.5}
              />
              <rect
                x={q.px - 2}
                y={q.py - 2}
                width={4}
                height={4}
                fill={FORWARD}
              >
                <title>forward: {b.name}</title>
              </rect>
            </g>
          );
        })}

        {/* engagements (amber, sized by command volume) */}
        {engagements.map((e, i) => {
          const q = p(e.x, e.y);
          const r = 4 + Math.min(8, e.n_commands ?? 1);
          return (
            <circle
              key={`e${i}`}
              cx={q.px}
              cy={q.py}
              r={r}
              fill={ENGAGE}
              opacity={0.45}
            >
              <title>
                engagement {e.zone ?? ""} ({e.n_commands ?? 0} cmds)
              </title>
            </circle>
          );
        })}

        {/* base centroids */}
        {opp.base_centroid && (
          <circle
            cx={p(opp.base_centroid.x, opp.base_centroid.y).px}
            cy={p(opp.base_centroid.x, opp.base_centroid.y).py}
            r={6}
            fill={OPP}
            stroke="#fff"
            strokeWidth={1}
          >
            <title>OPP base</title>
          </circle>
        )}
        {me.base_centroid && (
          <circle
            cx={p(me.base_centroid.x, me.base_centroid.y).px}
            cy={p(me.base_centroid.x, me.base_centroid.y).py}
            r={6}
            fill={ME}
            stroke="#fff"
            strokeWidth={1}
          >
            <title>MY base</title>
          </circle>
        )}
      </svg>
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginTop: "0.4rem",
          fontSize: "0.55rem",
          color: "#777",
        }}
      >
        <LegendDot color={ME} label="you" />
        <LegendDot color={OPP} label="opponent" />
        <LegendDot color={FORWARD} label="forward bldg" />
        <LegendDot color={ENGAGE} label="engagement" />
      </div>
      <div style={{ fontSize: "0.55rem", color: "#555", marginTop: "0.3rem" }}>
        Shows where things were <em>built</em>, not what survived — replays log
        no deaths.
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}
    >
      <span
        style={{
          width: "0.5rem",
          height: "0.5rem",
          borderRadius: "1px",
          background: color,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
