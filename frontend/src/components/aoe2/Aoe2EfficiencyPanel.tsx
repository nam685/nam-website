"use client";

import {
  apmSplitSegments,
  fmtMmss,
  Reconstruction,
  tcIdlePct,
} from "@/lib/aoe2";

/**
 * V4 — efficiency readouts (#5 spec): TC idle as a PRE-CAP %, longest villager gap, and an APM
 * eco/mil split bar. All exact → solid, no badge. (Derived from villager-queue gaps — exact.)
 */
export default function Aoe2EfficiencyPanel({
  recon,
}: {
  recon: Reconstruction;
}) {
  const eff = recon.efficiency ?? {};
  const split = apmSplitSegments(eff.apm_eco, eff.apm_military, eff.apm_total);
  const hasApm = (eff.apm_total ?? 0) > 0;
  const idlePct = tcIdlePct(eff.tc_idle_s, eff.precap_window_s);

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
        <Tile
          label="TC idle"
          value={idlePct != null ? `${idlePct}%` : fmtMmss(eff.tc_idle_s)}
          hint="idle before 200 pop, age-ups excluded"
        />
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

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div title={hint}>
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
      {hint && (
        <div style={{ fontSize: "0.5rem", color: "#555", marginTop: "0.1rem" }}>
          {hint}
        </div>
      )}
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
