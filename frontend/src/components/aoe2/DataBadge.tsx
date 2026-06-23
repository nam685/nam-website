"use client";

import { DataTier } from "@/lib/aoe2";

/**
 * The single visual-honesty enforcement point (#5 spec). Any panel sourcing estimate or
 * unavailable data renders this badge so its provenance is explicit. Exact panels render no badge.
 */
const LABELS: Record<
  DataTier,
  { text: string; bg: string; fg: string; title: string }
> = {
  exact: {
    text: "exact",
    bg: "#0e3a2e",
    fg: "#34d399",
    title: "command-derived from the replay",
  },
  est: {
    text: "~est",
    bg: "#3a2e0e",
    fg: "#fbbf24",
    title:
      "estimated from a gather-rate model; no ground-truth total to calibrate against",
  },
  unavailable: {
    text: "unavailable",
    bg: "#2a2a2a",
    fg: "#888",
    title: "not recoverable from a replay (engine-only stat)",
  },
};

export default function DataBadge({
  tier,
  label,
}: {
  tier: DataTier;
  label?: string;
}) {
  if (tier === "exact" && !label) return null;
  const cfg = LABELS[tier];
  return (
    <span
      title={cfg.title}
      style={{
        fontSize: "0.5rem",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        padding: "0.1rem 0.35rem",
        borderRadius: "3px",
        background: cfg.bg,
        color: cfg.fg,
        verticalAlign: "middle",
        whiteSpace: "nowrap",
      }}
    >
      {label ?? cfg.text}
    </span>
  );
}
