"use client";

import {
  buildResourceBalanceChart,
  ECON_RESOURCE_COLOR,
  fmtMmss,
  niceTicks,
  ResourceBalance,
} from "@/lib/aoe2";
import { aoe2ResourceIconUrl } from "@/lib/aoe2Icons";

/**
 * Resource-balance graph — cumulative near-exact SPEND per resource over REAL TIME, styled like the
 * Army production graph (full width, ~half height, icon legend on the right).
 *
 *   • X-axis = REAL TIME (m:ss). Spend is inherently temporal, so the owner asked for a time axis
 *     here (vs the villager-count axis of the worker-allocation graph).
 *   • Stacked AREA (a line/area like the army graph, NOT bars): food / wood / gold / stone, bottom-up.
 *   • Y-axis is LOG-scaled: each band spans logFrac(cumLower)→logFrac(cumUpper), so early small spends
 *     stay visible against the late-game totals.
 *
 * Spend is near-exact (BUILD + train + research costs); collected/bank totals stay suppressed.
 * Pure SVG, same-origin icons — CSP-safe.
 */
export default function Aoe2ResourceBalanceChart({
  resourceBalance,
}: {
  resourceBalance: ResourceBalance | null | undefined;
}) {
  const chart = buildResourceBalanceChart(resourceBalance);
  if (!chart) return null;
  const { points, resources, xMin, xMax, maxStackTotal } = chart;

  const W = 1100;
  const PAD = { top: 16, right: 16, bottom: 0, left: 44 };
  const AREA_H = 240; // tall — paired with the worker-alloc chart, the two fill the pane height
  const X_BAND = 16;
  const H = PAD.top + AREA_H + X_BAND + 10;
  const plotW = W - PAD.left - PAD.right;
  const tSpan = Math.max(1, xMax - xMin);
  const xOf = (t: number) => PAD.left + ((t - xMin) / tSpan) * plotW;
  const axisY = PAD.top + AREA_H;
  // LINEAR y-axis — honest proportions of the cumulative spend split.
  const yOf = (v: number) => axisY - (v / maxStackTotal) * AREA_H;

  // Stacked bands (food bottom-up): each band is the polygon between cumLower and cumUpper across
  // all time points.
  const cumLower = points.map(() => 0);
  const bands = resources.map((r) => {
    const lowerY = points.map((p, i) => yOf(cumLower[i]));
    for (let i = 0; i < points.length; i++)
      cumLower[i] += points[i].values[r] ?? 0;
    const upperY = points.map((p, i) => yOf(cumLower[i]));
    const top = points.map((p, i) => `${xOf(p.x)},${upperY[i]}`).join(" ");
    const bottom = points
      .map((p, i) => `${xOf(p.x)},${lowerY[i]}`)
      .reverse()
      .join(" ");
    return {
      r,
      path: `${top} ${bottom}`,
      total: points[points.length - 1].values[r] ?? 0,
    };
  });

  const tickCount = 6;
  const xTicks = Array.from({ length: tickCount + 1 }, (_, i) =>
    Math.round(xMin + (tSpan / tickCount) * i),
  );
  const yGrid = niceTicks(maxStackTotal, 5);

  return (
    <div>
      <div style={labelStyle}>
        Resource balance — cumulative spend per resource (x = time)
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
            aria-label="Resource balance: stacked area of cumulative spend per resource over time, log y-axis."
          >
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
                  {v >= 1000 ? `${v / 1000}k` : v}
                </text>
              </g>
            ))}

            {bands.map((b) => (
              <polygon
                key={b.r}
                points={b.path}
                fill={ECON_RESOURCE_COLOR[b.r]}
                fillOpacity={0.82}
                stroke={ECON_RESOURCE_COLOR[b.r]}
                strokeWidth={0.75}
                strokeOpacity={0.9}
              />
            ))}

            <line
              x1={PAD.left}
              y1={axisY}
              x2={W - PAD.right}
              y2={axisY}
              stroke="#3a3a3a"
              strokeWidth={1}
            />

            {xTicks.map((t) => (
              <g key={`x-${t}`}>
                <line
                  x1={xOf(t)}
                  y1={axisY}
                  x2={xOf(t)}
                  y2={axisY + 4}
                  stroke="#3a3a3a"
                  strokeWidth={1}
                />
                <text
                  x={xOf(t)}
                  y={axisY + X_BAND - 3}
                  textAnchor="middle"
                  style={tickText}
                >
                  {fmtMmss(t)}
                </text>
              </g>
            ))}
          </svg>
        </div>

        <div style={legendCol}>
          {bands.map((b) => (
            <span
              key={b.r}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                fontSize: "0.72rem",
                color: "#bbb",
                textTransform: "capitalize",
              }}
              title={`${b.r} — ${Math.round(b.total).toLocaleString()} spent`}
            >
              <span
                style={{
                  width: 12,
                  height: 10,
                  borderRadius: 2,
                  background: ECON_RESOURCE_COLOR[b.r],
                  flexShrink: 0,
                }}
              />
              <ResIcon resource={b.r} />
              <span style={{ flex: 1, whiteSpace: "nowrap" }}>{b.r}</span>
              <span style={{ color: "#777" }}>
                {Math.round(b.total).toLocaleString()}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div style={footNote}>
        cumulative SPEND (BUILD + train + research) — near-exact. Collected/bank
        totals are suppressed (never fabricated).
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
