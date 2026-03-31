"use client";

import { useEffect, useState } from "react";

import { ENTRIES, type GrindEntry } from "@/lib/grindsData";

const ACCENT = "#f59e0b";

/* ── Timeline entry card (desktop) ────────────────── */
function TimelineCard({
  entry,
  index,
}: {
  entry: GrindEntry;
  index: number;
}) {
  const isLeft = entry.side === "left";

  return (
    <div
      className={`grind-card grind-card-${isLeft ? "left" : "right"}`}
      style={{
        display: "flex",
        justifyContent: isLeft ? "flex-start" : "flex-end",
        width: "100%",
        marginBottom: "4rem",
        position: "relative",
        animationDelay: `${index * 0.15}s`,
      }}
    >
      {/* Branch line from trunk to card */}
      <div
        style={{
          position: "absolute",
          top: "1.5rem",
          left: isLeft ? undefined : "50%",
          right: isLeft ? "50%" : undefined,
          width: isLeft ? "calc(50% - 0px)" : "calc(50% - 0px)",
          height: "1px",
          background: `linear-gradient(${isLeft ? "to left" : "to right"}, ${ACCENT}60, ${ACCENT}10)`,
        }}
      />

      {/* Node on trunk */}
      <div
        style={{
          position: "absolute",
          left: "calc(50% - 6px)",
          top: "calc(1.5rem - 6px)",
          width: "12px",
          height: "12px",
          borderRadius: "50%",
          background: ACCENT,
          boxShadow: `0 0 12px ${ACCENT}, 0 0 24px ${ACCENT}40`,
          zIndex: 3,
        }}
      />

      {/* Card */}
      <div
        className="grind-card-inner"
        style={{
          width: "calc(50% - 3rem)",
          background: "#131313",
          border: `1px solid color-mix(in srgb, ${ACCENT} 25%, #1a1a1a)`,
          borderRadius: "0.5rem",
          padding: "1.25rem 1.5rem",
          position: "relative",
        }}
      >
        {/* Corner bracket — top, trunk-facing side */}
        <div
          style={{
            position: "absolute",
            top: -1,
            [isLeft ? "right" : "left"]: -1,
            width: "14px",
            height: "14px",
            borderTop: `2px solid ${ACCENT}`,
            [isLeft ? "borderRight" : "borderLeft"]: `2px solid ${ACCENT}`,
          }}
        />

        {/* Period + city */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.5rem",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.7rem",
              color: ACCENT,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            {entry.period}
          </span>
          <span
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.65rem",
              color: "#555",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            {entry.city}
          </span>
        </div>

        {/* Org name */}
        <h3
          style={{
            fontFamily: "var(--font-headline)",
            fontSize: "1.1rem",
            fontWeight: 700,
            letterSpacing: "-0.01em",
            marginBottom: "0.15rem",
          }}
        >
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="grind-org-link"
          >
            {entry.org}
          </a>
        </h3>

        {/* Role */}
        <p
          style={{
            fontFamily: "var(--font-headline)",
            fontSize: "0.8rem",
            color: `color-mix(in srgb, ${ACCENT} 70%, #888)`,
            fontWeight: 500,
            letterSpacing: "0.04em",
            marginBottom: "0.75rem",
          }}
        >
          {entry.role}
        </p>

        {/* Separator */}
        <div
          style={{
            height: "1px",
            background: `linear-gradient(to right, ${ACCENT}30, transparent)`,
            marginBottom: "0.75rem",
          }}
        />

        {/* Description */}
        <p
          style={{
            fontSize: "0.85rem",
            lineHeight: 1.7,
            color: "#aaa",
            fontWeight: 300,
          }}
        >
          {entry.description}
        </p>

        {/* Tags */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.4rem",
            marginTop: "0.75rem",
          }}
        >
          {entry.tags.map((tag) => (
            <span
              key={tag}
              style={{
                fontFamily: "var(--font-headline)",
                fontSize: "0.6rem",
                color: ACCENT,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                padding: "0.15rem 0.5rem",
                border: `1px solid color-mix(in srgb, ${ACCENT} 30%, transparent)`,
                borderRadius: "2px",
                background: `color-mix(in srgb, ${ACCENT} 5%, transparent)`,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Mobile timeline card ─────────────────────────── */
function MobileTimelineCard({
  entry,
  index,
}: {
  entry: GrindEntry;
  index: number;
}) {
  return (
    <div
      className="grind-card grind-card-mobile"
      style={{
        position: "relative",
        paddingLeft: "2.5rem",
        marginBottom: "3rem",
        animationDelay: `${index * 0.12}s`,
      }}
    >
      {/* Node on trunk */}
      <div
        style={{
          position: "absolute",
          left: "calc(1rem - 5px)",
          top: "0.25rem",
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          background: ACCENT,
          boxShadow: `0 0 10px ${ACCENT}`,
          zIndex: 3,
        }}
      />

      {/* Period + city */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.35rem",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-headline)",
            fontSize: "0.65rem",
            color: ACCENT,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          {entry.period}
        </span>
        <span
          style={{
            fontFamily: "var(--font-headline)",
            fontSize: "0.6rem",
            color: "#555",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          {entry.city}
        </span>
      </div>

      {/* Org name */}
      <h3
        style={{
          fontFamily: "var(--font-headline)",
          fontSize: "1rem",
          fontWeight: 700,
          marginBottom: "0.1rem",
        }}
      >
        <a
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          className="grind-org-link"
        >
          {entry.org}
        </a>
      </h3>

      {/* Role */}
      <p
        style={{
          fontFamily: "var(--font-headline)",
          fontSize: "0.75rem",
          color: `color-mix(in srgb, ${ACCENT} 70%, #888)`,
          fontWeight: 500,
          marginBottom: "0.5rem",
        }}
      >
        {entry.role}
      </p>

      {/* Description */}
      <p
        style={{
          fontSize: "0.8rem",
          lineHeight: 1.65,
          color: "#aaa",
          fontWeight: 300,
        }}
      >
        {entry.description}
      </p>

      {/* Tags */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.35rem",
          marginTop: "0.5rem",
        }}
      >
        {entry.tags.map((tag) => (
          <span
            key={tag}
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.55rem",
              color: ACCENT,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              padding: "0.1rem 0.4rem",
              border: `1px solid color-mix(in srgb, ${ACCENT} 30%, transparent)`,
              borderRadius: "2px",
              background: `color-mix(in srgb, ${ACCENT} 5%, transparent)`,
            }}
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Branch line */}
      <div
        style={{
          marginTop: "0.5rem",
          height: "1px",
          background: `linear-gradient(to right, ${ACCENT}30, transparent)`,
        }}
      />
    </div>
  );
}

/* ── Main page ─────────────────────────────────────── */
export default function GrindsPage() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <>
      <title>Nam grinds</title>

      <style>{`
        @keyframes slideFromRight {
          from { opacity: 0; transform: translateX(2rem); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideFromLeft {
          from { opacity: 0; transform: translateX(-2rem); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(1rem); }
          to { opacity: 1; transform: translateY(0); }
        }
.grind-card {
          animation-duration: 0.6s;
          animation-fill-mode: both;
          animation-timing-function: ease-out;
        }
        .grind-card-right { animation-name: slideFromRight; }
        .grind-card-left { animation-name: slideFromLeft; }
        .grind-card-mobile { animation-name: slideUp; }
        .grind-card-inner {
          transition: border-color 0.3s, box-shadow 0.3s;
        }
        .grind-org-link {
          color: #e5e2e1;
          text-decoration: none;
          transition: color 0.2s;
        }
        .grind-org-link:hover {
          color: ${ACCENT};
        }
        .grind-card-inner:hover {
          border-color: color-mix(in srgb, ${ACCENT} 50%, #1a1a1a) !important;
          box-shadow: 0 0 20px color-mix(in srgb, ${ACCENT} 15%, transparent);
        }
      `}</style>

      <div
        style={{
          maxWidth: "64rem",
          margin: "0 auto",
          padding: "2rem 1.5rem 6rem",
          position: "relative",
          minHeight: "100vh",
        }}
      >
        {/* Tagline */}
        <div
          style={{
            textAlign: "center",
            marginBottom: "4rem",
            position: "relative",
            zIndex: 2,
          }}
        >
          <p
            style={{
              fontStyle: "italic",
              color: "#666",
              fontSize: "0.9rem",
              letterSpacing: "0.04em",
            }}
          >
            i press buttons to pay rent
          </p>
        </div>

        {/* Desktop: centered timeline */}
        {!isMobile && (
          <div style={{ position: "relative" }}>
            {/* Central trunk */}
            <div
              style={{
                position: "absolute",
                left: "calc(50% - 0.5px)",
                top: 0,
                bottom: 0,
                width: "1px",
                background: `linear-gradient(to bottom, ${ACCENT}60, ${ACCENT}40, ${ACCENT}60, transparent)`,
                boxShadow: `0 0 12px ${ACCENT}20`,
                zIndex: 2,
              }}
            />

            {ENTRIES.map((entry, i) => (
              <TimelineCard key={entry.org} entry={entry} index={i} />
            ))}

            {/* Terminal node */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                paddingTop: "1rem",
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  border: `1.5px solid ${ACCENT}`,
                  background: "transparent",
                  boxShadow: `0 0 8px ${ACCENT}40`,
                }}
              />
            </div>
          </div>
        )}

        {/* Mobile: left-aligned timeline */}
        {isMobile && (
          <div style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute",
                left: "1rem",
                top: 0,
                bottom: 0,
                width: "1px",
                background: `linear-gradient(to bottom, ${ACCENT}60, ${ACCENT}40, ${ACCENT}60, transparent)`,
                boxShadow: `0 0 8px ${ACCENT}20`,
              }}
            />

            {ENTRIES.map((entry, i) => (
              <MobileTimelineCard key={entry.org} entry={entry} index={i} />
            ))}
          </div>
        )}

        {/* Bottom tagline */}
        <div
          style={{
            textAlign: "center",
            marginTop: "3rem",
            position: "relative",
            zIndex: 2,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.65rem",
              color: "#333",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            buttons pressed since 2004
          </span>
        </div>
      </div>
    </>
  );
}
