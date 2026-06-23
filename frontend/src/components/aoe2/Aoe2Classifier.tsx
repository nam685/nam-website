"use client";

import { Classifier } from "@/lib/aoe2";

/**
 * Build-order guess from the #3 deterministic classifier: the single top-ranked build with its
 * confidence and matched/missed signals. Honest about low confidence (the classifier itself flags
 * it). All exact (command-derived) → solid, no estimate badge.
 */
export default function Aoe2Classifier({
  classifier,
}: {
  classifier: Classifier;
}) {
  const top = classifier.candidates?.[0];
  if (!top) return null;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "0.4rem",
        }}
      >
        {classifier.is_confident ? (
          <span style={{ fontSize: "0.5rem", color: "#22c55e" }}>
            confident
          </span>
        ) : (
          <span style={{ fontSize: "0.5rem", color: "#f0c440" }}>
            {classifier.unknown ? "off-meta / uncertain" : "low confidence"}
          </span>
        )}
      </div>
      <div
        style={{
          border: "1px solid #1d232c",
          borderRadius: "4px",
          padding: "0.5rem 0.6rem",
          background: "#0f1419",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--accent)" }}>
            {top.name}
          </span>
          <span style={{ fontSize: "0.6rem", color: "#777" }}>
            {Math.round((top.confidence ?? 0) * 100)}%
          </span>
        </div>
        {(top.matched_signals?.length ?? 0) > 0 && (
          <div
            style={{
              marginTop: "0.25rem",
              display: "flex",
              gap: "0.3rem",
              flexWrap: "wrap",
            }}
          >
            {top.matched_signals!.map((s, si) => (
              <span key={si} style={sigStyle("#0e3a2e", "#34d399")}>
                ✓ {s}
              </span>
            ))}
          </div>
        )}
        {(top.missed_signals?.length ?? 0) > 0 && (
          <div
            style={{
              marginTop: "0.25rem",
              display: "flex",
              gap: "0.3rem",
              flexWrap: "wrap",
            }}
          >
            {top.missed_signals!.slice(0, 4).map((s, si) => (
              <span key={si} style={sigStyle("#2a2118", "#c08a4a")}>
                ✗ {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function sigStyle(bg: string, fg: string): React.CSSProperties {
  return {
    fontSize: "0.55rem",
    padding: "0.05rem 0.35rem",
    borderRadius: "3px",
    background: bg,
    color: fg,
  };
}
