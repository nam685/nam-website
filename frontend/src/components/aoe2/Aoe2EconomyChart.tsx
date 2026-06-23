"use client";

import { Economy, fmtMmss } from "@/lib/aoe2";
import DataBadge from "./DataBadge";

/**
 * V4 — economy ESTIMATE panel (#5 spec, Tier-B). The whole panel carries an `~est` badge. We show
 * the per-age vils-per-resource SHARES (the primary deliverable) as stacked bars; collected totals
 * are shown ONLY if the #2 model did not self-suppress them (collected != null) — otherwise we show
 * the qualitative eco shape, honestly labeled. If economy is absent/unavailable we render an honest
 * Tier-C placeholder rather than hiding the panel.
 */
const RES_COLOR: Record<string, string> = {
  food: "#e0b848",
  wood: "#3f9e54",
  gold: "#f0c440",
  stone: "#9aa3ad",
};

export default function Aoe2EconomyChart({
  economy,
}: {
  economy: Economy | null | undefined;
}) {
  if (!economy || economy.unavailable || Object.keys(economy).length === 0) {
    return (
      <div style={{ fontSize: "0.7rem", color: "#666" }}>
        Economy estimate unavailable for this match{" "}
        <DataBadge tier="unavailable" />
      </div>
    );
  }

  const snaps = economy.eco_split_at_ages ?? {};
  const ages: { key: "feudal" | "castle" | "imperial"; name: string }[] = [
    { key: "feudal", name: "Feudal" },
    { key: "castle", name: "Castle" },
    { key: "imperial", name: "Imperial" },
  ];
  const qual = economy.qualitative ?? {};

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          marginBottom: "0.5rem",
        }}
      >
        <span style={{ fontSize: "0.6rem", color: "#888" }}>
          Villager allocation by age
        </span>
        <DataBadge tier="est" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {ages.map(({ key, name }) => {
          const snap = snaps[key];
          if (!snap) {
            return (
              <div
                key={key}
                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <span
                  style={{ width: "3.5rem", fontSize: "0.6rem", color: "#555" }}
                >
                  {name}
                </span>
                <span style={{ fontSize: "0.6rem", color: "#444" }}>
                  not reached
                </span>
              </div>
            );
          }
          const shares = snap.shares ?? {};
          return (
            <div
              key={key}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <span
                style={{ width: "3.5rem", fontSize: "0.6rem", color: "#888" }}
              >
                {name}
              </span>
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  height: "0.7rem",
                  borderRadius: "3px",
                  overflow: "hidden",
                  opacity: 0.85,
                  border: "1px dashed #3a2e0e",
                }}
              >
                {["food", "wood", "gold", "stone"].map((r) =>
                  shares[r] ? (
                    <div
                      key={r}
                      title={`${r}: ~${Math.round((shares[r] ?? 0) * 100)}%`}
                      style={{
                        width: `${(shares[r] ?? 0) * 100}%`,
                        background: RES_COLOR[r],
                      }}
                    />
                  ) : null,
                )}
              </div>
              <span style={{ fontSize: "0.5rem", color: "#555" }}>
                n={snap.n_events}
              </span>
            </div>
          );
        })}
      </div>

      {/* collected totals: only if the model did NOT self-suppress */}
      {economy.collected ? (
        <div style={{ marginTop: "0.5rem", fontSize: "0.6rem", color: "#888" }}>
          Estimated collected totals <DataBadge tier="est" />
        </div>
      ) : (
        <div
          style={{ marginTop: "0.5rem", fontSize: "0.55rem", color: "#666" }}
        >
          Collected totals self-suppressed (insufficient signal) — qualitative
          only.
        </div>
      )}

      {(qual.committed_first ||
        (qual.eco_techs && qual.eco_techs.length > 0)) && (
        <div style={{ marginTop: "0.4rem", fontSize: "0.6rem", color: "#999" }}>
          {qual.committed_first && (
            <>First committed: {qual.committed_first}. </>
          )}
          {qual.gold_mining_start_s != null && (
            <>Gold @ {fmtMmss(qual.gold_mining_start_s)}. </>
          )}
        </div>
      )}
      <div
        style={{
          fontSize: "0.5rem",
          color: "#555",
          marginTop: "0.3rem",
          fontStyle: "italic",
        }}
      >
        Estimated from sparse assignment commands; timestamps exact,
        interpretation heuristic.
      </div>
    </div>
  );
}
