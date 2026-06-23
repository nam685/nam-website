"use client";

import {
  buildWorkerAllocChart,
  ECON_RESOURCE_COLOR,
  niceTicks,
  WorkerAllocation,
} from "@/lib/aoe2";
import { aoe2ResourceIconUrl } from "@/lib/aoe2Icons";

/**
 * Worker-allocation graph — villager COUNTS per resource over the course of the game, styled like
 * the Army production graph (full width, ~half height, icon legend on the right).
 *
 *   • X-axis = VILLAGER COUNT (integer, start → max reached). Sparse labels avoid overlap.
 *   • Stacked BAR per villager count: food / wood / gold / stone, bottom-up.
 *   • Y-axis is LOG-scaled: each stack segment spans logFrac(cumLower)→logFrac(cumUpper), so a late
 *     sliver of stone stays visible against the large food/wood mass.
 *   • ACTIVE FARMS (reseed-excluded) are drawn as a line riding the food count — farms drive the food
 *     allocation, so the line traces the top of the food band instead of a contradictory dim
 *     "N farms seeded" total.
 *
 * Pure SVG, same-origin icons — CSP-safe.
 */
export default function Aoe2WorkerAllocChart({
  workerAllocation,
}: {
  workerAllocation: WorkerAllocation | null | undefined;
}) {
  const chart = buildWorkerAllocChart(workerAllocation);
  if (!chart) return null;
  const { points, resources, xMin, xMax, maxStackTotal } = chart;

  const W = 1100;
  const PAD = { top: 16, right: 16, bottom: 0, left: 36 };
  const AREA_H = 240; // tall — the two economy graphs each take ~half the pane and fill its height
  const X_BAND = 16; // villager-count tick labels, own band below the axis
  const H = PAD.top + AREA_H + X_BAND + 10;
  const plotW = W - PAD.left - PAD.right;
  const span = Math.max(1, xMax - xMin);
  const xOf = (vils: number) => PAD.left + ((vils - xMin) / span) * plotW;
  const axisY = PAD.top + AREA_H;
  // value → y on a LINEAR axis (honest proportions: the food/wood/gold split isn't distorted).
  const yOf = (v: number) => axisY - (v / maxStackTotal) * AREA_H;

  const step = plotW / (span + 1);
  const barW = Math.max(1.2, step * 0.82);

  // Sparse x ticks — ~10 evenly spaced integer villager counts.
  const tickCount = Math.min(10, span);
  const xTicks = Array.from({ length: tickCount + 1 }, (_, i) =>
    Math.round(xMin + (span / tickCount) * i),
  );
  // Linear y gridlines at clean intervals.
  const yGrid = niceTicks(maxStackTotal, 5);

  // Active-farms line points (count on the same scale as the stack → rides the food band top).
  const farmLine = points
    .filter((p) => (p.active_farms ?? 0) > 0)
    .map((p) => `${xOf(p.x)},${yOf(p.active_farms ?? 0)}`)
    .join(" ");

  return (
    <div>
      <div style={labelStyle}>
        Worker allocation — villager counts per resource (x = villagers)
      </div>
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "flex-start",
          marginTop: "0.4rem",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            style={{ display: "block", width: "100%" }}
            role="img"
            aria-label="Worker allocation: stacked bars of villager counts per resource over villager count, log y-axis, with an active-farms line."
          >
            {/* Log y gridlines + labels */}
            {yGrid.map((v) => (
              <g key={`y-${v}`}>
                <line
                  x1={PAD.left}
                  y1={yOf(v)}
                  x2={W - PAD.right}
                  y2={yOf(v)}
                  stroke="#1d1d1d"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 6}
                  y={yOf(v) + 3}
                  textAnchor="end"
                  style={tickText}
                >
                  {v}
                </text>
              </g>
            ))}

            {/* Stacked bars (food bottom-up) */}
            {points.map((p) => {
              let cum = 0;
              return (
                <g key={p.x}>
                  {resources.map((r) => {
                    const v = p.values[r] ?? 0;
                    if (v <= 0) return null;
                    const lower = cum;
                    cum += v;
                    const yU = yOf(cum);
                    const yL = yOf(lower);
                    return (
                      <rect
                        key={r}
                        x={xOf(p.x) - barW / 2}
                        y={yU}
                        width={barW}
                        height={Math.max(0.4, yL - yU)}
                        fill={ECON_RESOURCE_COLOR[r]}
                        fillOpacity={0.85}
                      >
                        <title>
                          {p.x} vils · {r}: {Math.round(v)} (t={p.t_s}s)
                        </title>
                      </rect>
                    );
                  })}
                </g>
              );
            })}

            {/* Zero line (x-axis) */}
            <line
              x1={PAD.left}
              y1={axisY}
              x2={W - PAD.right}
              y2={axisY}
              stroke="#3a3a3a"
              strokeWidth={1}
            />

            {/* Active-farms line (rides the food band) */}
            {farmLine && (
              <polyline
                points={farmLine}
                fill="none"
                stroke="#fff"
                strokeWidth={1.4}
                strokeDasharray="4 3"
                opacity={0.8}
              />
            )}

            {/* Sparse villager-count tick labels (own band below axis) */}
            {xTicks.map((vils) => (
              <g key={`x-${vils}`}>
                <line
                  x1={xOf(vils)}
                  y1={axisY}
                  x2={xOf(vils)}
                  y2={axisY + 4}
                  stroke="#3a3a3a"
                  strokeWidth={1}
                />
                <text
                  x={xOf(vils)}
                  y={axisY + X_BAND - 3}
                  textAnchor="middle"
                  style={tickText}
                >
                  {vils}
                </text>
              </g>
            ))}
          </svg>
        </div>

        {/* Legend — resource icons on the right + the farms line */}
        <div style={legendCol}>
          {resources.map((r) => (
            <LegendRow key={r} color={ECON_RESOURCE_COLOR[r]} label={r}>
              <ResIcon resource={r} />
            </LegendRow>
          ))}
          <LegendRow color="#fff" label="active farms" dashed>
            <ResIcon resource="food" />
          </LegendRow>
        </div>
      </div>
      <div style={footNote}>
        worker COUNTS (gather-intent + production sim). The farms line is
        reseed-excluded distinct farms — each ≈ one farmer, so it floors and
        drives the food count.
      </div>
    </div>
  );
}

function ResIcon({ resource }: { resource: string }) {
  const url = aoe2ResourceIconUrl(resource);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={resource}
      width={16}
      height={16}
      style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }}
    />
  ) : (
    <span style={{ width: 16 }} />
  );
}

function LegendRow({
  color,
  label,
  dashed,
  children,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        fontSize: "0.72rem",
        color: "#bbb",
        textTransform: "capitalize",
      }}
    >
      <span
        style={{
          width: 12,
          height: dashed ? 0 : 10,
          borderTop: dashed ? `2px dashed ${color}` : undefined,
          borderRadius: 2,
          background: dashed ? undefined : color,
          flexShrink: 0,
        }}
      />
      {children}
      <span style={{ whiteSpace: "nowrap" }}>{label}</span>
    </span>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: "0.55rem",
  color: "#666",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};
const legendCol: React.CSSProperties = {
  flex: "0 0 auto",
  display: "flex",
  flexDirection: "column",
  gap: "0.35rem",
  paddingTop: "0.2rem",
};
const footNote: React.CSSProperties = {
  fontSize: "0.5rem",
  color: "#555",
  marginTop: "0.4rem",
};
const tickText: React.CSSProperties = {
  fontSize: "9px",
  fill: "#777",
  fontFamily: "var(--font-mono, monospace)",
};
