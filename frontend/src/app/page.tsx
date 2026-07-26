"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  DOTS,
  angleFromCenter,
  lerpDotColor,
  dotHueCss,
} from "@/lib/homepageContent";
import { API } from "@/lib/api";
import HomeField from "@/components/HomeField";

export default function Home() {
  // Pick one photo per page load (1..5), stable for the session.
  // Start null to avoid hydration mismatch; choose client-side in effect.
  const [photo, setPhoto] = useState<number | null>(null);
  const ambientRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);

  // Choose photo index client-side only (after hydration).
  useEffect(() => {
    setPhoto(1 + Math.floor(Math.random() * 5));
  }, []);

  useEffect(() => {
    const orbit = orbitRef.current;
    const ambient = ambientRef.current;
    const photoWrap = photoRef.current;
    if (!orbit || !ambient) return;

    function onMove(e: MouseEvent) {
      const rect = orbit!.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const angle = angleFromCenter(dx, dy);
      const [r, g, b] = lerpDotColor(angle);
      ambient!.style.background = `radial-gradient(circle, rgba(${r},${g},${b},0.12) 0%, transparent 70%)`;
      photoWrap?.style.setProperty("--hue", `rgb(${r},${g},${b})`);
    }

    document.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("mousemove", onMove);
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
      {/* Animated particle field (decorative, behind everything) */}
      <HomeField />

      {/* Ambient glow */}
      <div
        ref={ambientRef}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(75vw, 75vh, 420px)",
          height: "min(75vw, 75vh, 420px)",
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

        {/* Center profile photo — diameter = 75% of center→dot distance */}
        <div
          ref={photoRef}
          style={
            {
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "75%",
              height: "75%",
              borderRadius: "50%",
              zIndex: 2,
              "--hue": dotHueCss(0),
              boxShadow: "0 0 24px var(--hue)",
              border: "2px solid var(--hue)",
              transition: "box-shadow 0.2s, border-color 0.2s",
              animation: "fadeIn 0.8s ease-out",
            } as React.CSSProperties
          }
        >
          {photo !== null && (
            <img
              src={`${API}/media/profile/profile-${photo}.webp`}
              alt="Nam"
              onError={(e) => {
                // Photos live on the server media root (outside git/CI); if one is
                // missing, hide the img and let the tinted rim stand on its own.
                e.currentTarget.style.display = "none";
              }}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                borderRadius: "50%",
                display: "block",
              }}
            />
          )}
          {/* Edge tint — recolors the photo's outer ring toward the hue */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, transparent 58%, var(--hue) 100%)",
              mixBlendMode: "overlay",
              transition: "background 0.2s",
              pointerEvents: "none",
            }}
          />
        </div>

        {/* Dots */}
        {DOTS.map((dot) => {
          const rad = (dot.angle * Math.PI) / 180;
          // Round to a fixed precision and emit a plain percentage (not calc())
          // so the SSR and client strings are byte-identical — Math.sin/cos are
          // implementation-defined and differ in their last bit between Node and
          // the browser, which otherwise trips a hydration mismatch.
          const x = (50 + Math.sin(rad) * 50).toFixed(4);
          const y = (50 - Math.cos(rad) * 50).toFixed(4);

          return (
            <Link
              key={dot.href}
              href={dot.href}
              className="constellation-dot"
              style={
                {
                  position: "absolute",
                  top: `${y}%`,
                  left: `${x}%`,
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
