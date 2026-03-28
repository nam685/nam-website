"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";

const ITEMS = [
  { label: "writes", href: "/blog", accent: "#FF1744" },
  { label: "draws", href: "/gallery", accent: "#a855f7" },
  { label: "vibecodes", href: "/projects", accent: "#22c55e" },
  { label: "grinds", href: "/cv", accent: "#f59e0b" },
  // Future items — uncomment when content is ready:
  // { label: "listens", href: "/listens", accent: "#06b6d4" },
  // { label: "reads", href: "/reads", accent: "#84cc16" },
  // { label: "plays", href: "/plays", accent: "#f97316" },
  // { label: "watches", href: "/watches", accent: "#ec4899" },
  // { label: "bets", href: "/bets", accent: "#eab308" },
];

// Wheel physics: items on a virtual circle viewed from the side.
// x = R·sin(θ)   scale = cos(θ)   opacity = cos²(θ)
const DEG = 14;
const R = 310;
const N = ITEMS.length;

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

function applyAccent(accent: string) {
  document.documentElement.style.setProperty("--accent", accent);
}

export default function Navbar() {
  const pathname = usePathname();
  const [center, setCenter] = useState(() => {
    const idx = ITEMS.findIndex(
      (it) => pathname === it.href || pathname.startsWith(it.href + "/"),
    );
    return idx !== -1 ? idx : 0;
  });
  const touchStartX = useRef<number | null>(null);

  // Sync wheel position and page accent to current route
  useEffect(() => {
    const idx = ITEMS.findIndex(
      (it) => pathname === it.href || pathname.startsWith(it.href + "/"),
    );
    if (idx !== -1) {
      setCenter(idx);
      applyAccent(ITEMS[idx].accent);
    } else {
      applyAccent(ITEMS[center].accent);
    }
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  function shift(dir: -1 | 1) {
    const next = (center + dir + N) % N;
    setCenter(next);
    applyAccent(ITEMS[next].accent);
  }

  const accentOf = (i: number) => ITEMS[i].accent;

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        height: "3.5rem",
        background: "#0e0e0e",
        borderBottom: "2px solid var(--accent)",
        boxShadow:
          "0 2px 20px color-mix(in srgb, var(--accent) 18%, transparent)",
        display: "flex",
        alignItems: "center",
        gap: "0.25rem",
        padding: "0 0.75rem",
        transition: "border-color 0.4s, box-shadow 0.4s",
      }}
    >
      {/* Logo */}
      <Link
        href="/"
        style={{
          fontFamily: "var(--font-headline)",
          fontWeight: 900,
          fontSize: "1rem",
          color: "var(--accent)",
          textShadow:
            "0 0 8px color-mix(in srgb, var(--accent) 50%, transparent)",
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap",
          flexShrink: 0,
          userSelect: "none",
          transition: "color 0.4s, text-shadow 0.4s",
          padding: "0 0.25rem",
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

      {/* Left chevron — min 44px touch target */}
      <button
        onClick={() => shift(-1)}
        aria-label="Previous"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--accent)",
          fontSize: "1.4rem",
          lineHeight: 1,
          flexShrink: 0,
          transition: "color 0.4s",
          userSelect: "none",
          minWidth: "2.75rem",
          height: "3.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
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
          const isCentered = i === center;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => {
                setCenter(i);
                applyAccent(item.accent);
              }}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: `translate(calc(-50% + ${x}px), -50%) scale(${scale})`,
                transition:
                  "transform 0.4s cubic-bezier(0.23,1,0.32,1), opacity 0.4s cubic-bezier(0.23,1,0.32,1), color 0.3s",
                opacity,
                color: isActive || isCentered ? accentOf(i) : "#9ca3af",
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

      {/* Right chevron — min 44px touch target */}
      <button
        onClick={() => shift(1)}
        aria-label="Next"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--accent)",
          fontSize: "1.4rem",
          lineHeight: 1,
          flexShrink: 0,
          transition: "color 0.4s",
          userSelect: "none",
          minWidth: "2.75rem",
          height: "3.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ›
      </button>
    </nav>
  );
}
