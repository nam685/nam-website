"use client";

import { apmSplitSegments, fmtMmss, Reconstruction } from "@/lib/aoe2";

/**
 * V3 — efficiency readouts (#5 spec): TC idle, longest villager gap, and an APM eco/mil split bar.
 * All exact → solid, no badge. (TC idle is derived from villager-queue gaps — exact, not estimated.)
 */
export default function Aoe2EfficiencyPanel({
  recon,
}: {
  recon: Reconstruction;
}) {
  const eff = recon.efficiency ?? {};
  const split = apmSplitSegments(eff.apm_eco, eff.apm_military, eff.apm_total);
  const hasApm = (eff.apm_total ?? 0) > 0;

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: "1.5rem",
          flexWrap: "wrap",
          marginBottom: "0.6rem",
        }}
      >
        <Tile label="TC idle" value={fmtMmss(eff.tc_idle_s)} />
        <Tile
          label="Longest vil gap"
          value={fmtMmss(eff.longest_villager_gap_s)}
        />
        <Tile
          label="APM"
          value={eff.apm_total != null ? String(eff.apm_total) : "—"}
        />
      </div>
      {hasApm && (
        <div>
          <div
            style={{
              display: "flex",
              height: "0.6rem",
              borderRadius: "3px",
              overflow: "hidden",
            }}
          >
            <Seg frac={split.eco} color="#22c55e" />
            <Seg frac={split.military} color="#e04848" />
            <Seg frac={split.other} color="#444" />
          </div>
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              marginTop: "0.3rem",
              fontSize: "0.55rem",
              color: "#777",
            }}
          >
            <Key color="#22c55e" label={`eco ${eff.apm_eco ?? 0}`} />
            <Key color="#e04848" label={`mil ${eff.apm_military ?? 0}`} />
            <Key color="#444" label="other" />
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: "0.55rem",
          color: "#666",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "1rem", color: "#ddd" }}>{value}</div>
    </div>
  );
}

function Seg({ frac, color }: { frac: number; color: string }) {
  if (frac <= 0) return null;
  return <div style={{ width: `${frac * 100}%`, background: color }} />;
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}
    >
      <span
        style={{
          width: "0.5rem",
          height: "0.5rem",
          background: color,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
