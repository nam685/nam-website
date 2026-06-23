"use client";

import { Reconstruction } from "@/lib/aoe2";
import DataBadge from "./DataBadge";

/**
 * V5 — produced-counts strip (#5 spec). The word "produced" is MANDATORY in every label: these are
 * cumulative-queued upper bounds on live counts, never "live army"/"units killed" (combat deaths
 * are not in the replay). Tier-C engine-only stats are shown as honest "unavailable" placeholders
 * so the gap vs the in-game Statistics screen is owned, not silently dropped.
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
            style={{ fontSize: "1.2rem", color: "#ddd" }}
            title="cumulative queued — an upper bound, not a live count"
          >
            {vils ?? "—"}
          </div>
        </div>
        {army.length > 0 && (
          <div>
            <div style={labelStyle}>Army produced</div>
            <div
              style={{
                display: "flex",
                gap: "0.6rem",
                flexWrap: "wrap",
                marginTop: "0.15rem",
              }}
            >
              {army.map((u) => (
                <span
                  key={u.name}
                  style={{ fontSize: "0.75rem", color: "#bbb" }}
                >
                  {u.name}{" "}
                  <span style={{ color: "var(--accent)" }}>×{u.amount}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          gap: "0.6rem",
          flexWrap: "wrap",
          marginTop: "0.6rem",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: "0.55rem", color: "#555" }}>
          Not in a replay:
        </span>
        {[
          "units killed / lost",
          "live army size",
          "% map explored",
          "resources collected",
        ].map((s) => (
          <span
            key={s}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
            }}
          >
            <span style={{ fontSize: "0.6rem", color: "#555" }}>{s}</span>
            <DataBadge tier="unavailable" />
          </span>
        ))}
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
