"use client";

import Aoe2Icon from "@/components/aoe2/Aoe2Icon";
import {
  type BuildAgeTarget,
  type BuildDetail,
  buildPhaseLanes,
  stepIconName,
} from "@/lib/aoe2";

const ACCENT = "var(--accent)";

function fmtArrival(s: number | null | undefined): string {
  if (typeof s !== "number" || s <= 0) return "—";
  const sec = Math.floor(s);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function ageBadge(target: BuildAgeTarget | undefined): string | null {
  if (!target) return null;
  const bits: string[] = [];
  if (typeof target.arrival_s === "number" && target.arrival_s > 0)
    bits.push(`@ ${fmtArrival(target.arrival_s)}`);
  if (typeof target.vils_at_click === "number" && target.vils_at_click)
    bits.push(`${target.vils_at_click} vils`);
  return bits.length ? bits.join(" · ") : null;
}

/**
 * Phase-laned build timeline with the real AoE2 icons. One lane per phase (Dark Age → Feudal →
 * Castle → Imperial); each step renders its mapped building/unit/tech icon (glyph fallback for
 * unmapped) beside the task text. Feudal/Castle/Imperial lanes show the build's age target.
 */
export default function BuildTimeline({ build }: { build: BuildDetail }) {
  const lanes = buildPhaseLanes(build.steps);
  const targetForPhase = (phase: string): BuildAgeTarget | undefined => {
    if (phase === "feudal") return build.age_targets?.feudal;
    if (phase === "castle") return build.age_targets?.castle;
    if (phase === "imperial") return build.age_targets?.imperial;
    return undefined;
  };

  return (
    <div
      style={{
        display: "flex",
        gap: "0.75rem",
        overflowX: "auto",
        paddingBottom: "0.5rem",
      }}
    >
      {lanes.map((lane) => {
        const badge = ageBadge(targetForPhase(lane.phase));
        return (
          <div
            key={lane.phase}
            style={{
              flex: "1 0 14rem",
              minWidth: "13rem",
              background: "rgba(13,17,23,0.72)",
              border: "1px solid #1c2330",
              borderRadius: 4,
              padding: "0.75rem",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "0.4rem",
                marginBottom: "0.6rem",
                borderBottom: "1px solid #1a1a1a",
                paddingBottom: "0.35rem",
              }}
            >
              <span
                style={{
                  fontSize: "0.7rem",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: ACCENT,
                }}
              >
                {lane.label}
              </span>
              {badge && (
                <span style={{ fontSize: "0.6rem", color: "#888" }}>
                  {badge}
                </span>
              )}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.55rem",
              }}
            >
              {lane.steps.map((step, i) => {
                const iconName = stepIconName(step.task);
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "0.5rem",
                    }}
                  >
                    <Aoe2Icon name={iconName ?? step.task} size={22} />
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "#ddd",
                          lineHeight: 1.35,
                        }}
                      >
                        {step.task}
                      </div>
                      {(step.vils != null || step.pop != null) && (
                        <div
                          style={{
                            fontSize: "0.58rem",
                            color: "#777",
                            marginTop: "0.1rem",
                          }}
                        >
                          {step.vils != null && `${step.vils} vils`}
                          {step.vils != null && step.pop != null && " · "}
                          {step.pop != null && `${step.pop} pop`}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
