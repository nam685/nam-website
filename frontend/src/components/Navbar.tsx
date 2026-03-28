"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  SPRING_THRESHOLD,
  circularD,
  shiftCenter,
  springStep,
  wheelTransform,
} from "@/lib/navWheel";

const ITEMS = [
  { label: "thinks", href: "/thinks", accent: "#FF1744" },
  { label: "draws", href: "/draws", accent: "#a855f7" },
  { label: "codes", href: "/codes", accent: "#22c55e" },
  { label: "grinds", href: "/grinds", accent: "#f59e0b" },
  { label: "listens", href: "/listens", accent: "#f97316" },
  { label: "reads", href: "/reads", accent: "#94a3b8" },
  { label: "plays", href: "/plays", accent: "#06b6d4" },
  { label: "watches", href: "/watches", accent: "#1e40af" },
  { label: "bets", href: "/bets", accent: "#db2777" },
];

const N = ITEMS.length;

function applyAccent(accent: string) {
  document.documentElement.style.setProperty("--accent", accent);
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();

  const [center, setCenter] = useState(() => {
    const idx = ITEMS.findIndex(
      (it) => pathname === it.href || pathname.startsWith(it.href + "/"),
    );
    return idx !== -1 ? idx : 0;
  });

  const visualCenter = useRef<number>(center);
  const [, rerender] = useState(0);
  const rafRef = useRef<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const [radius, setRadius] = useState(310);

  // Measure wheel container width → derive radius
  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setRadius(Math.min(Math.max(entry.contentRect.width * 0.35, 80), 450));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Spring: animate visualCenter toward center along the shortest circular arc
  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    const tick = () => {
      const vc = visualCenter.current;
      const d = circularD(center, vc, N);
      if (Math.abs(d) < SPRING_THRESHOLD) {
        visualCenter.current = center;
        rerender((n) => n + 1);
        return;
      }
      visualCenter.current = springStep(vc, center, N);
      rerender((n) => n + 1);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [center]);

  // Sync wheel position and accent to current route.
  const centerRef = useRef(center);
  centerRef.current = center;

  useEffect(() => {
    const idx = ITEMS.findIndex(
      (it) => pathname === it.href || pathname.startsWith(it.href + "/"),
    );
    if (idx !== -1) {
      setCenter(idx);
      applyAccent(ITEMS[idx].accent);
    } else {
      applyAccent(ITEMS[centerRef.current].accent);
    }
  }, [pathname]);

  function shift(dir: -1 | 1) {
    const next = shiftCenter(center, dir, N);
    setCenter(next);
    applyAccent(ITEMS[next].accent);
    router.push(ITEMS[next].href);
  }

  const vc = visualCenter.current;

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

      <div
        ref={wheelRef}
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
          const d = circularD(i, vc, N);
          const { x, scale, opacity } = wheelTransform(d, radius);

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
                transition: "color 0.3s",
                opacity,
                color: isCentered ? item.accent : "#9ca3af",
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
