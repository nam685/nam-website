"use client";

import Link from "next/link";
import { Classifier } from "@/lib/aoe2";

/**
 * Build-order guess from the #3 deterministic classifier: the single top-ranked build with its
 * matched/missed signals. All exact (command-derived) → solid, no estimate badge. No confidence
 * label — just the top guess and the signals behind it.
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
          border: "1px solid #1d232c",
          borderRadius: "4px",
          padding: "0.5rem 0.6rem",
          background: "#0f1419",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {top.build_id ? (
            <Link
              href={`/plays/aoe2/builds/${top.build_id}`}
              style={{
                fontSize: "0.85rem",
                color: "var(--accent)",
                textDecoration: "underline",
                textUnderlineOffset: "2px",
              }}
              title="Learn this build →"
            >
              {top.name}
            </Link>
          ) : (
            <span style={{ fontSize: "0.85rem", color: "var(--accent)" }}>
              {top.name}
            </span>
          )}
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
