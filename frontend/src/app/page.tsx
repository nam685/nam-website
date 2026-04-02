"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  DOTS,
  angleFromCenter,
  lerpDotColor,
  fetchRandomContent,
  type ContentItem,
} from "@/lib/homepageContent";

export default function Home() {
  const [content, setContent] = useState<ContentItem | null>(null);
  const ambientRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchRandomContent().then(setContent);
  }, []);

  useEffect(() => {
    const orbit = orbitRef.current;
    const ambient = ambientRef.current;
    if (!orbit || !ambient) return;

    function onMove(e: MouseEvent) {
      const rect = orbit!.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const angle = angleFromCenter(dx, dy);
      const color = lerpDotColor(angle);
      ambient!.style.background = `radial-gradient(circle, ${color}10 0%, transparent 70%)`;
    }

    function onLeave() {
      ambient!.style.background =
        "radial-gradient(circle, rgba(255,255,255,0.02) 0%, transparent 70%)";
    }

    orbit.addEventListener("mousemove", onMove);
    orbit.addEventListener("mouseleave", onLeave);
    return () => {
      orbit.removeEventListener("mousemove", onMove);
      orbit.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <main
      style={{
        position: "fixed",
        top: "3.5rem",
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Ambient glow */}
      <div
        ref={ambientRef}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 300,
          height: 300,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,255,255,0.02) 0%, transparent 70%)",
          pointerEvents: "none",
          transition: "background 0.2s",
          zIndex: 0,
        }}
      />

      {/* Orbit */}
      <div
        ref={orbitRef}
        className="orbit-container"
        style={{
          position: "relative",
          width: "min(75vw, 75vh, 420px)",
          height: "min(75vw, 75vh, 420px)",
        }}
      >
        {/* Faint ring */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "1px solid rgba(255,255,255,0.025)",
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />

        {/* Center content */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            maxWidth: "65%",
            textAlign: "center",
            zIndex: 2,
          }}
        >
          {content?.type === "thought" && (
            <div style={{ animation: "fadeIn 0.8s ease-out" }}>
              <p
                style={{
                  fontSize: "clamp(0.9rem, 2.5vw, 1.1rem)",
                  lineHeight: 1.7,
                  color: "#e5e2e1",
                  fontWeight: 300,
                  fontStyle: "italic",
                }}
              >
                &ldquo;{content.text}&rdquo;
              </p>
              <span
                style={{
                  fontFamily: "var(--font-headline)",
                  fontSize: "0.6rem",
                  color: "#333",
                  marginTop: "0.75rem",
                  display: "block",
                  letterSpacing: "0.15em",
                }}
              >
                {content.date}
              </span>
            </div>
          )}
          {content?.type === "drawing" && (
            <div style={{ animation: "fadeIn 0.8s ease-out" }}>
              <img
                src={content.src}
                alt={content.alt}
                style={{
                  maxHeight: 200,
                  maxWidth: "100%",
                  borderRadius: 6,
                  border: "1px solid #1a1a1a",
                  objectFit: "contain",
                }}
              />
            </div>
          )}
          {content?.type === "greeting" && (
            <p
              style={{
                fontSize: "clamp(1.2rem, 3vw, 1.6rem)",
                fontWeight: 300,
                color: "#e5e2e1",
                animation: "fadeIn 0.8s ease-out",
              }}
            >
              {content.text}
            </p>
          )}
        </div>

        {/* Dots */}
        {DOTS.map((dot) => {
          const rad = (dot.angle * Math.PI) / 180;
          const x = Math.sin(rad) * 50;
          const y = -Math.cos(rad) * 50;

          return (
            <Link
              key={dot.href}
              href={dot.href}
              className="constellation-dot"
              style={
                {
                  position: "absolute",
                  top: `calc(50% + ${y}%)`,
                  left: `calc(50% + ${x}%)`,
                  transform: "translate(-50%, -50%)",
                  zIndex: 10,
                  "--pill-color": dot.color,
                } as React.CSSProperties
              }
            >
              <span
                className="constellation-dot-circle"
                style={{
                  display: "block",
                  width: dot.size,
                  height: dot.size,
                  borderRadius: "50%",
                  background: dot.color,
                  boxShadow: `0 0 ${dot.size * 1.5}px ${dot.color}`,
                  animation: `breathe ${dot.breatheDur}s ${dot.breatheDelay}s ease-in-out infinite`,
                }}
              />
              {/* Pill tooltip */}
              <span className="constellation-pill">
                <span
                  style={{
                    fontFamily: "var(--font-headline)",
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: dot.color,
                  }}
                >
                  {dot.label}
                </span>
                <span style={{ fontSize: "0.55rem", color: "#666" }}>
                  {dot.desc}
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      <style>{`
        @keyframes breathe {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .constellation-dot-circle { animation: none !important; opacity: 1; }
        }
        .constellation-dot {
          text-decoration: none;
        }
        .constellation-dot:hover .constellation-dot-circle {
          transform: scale(1.6);
          transition: transform 0.2s;
        }
        .constellation-pill {
          position: absolute;
          left: 50%;
          bottom: calc(100% + 8px);
          transform: translateX(-50%);
          background: #131313;
          border: 1px solid color-mix(in srgb, var(--pill-color, #1a1a1a) 30%, #1a1a1a);
          border-radius: 6px;
          padding: 0.3rem 0.6rem;
          white-space: nowrap;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.25s;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.1rem;
        }
        .constellation-dot:hover .constellation-pill {
          opacity: 1;
        }
        @media (max-width: 480px) {
          .orbit-container {
            width: 85vw !important;
            height: 85vw !important;
          }
          .constellation-pill { display: none !important; }
        }
      `}</style>
    </main>
  );
}
