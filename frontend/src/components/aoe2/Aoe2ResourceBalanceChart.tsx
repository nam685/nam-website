"use client";

import {
  buildResourceBalanceChart,
  ECON_RESOURCE_COLOR,
  fmtMmss,
  lightenHex,
  niceTicks,
  ResourceBalance,
} from "@/lib/aoe2";
import { aoe2ResourceIconUrl } from "@/lib/aoe2Icons";

/**
 * Resource-balance graph — TWO-TONE stacked area per resource over REAL TIME, styled like the Army
 * production graph (full width, ~half height, icon legend on the right).
 *
 *   • X-axis = REAL TIME (m:ss). Spend is inherently temporal.
 *   • Per resource, TWO stacked sub-bands: a DARK band = cumulative SPENT (near-exact) and a BRIGHT
 *     band on top = estimated FLOATING (gathered-but-unspent signal). A wide bright patch = that
 *     resource floated, and stayed floating, for a long stretch. Shade doubles as confidence:
 *     dark = exact spend, bright = estimate.
 *   • Linear y — honest proportions.
 *
 * Floating = max(0, total_spent × worker_share − spent): an honest signal anchored to near-exact spend
 * × the trusted worker-share, NOT a fabricated bank total. Pure SVG, same-origin icons — CSP-safe.
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

  // Two-tone stacked bands: per resource, a DARK spent band then a BRIGHT floating band, bottom-up,
  // so each resource is a contiguous two-tone block (spent at the base, floating riding on top).
  const cum = points.map(() => 0);
  const last = points[points.length - 1];
  const bands: { key: string; color: string; path: string }[] = [];
  for (const r of resources) {
    for (const kind of ["spent", "floating"] as const) {
      const lowerY = points.map((_, i) => yOf(cum[i]));
      for (let i = 0; i < points.length; i++) {
        const v =
          kind === "spent"
            ? (points[i].spent[r] ?? 0)
            : (points[i].floating[r] ?? 0);
        cum[i] += v;
      }
      const upperY = points.map((_, i) => yOf(cum[i]));
      const top = points.map((p, i) => `${xOf(p.x)},${upperY[i]}`).join(" ");
      const bottom = points
        .map((p, i) => `${xOf(p.x)},${lowerY[i]}`)
        .reverse()
        .join(" ");
      bands.push({
        key: `${r}-${kind}`,
        color:
          kind === "spent"
            ? ECON_RESOURCE_COLOR[r]
            : lightenHex(ECON_RESOURCE_COLOR[r], 0.55),
        path: `${top} ${bottom}`,
      });
    }
  }
  // Legend: one row per resource, spent total + (if any) floating total in the bright shade.
  const legend = resources.map((r) => ({
    r,
    spent: last.spent[r] ?? 0,
    floating: last.floating[r] ?? 0,
  }));

  const tickCount = 6;
  const xTicks = Array.from({ length: tickCount + 1 }, (_, i) =>
    Math.round(xMin + (tSpan / tickCount) * i),
  );
  const yGrid = niceTicks(maxStackTotal, 5);

  return (
    <div>
      <div style={labelStyle}>
        Resource balance — spent (dark) + floating (bright) per resource (x =
        time)
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
            aria-label="Resource balance: two-tone stacked area per resource over time — dark spent, bright floating."
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
                key={b.key}
                points={b.path}
                fill={b.color}
                fillOpacity={0.85}
                stroke={b.color}
                strokeWidth={0.5}
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
          {legend.map((b) => (
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
              title={`${b.r} — ${Math.round(b.spent).toLocaleString()} spent${
                b.floating > 0
                  ? ` · ~${Math.round(b.floating).toLocaleString()} floating`
                  : ""
              }`}
            >
              <span
                style={{
                  display: "inline-flex",
                  width: 12,
                  height: 10,
                  borderRadius: 2,
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{ flex: 1, background: ECON_RESOURCE_COLOR[b.r] }}
                />
                <span
                  style={{
                    flex: 1,
                    background: lightenHex(ECON_RESOURCE_COLOR[b.r], 0.55),
                  }}
                />
              </span>
              <ResIcon resource={b.r} />
              <span style={{ flex: 1, whiteSpace: "nowrap" }}>{b.r}</span>
              <span style={{ color: "#777" }}>
                {Math.round(b.spent).toLocaleString()}
                {b.floating > 0 && (
                  <span
                    style={{ color: lightenHex(ECON_RESOURCE_COLOR[b.r], 0.4) }}
                  >
                    {" "}
                    +{Math.round(b.floating).toLocaleString()}
                  </span>
                )}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div style={footNote}>
        dark = cumulative SPEND (near-exact) · bright = FLOATING (~est:
        gathered-but-unspent = effort minus spend). A wide bright patch = that
        resource floated. Collected/bank totals aren&apos;t fabricated.
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
