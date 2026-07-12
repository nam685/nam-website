// Pure math for the home-page background particle field ("the field").
// Framework-free so the core — circle radii, the smooth spotlight aspect, and
// polar↔cartesian mapping — can be unit-tested. The stateful animation loop
// that consumes these lives in components/HomeField.tsx.

export interface FieldParams {
  k1: number; // base radius; r_0 = k1 (nominally 1 so the field starts at the photo edge)
  k2: number; // inverse-gaussian spread of the concentric circles
  eps: number; // angular random-walk std (rad)
  t: number; // spawn cooldown (s)
  s: number; // particle speed (r-units/s) — constant *spatial* speed on spokes and arcs
  e0: number; // spotlight base std (r-units)
  rmax: number; // field extent + spotlight elongation length-scale (r-units)
  rdot: number; // nav-dot ring radius (r-units) — from prod layout: 50% / 37.5%
  N: number; // max concurrent live comets (oldest retires to fade, never blocks spawning)
  keep: number; // max retained fading-trace suites
  hold: number; // seconds a completed trace takes to fade to nothing
  dim: number; // baseline trace brightness away from the spotlight
  gain: number; // spotlight reveal strength
}

// Tuned live in the scratchpad draft, then frozen here.
export const DEFAULT_FIELD_PARAMS: FieldParams = {
  k1: 1,
  k2: 0.04,
  eps: 0.4,
  t: 1,
  s: 1,
  e0: 0.6,
  rmax: 6,
  rdot: 4 / 3, // 1.333…
  N: 10,
  keep: 10,
  hold: 8,
  dim: 0.2,
  gain: 1.6,
};

export const BEAM_MAX_ASPECT = 6; // cap so the beam never diverges past r_max
export const COMET_TAIL = 30; // recent points that stay bright behind a live head

/** Radius of the i-th concentric circle. r_0 = k1; super-exponential spread. */
export function circleRadius(i: number, k1: number, k2: number): number {
  return k1 * Math.exp(k2 * i * i);
}

/**
 * Smooth, saturating radial aspect ratio of the spotlight ellipse.
 * Returns 1 (round) at r_dot and eases toward `E` as r_c → ∞. C¹-continuous
 * everywhere — no foci, no divergence at r_max (r_max only sets the length-scale).
 */
export function beamAspect(rc: number, rdot: number, rmax: number, E = BEAM_MAX_ASPECT): number {
  if (rc <= rdot) return 1;
  const L = Math.max(0.01, (rmax - rdot) / 2);
  return 1 + (E - 1) * (1 - Math.exp(-(rc - rdot) / L));
}

/** Polar (r in photo-radius units, θ: 0 at top, clockwise) → canvas pixels. */
export function polarToXY(
  r: number,
  theta: number,
  cx: number,
  cy: number,
  R: number,
): [number, number] {
  return [cx + Math.sin(theta) * r * R, cy - Math.cos(theta) * r * R];
}

/** Cursor pixel offset from centre → polar (r in units, θ: 0 at top, clockwise). */
export function xyToPolar(dx: number, dy: number, R: number): { r: number; theta: number } {
  return { r: Math.hypot(dx, dy) / R, theta: Math.atan2(dx, -dy) };
}

/** Standard-normal sampler (Box–Muller) carrying its own spare-value state. */
export function makeGaussian(): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
}
