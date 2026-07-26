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
    </div>
  );
}
