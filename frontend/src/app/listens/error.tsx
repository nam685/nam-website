"use client";

export default function ListensError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "30vh",
        gap: "1rem",
        fontFamily: "var(--font-body)",
      }}
    >
      <p style={{ color: "#888", fontSize: "0.85rem" }}>
        Failed to load this section.
      </p>
      <button
        onClick={reset}
        style={{
          background: "none",
          border: "1px solid rgba(249, 115, 22, 0.3)",
          color: "#f97316",
          padding: "0.4rem 1.2rem",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "0.8rem",
          fontFamily: "monospace",
          letterSpacing: "0.05em",
        }}
      >
        RETRY
      </button>
    </div>
  );
}
