import type { CSSProperties } from "react";

export const ACCENT = "var(--accent)";

export const card: CSSProperties = {
  border: "1px solid #1c1c1c",
  borderRadius: "4px",
  background: "#0b0d0f",
  padding: "0.9rem 1rem",
};

export const label: CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.58rem",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#666",
};

export const btn: CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.62rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "0.4rem 0.8rem",
  background: "transparent",
  color: "#aaa",
  border: "1px solid #333",
  borderRadius: "3px",
  cursor: "pointer",
};

export const btnPrimary: CSSProperties = {
  ...btn,
  background: "var(--accent)",
  color: "#0e0e0e",
  border: "1px solid var(--accent)",
  fontWeight: 700,
};

export const input: CSSProperties = {
  background: "#0e0e0e",
  border: "1px solid #2a2a2a",
  borderRadius: "3px",
  color: "#ddd",
  padding: "0.45rem 0.6rem",
  fontSize: "0.8rem",
  width: "100%",
};

export const summaryStyle: CSSProperties = {
  cursor: "pointer",
  fontSize: "0.72rem",
  color: "#888",
  padding: "0.3rem 0",
};

export const video: CSSProperties = {
  width: "100%",
  maxHeight: "min(60vh, 520px)",
  background: "#000",
  borderRadius: "3px",
  display: "block",
};
