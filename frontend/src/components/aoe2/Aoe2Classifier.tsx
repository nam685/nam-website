"use client";

import { Classifier } from "@/lib/aoe2";

/**
 * Build-order candidate(s) from the #3 deterministic classifier: 1-3 ranked builds with confidence
 * and matched/missed signals. Honest about low confidence (the classifier itself flags it). All
 * exact (command-derived) → solid, no estimate badge.
 */
export default function Aoe2Classifier({
  classifier,
}: {
  classifier: Classifier;
}) {
  const candidates = classifier.candidates ?? [];
  if (candidates.length === 0) return null;

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
        <span style={{ fontSize: "0.6rem", color: "#888" }}>Build order</span>
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
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {candidates.map((c, i) => (
          <div
            key={c.build_id}
            style={{
              border: "1px solid #1d232c",
              borderRadius: "4px",
              padding: "0.5rem 0.6rem",
              background: i === 0 ? "#0f1419" : "transparent",
            }}
          >
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <span
                style={{
                  fontSize: "0.85rem",
                  color: i === 0 ? "var(--accent)" : "#bbb",
                }}
              >
                {c.name}
              </span>
              <span style={{ fontSize: "0.6rem", color: "#777" }}>
                {Math.round((c.confidence ?? 0) * 100)}%
              </span>
            </div>
            {(c.matched_signals?.length ?? 0) > 0 && (
              <div
                style={{
                  marginTop: "0.25rem",
                  display: "flex",
                  gap: "0.3rem",
                  flexWrap: "wrap",
                }}
              >
                {c.matched_signals!.map((s, si) => (
                  <span key={si} style={sigStyle("#0e3a2e", "#34d399")}>
                    ✓ {s}
                  </span>
                ))}
              </div>
            )}
            {i === 0 && (c.missed_signals?.length ?? 0) > 0 && (
              <div
                style={{
                  marginTop: "0.25rem",
                  display: "flex",
                  gap: "0.3rem",
                  flexWrap: "wrap",
                }}
              >
                {c.missed_signals!.slice(0, 4).map((s, si) => (
                  <span key={si} style={sigStyle("#2a2118", "#c08a4a")}>
                    ✗ {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
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
