"use client";

const ACCENT = "#39ff14";

/* ── HeroSection ──────────────────────────────────────── */

export default function HeroSection({ compact }: { compact?: boolean }) {
  if (compact) return null;

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
      <a
        href="https://github.com/nam685/klaude"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontFamily: "monospace",
          fontSize: 48,
          fontWeight: 700,
          color: ACCENT,
          letterSpacing: 4,
          textShadow: `0 0 30px ${ACCENT}40`,
          textDecoration: "none",
          transition: "text-shadow 0.2s",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.textShadow = `0 0 40px ${ACCENT}, 0 0 80px ${ACCENT}60`)
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.textShadow = `0 0 30px ${ACCENT}40`)
        }
      >
        klaude
      </a>

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
    </div>
  );
}
