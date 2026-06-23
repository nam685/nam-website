"use client";

import { buildProductionSeries, fmtMmss, Reconstruction } from "@/lib/aoe2";
import Aoe2Icon from "./Aoe2Icon";

/**
 * Stacked-area "production over time" chart. Villagers sit on the bottom (tan),
 * each army UNIT TYPE stacks above in its own color; the AREA height encodes the
 * cumulative produced count. HONESTY: these are cumulative-queued upper bounds
 * ("produced"), never live counts — combat deaths are not in the replay.
 *
 * Pure SVG (no chart lib), same-origin icons — CSP-safe.
 */
export default function Aoe2ProductionChart({
  recon,
}: {
  recon: Reconstruction;
}) {
  const durationS =
    typeof recon.meta?.duration_s === "number"
      ? (recon.meta.duration_s as number)
      : null;
  const chart = buildProductionSeries(recon.production, durationS);
  if (!chart) return null;

  const { times, series, yMax, durationS: dur } = chart;

  // Plot geometry.
  const W = 520;
  const H = 200;
  const PAD = { top: 12, right: 12, bottom: 26, left: 34 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const xOf = (t: number) => PAD.left + (dur > 0 ? (t / dur) * plotW : 0);
  const yOf = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  // Stacked baselines: accumulate from the bottom so each band sits on the
  // previous total. Build an SVG area path (top edge forward, baseline back).
  const baselines = times.map(() => 0);
  const bands = series.map((s) => {
    const lowerY = times.map((_, i) => yOf(baselines[i]));
    for (let i = 0; i < times.length; i++) baselines[i] += s.values[i];
    const upperY = times.map((_, i) => yOf(baselines[i]));
    const top = times.map((t, i) => `${xOf(t)},${upperY[i]}`).join(" ");
    const bottom = times
      .map((t, i) => `${xOf(t)},${lowerY[i]}`)
      .reverse()
      .join(" ");
    return { series: s, path: `${top} ${bottom}` };
  });

  // X gridline ticks — ~5 evenly spaced over the duration.
  const tickCount = 5;
  const xTicks = Array.from({ length: tickCount + 1 }, (_, i) =>
    Math.round((dur / tickCount) * i),
  );
  // Y gridline ticks — a few rounded levels.
  const yTickStep = niceStep(yMax / 4);
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax + 0.5; v += yTickStep) yTicks.push(v);

  return (
    <div>
      <div style={labelStyle}>Production over time — produced (cumulative)</div>
      <div style={{ overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: "block", maxWidth: W, marginTop: "0.4rem" }}
          role="img"
          aria-label="Stacked area chart of cumulative units produced over game time"
        >
          {/* Y gridlines + labels */}
          {yTicks.map((v) => (
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
                x={PAD.left - 5}
                y={yOf(v) + 3}
                textAnchor="end"
                style={tickText}
              >
                {v}
              </text>
            </g>
          ))}

          {/* Stacked areas (bottom-to-top) */}
          {bands.map((b) => (
            <polygon
              key={b.series.name}
              points={b.path}
              fill={b.series.color}
              fillOpacity={0.82}
              stroke={b.series.color}
              strokeWidth={0.75}
              strokeOpacity={0.9}
            />
          ))}

          {/* X axis ticks + labels */}
          {xTicks.map((t) => (
            <g key={`x-${t}`}>
              <line
                x1={xOf(t)}
                y1={PAD.top + plotH}
                x2={xOf(t)}
                y2={PAD.top + plotH + 3}
                stroke="#3a3a3a"
                strokeWidth={1}
              />
              <text x={xOf(t)} y={H - 8} textAnchor="middle" style={tickText}>
                {fmtMmss(t)}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Legend — swatch + icon + name + total */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem 0.9rem",
          marginTop: "0.5rem",
        }}
      >
        {series.map((s) => (
          <span
            key={s.name}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              fontSize: "0.7rem",
              color: "#bbb",
            }}
            title={`${s.name} — ${s.total} produced (cumulative)`}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: s.color,
                flexShrink: 0,
              }}
            />
            {s.name === "Other" ? null : (
              <Aoe2Icon name={s.isVillager ? "Villager" : s.name} size={16} />
            )}
            <span>{s.name}</span>
            <span style={{ color: "#777" }}>×{s.total}</span>
          </span>
        ))}
      </div>

      <div style={{ fontSize: "0.5rem", color: "#555", marginTop: "0.35rem" }}>
        simulated from production (cumulative queued — excludes deaths)
      </div>
    </div>
  );
}

/* Round a raw step up to a clean 1/2/5 ×10ⁿ value so y-ticks read nicely. */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return Math.max(1, nice * pow);
}

const labelStyle: React.CSSProperties = {
  fontSize: "0.55rem",
  color: "#666",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const tickText: React.CSSProperties = {
  fontSize: "8px",
  fill: "#777",
  fontFamily: "var(--font-mono, monospace)",
};
