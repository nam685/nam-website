// Pure nav-wheel logic — extracted so it can be unit-tested without a DOM.

export const NAV_ITEMS = [
  { label: "thinks", href: "/thinks", accent: "#FF1744" },
  { label: "draws", href: "/draws", accent: "#a855f7" },
  { label: "codes", href: "/codes", accent: "#22c55e" },
  { label: "grinds", href: "/grinds", accent: "#f59e0b" },
  { label: "listens", href: "/listens", accent: "#f97316" },
  { label: "reads", href: "/reads", accent: "#94a3b8" },
  { label: "plays", href: "/plays", accent: "#06b6d4" },
  { label: "watches", href: "/watches", accent: "#1e40af" },
  { label: "bets", href: "/bets", accent: "#db2777" },
  { label: "slops", href: "/slops", accent: "#39ff14" },
] as const;

export const NAV_DEG = 30;
export const NAV_DEG_MOBILE = 90;
export const SPRING_FACTOR = 0.18;
export const SPRING_THRESHOLD = 0.005;

/** Shortest circular distance from item i to float center (works for spring). */
export function circularD(i: number, center: number, n: number): number {
  let d = i - center;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
}

/**
 * Visual transform for a wheel item at circular distance d from center.
 * r = radius in pixels (responsive to container width).
 * Desktop (deg=30): 5 visible items. Mobile (deg=90): center only.
 */
export function wheelTransform(d: number, r: number, deg = NAV_DEG) {
  const θ = d * deg * (Math.PI / 180);
  const cosθ = Math.cos(θ);
  // Scale uses sqrt(cos) so edge items (d=±2) are ~0.84x, not 0.5x.
  // This keeps edge labels readable — only slightly smaller than center.
  const clampedCos = Math.max(0, cosθ);
  return {
    x: r * Math.sin(θ),
    scale: Math.max(0.05, Math.sqrt(clampedCos)),
    opacity: clampedCos,
  };
}

/**
 * One spring step: moves vc toward target along shortest circular arc.
 * Returns new vc, already wrapped to [0, n).
 */
export function springStep(vc: number, target: number, n: number): number {
  let delta = target - vc;
  if (delta > n / 2) delta -= n;
  if (delta < -n / 2) delta += n;
  return (((vc + delta * SPRING_FACTOR) % n) + n) % n;
}

/** One step of the circular arrow shift. */
export function shiftCenter(center: number, dir: -1 | 1, n: number): number {
  return (center + dir + n) % n;
}
