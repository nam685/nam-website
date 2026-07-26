"use client";

import { Mistake, mistakeTier } from "@/lib/aoe2";
import DataBadge from "./DataBadge";

/**
 * Deterministically flagged mistakes (#6). An empty list is an honest "no mistakes detected" —
 * we say so, never invent one. Each row carries a confidence_tier (exact|heuristic|needs-#2) shown
 * as a tier badge, and a `source.study` deep-link to learn more.
 */
const SEV_COLOR: Record<string, string> = {
  high: "#e04848",
  medium: "#f0c440",
  low: "#9aa3ad",
};

export default function Aoe2Mistakes({ mistakes }: { mistakes: Mistake[] }) {
  if (!mistakes || mistakes.length === 0) {
    return (
      <p style={{ fontSize: "0.7rem", color: "#22c55e", fontStyle: "italic" }}>
        No mistakes detected by the deterministic checks for this game.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {mistakes.map((m) => {
        const study = m.source?.study;
        return (
          <div
            key={m.id}
            style={{
              borderLeft: `2px solid ${SEV_COLOR[m.severity] ?? "#555"}`,
              paddingLeft: "0.6rem",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: "0.8rem", color: "#ddd" }}>
                {m.name}
              </span>
              <span
                style={{
                  fontSize: "0.5rem",
                  textTransform: "uppercase",
                  color: SEV_COLOR[m.severity] ?? "#555",
                }}
              >
                {m.severity}
              </span>
              {m.confidence_tier && m.confidence_tier !== "exact" && (
                <DataBadge
                  tier={mistakeTier(m.confidence_tier)}
                  label={m.confidence_tier}
                />
              )}
            </div>
            {m.explanation && (
              <div
                style={{
                  fontSize: "0.65rem",
                  color: "#999",
                  marginTop: "0.15rem",
                  lineHeight: 1.5,
                }}
              >
                {m.explanation}
              </div>
            )}
            {m.fix && (
              <div
                style={{
                  fontSize: "0.65rem",
                  color: "#bbb",
                  marginTop: "0.15rem",
                }}
              >
                <span style={{ color: "var(--accent)" }}>Fix:</span> {m.fix}
              </div>
            )}
            {study?.url && (
              <a
                href={study.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: "0.6rem",
                  color: "var(--accent)",
                  marginTop: "0.15rem",
                  display: "inline-block",
                }}
              >
                {study.title || "Learn more"} ↗
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
