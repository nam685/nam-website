"use client";

import { fmtMmss, Reconstruction, timelineX } from "@/lib/aoe2";

/**
 * V2 — horizontal time axis (0 → duration_s) with stacked lanes: Ages (arrival markers), Tech
 * (eco / military / university), Production milestones. All exact → solid, no badge. Markers are
 * ticks at t_s with hover tooltips (name + mm:ss). Age arrivals are vertical guide-lines.
 */
const WIDTH = 560;
const LANE_H = 22;
const LABEL_W = 64;

type Marker = { t: number; label: string };

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
    .map(([k, name]) => ({ t: ages[`${k}_arrival_s`] as number, label: name }))
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

  const lanes: { name: string; color: string; markers: Marker[] }[] = [
    {
      name: "Eco tech",
      color: "#22c55e",
      markers: (techs.eco ?? []).map((e) => ({ t: e.t_s, label: e.name })),
    },
    {
      name: "Mil tech",
      color: "#e04848",
      markers: (techs.military ?? []).map((e) => ({ t: e.t_s, label: e.name })),
    },
    {
      name: "Univ",
      color: "#a855f7",
      markers: (techs.university ?? []).map((e) => ({
        t: e.t_s,
        label: e.name,
      })),
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
      style={{ maxWidth: WIDTH, display: "block" }}
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
          <text
            x={tx(a.t)}
            y={12}
            fill="var(--accent)"
            fontSize={8}
            textAnchor="middle"
          >
            {a.label} {fmtMmss(a.t)}
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
            {lane.markers.map((m, mi) => (
              <circle key={mi} cx={tx(m.t)} cy={y} r={3} fill={lane.color}>
                <title>
                  {m.label} — {fmtMmss(m.t)}
                </title>
              </circle>
            ))}
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
