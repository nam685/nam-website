// Pure nav-wheel logic — extracted so it can be unit-tested without a DOM.

export const NAV_DEG = 14;
export const NAV_R = 310;
export const SPRING_FACTOR = 0.18;
export const SPRING_THRESHOLD = 0.005;

/** Shortest circular distance from item i to float center (works for spring). */
export function circularD(i: number, center: number, n: number): number {
  let d = i - center;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
}

/** Visual transform for a wheel item at circular distance d from center. */
export function wheelTransform(d: number) {
  const θ = d * NAV_DEG * (Math.PI / 180);
  return {
    x: NAV_R * Math.sin(θ),
    scale: Math.max(0.05, Math.cos(θ)),
    opacity: Math.max(0, Math.cos(θ) ** 2),
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
