"use client";

import { buildProductionSeries, fmtMmss, Reconstruction } from "@/lib/aoe2";
import { aoe2IconUrl } from "@/lib/aoe2Icons";
import Aoe2Icon from "./Aoe2Icon";

/**
 * Unified full-width production graph — the headline of the Army & Stats tab.
 *
 *   • ABOVE the x-axis: stacked-area of villagers + army units by type (colored). The area height
 *     encodes the cumulative PRODUCED count (queued upper bound — combat deaths aren't in the replay).
 *   • The x-axis time labels sit in their OWN band BELOW the axis so the colored areas never hide them.
 *   • BELOW zero: an ICON ROW plotting events over time — every unit-production event AND every
 *     upgrade/tech (eco / military / university, each at its t_s) — drawn as its real bundled icon
 *     at its x-position. One graph shows both the army (areas) and the upgrades (icon row).
 *   • Age-up vertical guide-lines + age icons (Feudal / Castle / Imperial) span the whole chart.
 *   • The unit legend is a vertical list on the RIGHT (swatch + icon + name + total).
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

  // ── Geometry: a wide viewBox that scales to 100% of the detail pane. ───────
  const W = 1100;
  const PAD = { top: 14, right: 18, bottom: 0, left: 40 };
  const AREA_H = 200; // stacked-area band (above the axis)
  const TIME_BAND = 18; // m:ss tick labels, in their own band below the axis
  const ICON_ROW_H = 30; // negative-band event icon row
  const H = PAD.top + AREA_H + TIME_BAND + ICON_ROW_H + 14;

  const axisY = PAD.top + AREA_H; // y of the zero line (the x-axis)
  const plotW = W - PAD.left - PAD.right;

  const xOf = (t: number) => PAD.left + (dur > 0 ? (t / dur) * plotW : 0);
  const yOf = (v: number) => axisY - (v / yMax) * AREA_H; // value → y above axis

  // Stacked area bands (accumulate from the bottom).
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

  // X ticks — ~6 evenly spaced over the duration.
  const tickCount = 6;
  const xTicks = Array.from({ length: tickCount + 1 }, (_, i) =>
    Math.round((dur / tickCount) * i),
  );
  // Y ticks — a few rounded levels.
  const yTickStep = niceStep(yMax / 4);
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax + 0.5; v += yTickStep) yTicks.push(v);

  // ── Age-up vertical lines + icons (span the whole chart). ──────────────────
  const ages = recon.ages ?? {};
  const ageLines = (
    [
      ["feudal", "Feudal"],
      ["castle", "Castle"],
      ["imperial", "Imperial"],
    ] as const
  )
    .map(([k, name]) => ({
      t: ages[`${k}_arrival_s`] as number,
      label: `${name} Age`,
      icon: aoe2IconUrl(`${name} Age`),
    }))
    .filter((a) => typeof a.t === "number" && a.t > 0 && a.t <= dur);

  // ── Negative band: event icon row — units produced + techs, deduped per
  //    (name, ~time bucket) so a flurry of same-unit queues collapses to one icon. ──
  const eventIconY = axisY + TIME_BAND + ICON_ROW_H / 2;
  const techs = recon.techs ?? {};
  const rawEvents: { t: number; name: string }[] = [
    ...(recon.production?.produced_units ?? []).map((u) => ({
      t: u.t_s,
      name: u.name,
    })),
    ...(techs.eco ?? []).map((e) => ({ t: e.t_s, name: e.name })),
    ...(techs.military ?? []).map((e) => ({ t: e.t_s, name: e.name })),
    ...(techs.university ?? []).map((e) => ({ t: e.t_s, name: e.name })),
  ].filter((e) => typeof e.t === "number" && e.t >= 0 && e.t <= dur);

  // Collapse near-duplicate same-name events (keep earliest) so the row stays legible.
  const BUCKET_S = Math.max(15, Math.round(dur / 60));
  const seen = new Set<string>();
  const events = rawEvents
    .sort((a, b) => a.t - b.t)
    .filter((e) => {
      const key = `${e.name}@${Math.round(e.t / BUCKET_S)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const EVENT_ICON = 16;

  return (
    <div>
      <div style={labelStyle}>Production over time — produced (cumulative)</div>
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "flex-start",
          marginTop: "0.4rem",
        }}
      >
        {/* ── Chart (fills available width) ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            style={{ display: "block", width: "100%" }}
            role="img"
            aria-label="Full-width production graph: stacked area of units produced over time above the axis, an upgrade/unit event icon row below, with age-up guide-lines."
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
                  x={PAD.left - 6}
                  y={yOf(v) + 3}
                  textAnchor="end"
                  style={tickText}
                >
                  {v}
                </text>
              </g>
            ))}

            {/* Age-up vertical guide-lines (span area + icon row) */}
            {ageLines.map((a) => (
              <g key={a.label}>
                <line
                  x1={xOf(a.t)}
                  y1={PAD.top}
                  x2={xOf(a.t)}
                  y2={axisY + TIME_BAND + ICON_ROW_H}
                  stroke="var(--accent)"
                  strokeWidth={1}
                  opacity={0.4}
                />
                {a.icon && (
                  <image
                    href={a.icon}
                    x={xOf(a.t) - 8}
                    y={PAD.top - 2}
                    width={16}
                    height={16}
                    preserveAspectRatio="xMidYMid meet"
                  >
                    <title>
                      {a.label} — {fmtMmss(a.t)}
                    </title>
                  </image>
                )}
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

            {/* Zero line (the x-axis) */}
            <line
              x1={PAD.left}
              y1={axisY}
              x2={W - PAD.right}
              y2={axisY}
              stroke="#3a3a3a"
              strokeWidth={1}
            />

            {/* X-axis time labels — own band below the axis */}
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
                  y={axisY + TIME_BAND - 4}
                  textAnchor="middle"
                  style={tickText}
                >
                  {fmtMmss(t)}
                </text>
              </g>
            ))}

            {/* Negative band: event icon row (units produced + upgrades/techs) */}
            <text
              x={PAD.left - 6}
              y={eventIconY + 3}
              textAnchor="end"
              style={tickText}
            >
              ↧
            </text>
            {events.map((e, i) => {
              const url = aoe2IconUrl(e.name);
              const cx = xOf(e.t);
              return url ? (
                <image
                  key={`${e.name}-${i}`}
                  href={url}
                  x={cx - EVENT_ICON / 2}
                  y={eventIconY - EVENT_ICON / 2}
                  width={EVENT_ICON}
                  height={EVENT_ICON}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <title>
                    {e.name} — {fmtMmss(e.t)}
                  </title>
                </image>
              ) : (
                // Unknown name → "?" chip (anticipates future content), never a bare dot.
                <g key={`${e.name}-${i}`}>
                  <rect
                    x={cx - EVENT_ICON / 2}
                    y={eventIconY - EVENT_ICON / 2}
                    width={EVENT_ICON}
                    height={EVENT_ICON}
                    rx={2}
                    fill="#161b22"
                    stroke="#232a33"
                  />
                  <text
                    x={cx}
                    y={eventIconY + 3.5}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill="#8a8f98"
                  >
                    ?
                  </text>
                  <title>
                    {e.name} — {fmtMmss(e.t)}
                  </title>
                </g>
              );
            })}
          </svg>
        </div>

        {/* ── Legend — vertical list on the RIGHT (swatch + icon + name + total) ── */}
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "0.35rem",
            paddingTop: "0.2rem",
          }}
        >
          {series.map((s) => (
            <span
              key={s.name}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                fontSize: "0.72rem",
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
              {s.name === "Other" ? (
                <span style={{ width: 16 }} />
              ) : (
                <Aoe2Icon name={s.isVillager ? "Villager" : s.name} size={16} />
              )}
              <span style={{ flex: 1, whiteSpace: "nowrap" }}>{s.name}</span>
              <span style={{ color: "#777" }}>×{s.total}</span>
            </span>
          ))}
        </div>
      </div>

      <div style={{ fontSize: "0.5rem", color: "#555", marginTop: "0.4rem" }}>
        areas = cumulative units produced (queued upper bound, excludes deaths);
        icon row below the axis = unit &amp; upgrade events over time.
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
  fontSize: "9px",
  fill: "#777",
  fontFamily: "var(--font-mono, monospace)",
};
