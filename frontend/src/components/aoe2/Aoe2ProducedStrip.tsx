"use client";

import { Reconstruction } from "@/lib/aoe2";
import Aoe2Icon from "./Aoe2Icon";

/**
 * V5 — produced-counts strip (#5 spec). The word "produced" is MANDATORY in every label: these are
 * cumulative-queued upper bounds on live counts, never "live army"/"units killed" (combat deaths
 * are not in the replay). Engine-only stats are simply omitted — a single dim footer disclaimer on
 * the detail pane owns the gap, rather than noisy per-stat "unavailable" badges.
 */
export default function Aoe2ProducedStrip({
  recon,
}: {
  recon: Reconstruction;
}) {
  const counts = recon.counts ?? {};
  const army = (counts.army_produced ?? []).slice(0, 6);
  const vils = counts.villagers_produced;

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: "1.5rem",
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div style={labelStyle}>Villagers produced</div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              fontSize: "1.2rem",
              color: "#ddd",
            }}
            title="cumulative queued — an upper bound, not a live count"
          >
            <Aoe2Icon name="Villager" size={22} />
            {vils ?? "—"}
          </div>
        </div>
        {army.length > 0 && (
          <div>
            <div style={labelStyle}>Army produced</div>
            <div
              style={{
                display: "flex",
                gap: "0.7rem",
                flexWrap: "wrap",
                marginTop: "0.25rem",
              }}
            >
              {army.map((u) => (
                <span
                  key={u.name}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    fontSize: "0.8rem",
                    color: "#bbb",
                  }}
                  title={u.name}
                >
                  <Aoe2Icon name={u.name} size={20} />
                  <span style={{ color: "var(--accent)" }}>×{u.amount}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: "0.55rem",
  color: "#666",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};
