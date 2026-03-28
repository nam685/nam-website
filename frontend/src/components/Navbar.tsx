"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";

const ITEMS = [
  { label: "writes", href: "/blog", color: "#FF1744" },
  { label: "draws", href: "/gallery", color: "#a855f7" },
  { label: "vibecodes", href: "/projects", color: "#22c55e" },
  { label: "grinds", href: "/cv", color: "#f59e0b" },
];

// Wheel physics: items are on a virtual circle viewed from the side.
// At angle θ from center:   x = R·sin(θ)   scale = cos(θ)   opacity = cos²(θ)
// This compresses spacing and shrinks items as they rotate away — wheel illusion.
const DEG = 14; // degrees between consecutive items — lower = slower size falloff, wider wheel
const R = 310; // px — virtual wheel radius — larger = more generous spacing
const N = ITEMS.length;

// Shortest circular distance — so end wraps back to start seamlessly
function circularD(i: number, center: number) {
  let d = i - center;
  if (d > N / 2) d -= N;
  if (d < -N / 2) d += N;
  return d;
}

function wheelTransform(d: number) {
  const θ = d * DEG * (Math.PI / 180);
  return {
    x: R * Math.sin(θ),
    scale: Math.max(0.05, Math.cos(θ)),
    opacity: Math.max(0, Math.cos(θ) ** 2),
  };
}

export default function Navbar() {
  const pathname = usePathname();
  const [center, setCenter] = useState(0);
  const touchStartX = useRef<number | null>(null);

  // Auto-sync wheel to current page
  useEffect(() => {
    const idx = ITEMS.findIndex(
      (it) => pathname === it.href || pathname.startsWith(it.href + "/"),
    );
    if (idx !== -1) setCenter(idx);
  }, [pathname]);

  function shift(dir: -1 | 1) {
    setCenter((c) => (c + dir + N) % N);
  }

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        height: "3.5rem",
        background: "#0e0e0e",
        borderBottom: "2px solid #FF1744",
        boxShadow: "0 2px 16px rgba(255,23,68,0.1)",
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0 1rem",
      }}
    >
      {/* Logo */}
      <Link
        href="/"
        style={{
          fontFamily: "var(--font-headline)",
          fontWeight: 900,
          fontSize: "1rem",
          color: "#FF1744",
          textShadow: "0 0 8px rgba(255,23,68,0.4)",
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap",
          flexShrink: 0,
          userSelect: "none",
        }}
      >
        [Nam]
      </Link>

      <div
        style={{
          width: 1,
          height: "1.25rem",
          background: "#2a2a2a",
          flexShrink: 0,
        }}
      />

      {/* Left chevron */}
      <button
        onClick={() => shift(-1)}
        aria-label="Previous"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#FF1744",
          fontSize: "1.25rem",
          lineHeight: 1,
          padding: "0 0.15rem",
          flexShrink: 0,
          transition: "color 0.15s",
          userSelect: "none",
        }}
      >
        ‹
      </button>

      {/* Wheel viewport */}
      <div
        style={{
          position: "relative",
          flex: 1,
          height: "100%",
          overflow: "hidden",
        }}
        onTouchStart={(e) => {
          touchStartX.current = e.touches[0].clientX;
        }}
        onTouchEnd={(e) => {
          if (touchStartX.current === null) return;
          const dx = touchStartX.current - e.changedTouches[0].clientX;
          if (Math.abs(dx) > 40) shift(dx > 0 ? 1 : -1);
          touchStartX.current = null;
        }}
      >
        {ITEMS.map((item, i) => {
          const d = circularD(i, center);
          const { x, scale, opacity } = wheelTransform(d);
          if (opacity < 0.03) return null;

          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setCenter(i)}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: `translate(calc(-50% + ${x}px), -50%) scale(${scale})`,
                transition:
                  "transform 0.4s cubic-bezier(0.23,1,0.32,1), opacity 0.4s cubic-bezier(0.23,1,0.32,1)",
                opacity,
                color: isActive ? item.color : "#9ca3af",
                fontFamily: "var(--font-headline)",
                fontWeight: 700,
                fontSize: "0.75rem",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                userSelect: "none",
                pointerEvents: opacity > 0.15 ? "auto" : "none",
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Right chevron */}
      <button
        onClick={() => shift(1)}
        aria-label="Next"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#FF1744",
          fontSize: "1.25rem",
          lineHeight: 1,
          padding: "0 0.15rem",
          flexShrink: 0,
          transition: "color 0.15s",
          userSelect: "none",
        }}
      >
        ›
      </button>
    </nav>
  );
}
