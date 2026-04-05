"use client";

const ACCENT = "#39ff14";

/* ── HeroSection ──────────────────────────────────────── */

export default function HeroSection({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          borderBottom: `1px solid ${ACCENT}20`,
          background: `${ACCENT}05`,
        }}
      >
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 16,
            fontWeight: 700,
            color: ACCENT,
            letterSpacing: 2,
          }}
        >
          klaude
        </span>
        <span style={{ color: "#666", fontSize: 12, fontFamily: "monospace" }}>
          handmade slop machine
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "80px 24px 40px",
        gap: 16,
        flex: 1,
      }}
    >
      <div
        style={{
          fontFamily: "monospace",
          fontSize: 48,
          fontWeight: 700,
          color: ACCENT,
          letterSpacing: 4,
          textShadow: `0 0 30px ${ACCENT}40`,
        }}
      >
        klaude
      </div>

      <p
        style={{
          color: "#999",
          fontSize: 14,
          fontFamily: "monospace",
          maxWidth: 440,
          lineHeight: 1.6,
        }}
      >
        handmade slop machine
      </p>

      <a
        href="https://github.com/nam685/klaude"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          marginTop: 8,
          padding: "8px 16px",
          border: `1px solid ${ACCENT}40`,
          borderRadius: 6,
          color: ACCENT,
          fontSize: 12,
          fontFamily: "monospace",
          textDecoration: "none",
          transition: "border-color 0.2s",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.borderColor = `${ACCENT}aa`)
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.borderColor = `${ACCENT}40`)
        }
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="currentColor"
          style={{ flexShrink: 0 }}
        >
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        github.com/nam685/klaude
      </a>
    </div>
  );
}
