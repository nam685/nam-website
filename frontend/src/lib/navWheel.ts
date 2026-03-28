// Pure nav-wheel logic — extracted so it can be unit-tested without a DOM.

export const NAV_DEG = 30;
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
 * With DEG=30, items at d=±2 have opacity 0.5, d=±3 have opacity 0.
 * This gives exactly 5 clearly visible items.
 */
export function wheelTransform(d: number, r: number) {
  const θ = d * NAV_DEG * (Math.PI / 180);
  const cosθ = Math.cos(θ);
  return {
    x: r * Math.sin(θ),
    scale: Math.max(0.05, cosθ),
    opacity: Math.max(0, cosθ),
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
