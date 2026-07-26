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
      {hasApm &&
        (() => {
          const total = eff.apm_total ?? 0;
          const ecoN = eff.apm_eco ?? 0;
          const milN = eff.apm_military ?? 0;
          const otherN = Math.max(0, total - ecoN - milN);
          return (
            <div>
              <div style={{ fontSize: "0.8rem", color: "#ddd" }}>
                APM {total} —{" "}
                <span style={{ color: "#22c55e" }}>{ecoN} eco</span>
                <span style={{ color: "#555" }}> · </span>
                <span style={{ color: "#e04848" }}>{milN} military</span>
                <span style={{ color: "#555" }}> · </span>
                <span style={{ color: "#999" }}>{otherN} other</span>
              </div>
              <div
                style={{
                  display: "flex",
                  height: "0.6rem",
                  borderRadius: "3px",
                  overflow: "hidden",
                  marginTop: "0.35rem",
                }}
              >
                <Seg frac={split.eco} color="#22c55e" />
                <Seg frac={split.military} color="#e04848" />
                <Seg frac={split.other} color="#444" />
              </div>
              <div
                style={{
                  fontSize: "0.55rem",
                  color: "#666",
                  marginTop: "0.3rem",
                }}
              >
                commands per minute, by what they controlled.
              </div>
            </div>
          );
        })()}
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
