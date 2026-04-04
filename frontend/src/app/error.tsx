"use client";

export default function GlobalError({
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
        minHeight: "50vh",
        gap: "1rem",
        fontFamily: "var(--font-body)",
      }}
    >
      <p style={{ color: "#888", fontSize: "0.85rem" }}>
        Something went wrong loading this page.
      </p>
      <button
        onClick={reset}
        style={{
          background: "none",
          border: "1px solid #333",
          color: "#ccc",
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
