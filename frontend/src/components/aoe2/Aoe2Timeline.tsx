"use client";

import { fmtMmss, Reconstruction, timelineX } from "@/lib/aoe2";
import { aoe2IconUrl } from "@/lib/aoe2Icons";

/**
 * V3 — horizontal time axis (0 → duration_s) with stacked lanes: Ages (arrival guide-lines), Tech
 * (eco / military / university), Production milestones. Markers now use the REAL AoE2 DE icon for
 * the tech/unit/age (bundled, same-origin); names without a bundled icon fall back to a small
 * colored glyph dot so every marker still renders. All exact → solid, no estimate badge.
 */
// Wide viewBox so the timeline spans the full detail-pane width with markers
// well spread out; the SVG scales to 100% of its container (no max-width cap).
const WIDTH = 1100;
const LANE_H = 30;
const LABEL_W = 64;
const ICON = 16;

type Marker = { t: number; label: string; icon?: string | null };

export default function Aoe2Timeline({ recon }: { recon: Reconstruction }) {
  const ages = recon.ages ?? {};
  const durationS = (recon.meta?.duration_s as number) ?? 0;
  if (!durationS) return null;

  const ageArrivals: Marker[] = (
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
    .filter((m) => typeof m.t === "number" && m.t > 0);

  const techs = recon.techs ?? {};
  const ms = recon.production?.milestones ?? {};
  const milestoneMarkers: Marker[] = (
    [
      ["first_military_building_s", "1st mil bldg"],
      ["first_unit_s", "1st unit"],
      ["first_siege_s", "1st siege"],
      ["first_treb_s", "1st treb"],
    ] as const
  )
    .map(([k, name]) => ({ t: ms[k] as number, label: name }))
    .filter((m) => typeof m.t === "number" && m.t > 0);

  const withIcon = (e: { name: string; t_s: number }): Marker => ({
    t: e.t_s,
    label: e.name,
    icon: aoe2IconUrl(e.name),
  });

  const lanes: { name: string; color: string; markers: Marker[] }[] = [
    {
      name: "Eco tech",
      color: "#22c55e",
      markers: (techs.eco ?? []).map(withIcon),
    },
    {
      name: "Mil tech",
      color: "#e04848",
      markers: (techs.military ?? []).map(withIcon),
    },
    {
      name: "Univ",
      color: "#a855f7",
      markers: (techs.university ?? []).map(withIcon),
    },
    { name: "Production", color: "#f0c440", markers: milestoneMarkers },
  ].filter((l) => l.markers.length > 0);

  const totalH = (lanes.length + 1) * LANE_H + 16;
  const innerW = WIDTH - LABEL_W;
  const tx = (t: number) => LABEL_W + timelineX(t, durationS, innerW);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${totalH}`}
      width="100%"
      style={{ width: "100%", display: "block" }}
      role="img"
      aria-label="match timeline"
    >
      {/* age guide-lines spanning all lanes */}
      {ageArrivals.map((a) => (
        <g key={a.label}>
          <line
            x1={tx(a.t)}
            y1={LANE_H - 4}
            x2={tx(a.t)}
            y2={totalH - 12}
            stroke="var(--accent)"
            strokeWidth={1}
            opacity={0.35}
          />
          {a.icon && (
            <image
              href={a.icon}
              x={tx(a.t) - 7}
              y={1}
              width={14}
              height={14}
              preserveAspectRatio="xMidYMid meet"
            >
              <title>{a.label}</title>
            </image>
          )}
          <text
            x={tx(a.t)}
            y={a.icon ? 23 : 12}
            fill="var(--accent)"
            fontSize={8}
            textAnchor="middle"
          >
            {fmtMmss(a.t)}
          </text>
        </g>
      ))}

      {/* lanes */}
      {lanes.map((lane, li) => {
        const y = (li + 1) * LANE_H + 6;
        return (
          <g key={lane.name}>
            <text x={0} y={y + 3} fill="#777" fontSize={8}>
              {lane.name}
            </text>
            <line
              x1={LABEL_W}
              y1={y}
              x2={WIDTH}
              y2={y}
              stroke="#1d232c"
              strokeWidth={1}
            />
            {lane.markers.map((m, mi) =>
              m.icon ? (
                <image
                  key={mi}
                  href={m.icon}
                  x={tx(m.t) - ICON / 2}
                  y={y - ICON / 2}
                  width={ICON}
                  height={ICON}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <title>
                    {m.label} — {fmtMmss(m.t)}
                  </title>
                </image>
              ) : (
                <circle key={mi} cx={tx(m.t)} cy={y} r={3.5} fill={lane.color}>
                  <title>
                    {m.label} — {fmtMmss(m.t)}
                  </title>
                </circle>
              ),
            )}
          </g>
        );
      })}

      {/* base axis */}
      <line
        x1={LABEL_W}
        y1={totalH - 10}
        x2={WIDTH}
        y2={totalH - 10}
        stroke="#2a2a2a"
        strokeWidth={1}
      />
      <text x={LABEL_W} y={totalH - 1} fill="#555" fontSize={8}>
        0:00
      </text>
      <text x={WIDTH} y={totalH - 1} fill="#555" fontSize={8} textAnchor="end">
        {fmtMmss(durationS)}
      </text>
    </svg>
  );
}
