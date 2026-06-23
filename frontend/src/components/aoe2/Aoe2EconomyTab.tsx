"use client";

import { Economy } from "@/lib/aoe2";
import Aoe2ResourceBalanceChart from "./Aoe2ResourceBalanceChart";
import Aoe2WorkerAllocChart from "./Aoe2WorkerAllocChart";
import DataBadge from "./DataBadge";

/**
 * Economy tab — TWO graphs in the Army-graph visual language (full width, ~half height, icon legend
 * on the right), never conflating their units:
 *   1. Worker allocation — villager COUNTS per resource, x = villager count, stacked bars, log y,
 *      with the active-farms line driving the food count.
 *   2. Resource balance — near-exact AMOUNTS spent per resource, x = real time, stacked area, log y.
 * Both carry an estimate badge. Collected/bank totals stay suppressed (never fabricated).
 */
export default function Aoe2EconomyTab({
  economy,
}: {
  economy: Economy | null | undefined;
}) {
  if (!economy || economy.unavailable || Object.keys(economy).length === 0) {
    return (
      <div style={{ fontSize: "0.75rem", color: "#666" }}>
        Economy estimate unavailable for this match{" "}
        <DataBadge tier="unavailable" />
      </div>
    );
  }

  const wa = economy.worker_allocation;
  const rb = economy.resource_balance;
  const flags = rb?.floating?.flags ?? [];
  const hasGraphs =
    (wa?.series?.length ?? 0) > 0 || (rb?.series?.length ?? 0) > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <span style={{ fontSize: "0.7rem", color: "#ddd", fontWeight: 600 }}>
          Economy
        </span>
        <DataBadge tier="est" />
      </div>

      {!hasGraphs && (
        <div style={{ fontSize: "0.7rem", color: "#777" }}>
          The economy graph appears after this match is (re-)analyzed with the
          latest pipeline.
        </div>
      )}

      {(wa?.series?.length ?? 0) > 0 && (
        <Aoe2WorkerAllocChart workerAllocation={wa} />
      )}
      {(rb?.series?.length ?? 0) > 0 && (
        <Aoe2ResourceBalanceChart resourceBalance={rb} />
      )}

      {/* Floating flags — a heuristic gap between gathering intent and spend. */}
      <div>
        <div style={labelStyle}>Floating (intent vs spend)</div>
        <div
          style={{
            marginTop: "0.4rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.4rem",
          }}
        >
          {flags.length > 0 ? (
            flags.map((fl) => (
              <span
                key={fl.resource}
                title={`gathering intent ${Math.round(fl.worker_share * 100)}% vs spend ${Math.round(
                  fl.spend_share * 100,
                )}% — excess ${Math.round(fl.excess * 100)}%`}
                style={{
                  fontSize: "0.62rem",
                  color: "#f0c440",
                  background: "#2a2310",
                  border: "1px solid #4a3c14",
                  borderRadius: 3,
                  padding: "0.1rem 0.45rem",
                }}
              >
                ⚠ floating {fl.resource} (+{Math.round(fl.excess * 100)}%)
              </span>
            ))
          ) : (
            <span style={{ fontSize: "0.62rem", color: "#22c55e" }}>
              no sustained floating detected
            </span>
          )}
        </div>
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
