"use client";

import { Economy } from "@/lib/aoe2";
import DataBadge from "./DataBadge";

/**
 * Economy tab (#5 spec). TWO distinct, never-conflated blocks:
 *   1. Worker allocation — villager COUNTS per resource, per age (unit = workers).
 *   2. Resource balance — resource AMOUNTS spent + qualitative floating flags (unit = resources).
 * Both carry an estimate badge; units are labeled on each block so they're never read as the same
 * quantity. Collected/bank totals are deliberately suppressed (never fabricated).
 */
const RES = ["food", "wood", "gold", "stone"] as const;
const RES_COLOR: Record<string, string> = {
  food: "#e0b848",
  wood: "#3f9e54",
  gold: "#f0c440",
  stone: "#9aa3ad",
};

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

  const wa = economy.worker_allocation ?? {};
  const rb = economy.resource_balance ?? {};
  const ages: { key: "feudal" | "castle" | "imperial"; name: string }[] = [
    { key: "feudal", name: "Feudal" },
    { key: "castle", name: "Castle" },
    { key: "imperial", name: "Imperial" },
  ];
  const flags = rb.floating?.flags ?? [];
  const spent = rb.spent_by_resource ?? {};
  const spendShare = rb.spend_share ?? {};
  const maxSpent = Math.max(1, ...RES.map((r) => spent[r] ?? 0));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: "1.25rem",
      }}
    >
      {/* ── Block 1: worker allocation (COUNTS) ── */}
      <section>
        <Header
          title="Worker allocation"
          sub="villager COUNTS per resource"
          badge="est"
        />
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
        >
          {ages.map(({ key, name }) => {
            const snap = wa.per_age?.[key];
            if (!snap || !snap.alloc) {
              return (
                <Row key={key} label={name}>
                  <span style={{ fontSize: "0.6rem", color: "#555" }}>
                    not reached
                  </span>
                </Row>
              );
            }
            const alloc = snap.alloc;
            const present =
              snap.workers_present ??
              Object.values(alloc).reduce((a, b) => a + b, 0);
            return (
              <Row key={key} label={`${name} · ${present} vils`}>
                <div style={{ flex: 1 }}>
                  <div style={barWrap}>
                    {RES.map((r) =>
                      alloc[r] ? (
                        <div
                          key={r}
                          title={`${r}: ${alloc[r]} villagers`}
                          style={{
                            width: `${(alloc[r] / present) * 100}%`,
                            background: RES_COLOR[r],
                          }}
                        />
                      ) : null,
                    )}
                  </div>
                  <div style={countLabels}>
                    {RES.map((r) =>
                      alloc[r] ? (
                        <span key={r} style={{ color: RES_COLOR[r] }}>
                          {alloc[r]} {r}
                        </span>
                      ) : null,
                    )}
                  </div>
                </div>
              </Row>
            );
          })}
        </div>
        {(wa.active_farms ?? 0) > 0 && (
          <div style={note}>
            {wa.active_farms} farms seeded
            {wa.fishing_workers_total
              ? ` · ${wa.fishing_workers_total} on water`
              : ""}
          </div>
        )}
        <div style={note}>
          Counts from gather-intent + the production sim — workers, not amounts.
        </div>
      </section>

      {/* ── Block 2: resource balance (AMOUNTS spent + floating) ── */}
      <section>
        <Header
          title="Resource balance"
          sub="resource AMOUNTS spent"
          badge="est"
        />
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}
        >
          {RES.map((r) => (
            <div
              key={r}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <span
                style={{
                  width: "3rem",
                  fontSize: "0.6rem",
                  color: RES_COLOR[r],
                }}
              >
                {r}
              </span>
              <div
                style={{
                  flex: 1,
                  height: "0.6rem",
                  background: "#13181f",
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${((spent[r] ?? 0) / maxSpent) * 100}%`,
                    height: "100%",
                    background: RES_COLOR[r],
                    opacity: 0.85,
                  }}
                />
              </div>
              <span
                style={{
                  width: "4.5rem",
                  textAlign: "right",
                  fontSize: "0.6rem",
                  color: "#aaa",
                }}
              >
                {(spent[r] ?? 0).toLocaleString()}
                <span style={{ color: "#555" }}>
                  {" "}
                  ({Math.round((spendShare[r] ?? 0) * 100)}%)
                </span>
              </span>
            </div>
          ))}
        </div>

        {/* floating flags */}
        <div
          style={{
            marginTop: "0.6rem",
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
                  fontSize: "0.6rem",
                  color: "#f0c440",
                  background: "#2a2310",
                  border: "1px solid #4a3c14",
                  borderRadius: 3,
                  padding: "0.1rem 0.4rem",
                }}
              >
                ⚠ floating {fl.resource} (+{Math.round(fl.excess * 100)}%)
              </span>
            ))
          ) : (
            <span style={{ fontSize: "0.6rem", color: "#22c55e" }}>
              no sustained floating detected
            </span>
          )}
        </div>
        <div style={note}>
          Spending near-exact (BUILD + train + research). Floating = mid-game
          gather-intent minus spend (heuristic). Collected totals & relic gold{" "}
          <DataBadge tier="unavailable" /> — never fabricated.
        </div>
      </section>
    </div>
  );
}

function Header({
  title,
  sub,
  badge,
}: {
  title: string;
  sub: string;
  badge: "est";
}) {
  return (
    <div style={{ marginBottom: "0.6rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <span style={{ fontSize: "0.7rem", color: "#ddd", fontWeight: 600 }}>
          {title}
        </span>
        <DataBadge tier={badge} />
      </div>
      <div
        style={{
          fontSize: "0.55rem",
          color: "#666",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        unit: {sub}
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <span
        style={{
          width: "5.5rem",
          fontSize: "0.6rem",
          color: "#999",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

const barWrap: React.CSSProperties = {
  display: "flex",
  height: "0.7rem",
  borderRadius: 3,
  overflow: "hidden",
  border: "1px dashed #3a2e0e",
};
const countLabels: React.CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  marginTop: "0.15rem",
  fontSize: "0.5rem",
};
const note: React.CSSProperties = {
  fontSize: "0.55rem",
  color: "#666",
  marginTop: "0.5rem",
  fontStyle: "italic",
};
