// Pure math for the home-page background particle field ("the field").
// Framework-free so the core — polar↔cartesian mapping — can be unit-tested.
// The stateful animation loop that consumes these lives in components/HomeField.tsx.

export interface FieldParams {
  k1: number; // spawn radius (r-units); r_0 = k1, nominally the photo edge
  t: number; // spawn cooldown (s)
  s: number; // constant outward speed (r-units/s)
  rmax: number; // ray length before a comet retires
  N: number; // max concurrent live comets (oldest retires to fade, never blocks spawning)
  hold: number; // seconds a completed trace takes to fade to nothing
  dim: number; // baseline trace brightness
}

// Tuned live in the scratchpad draft, then frozen here.
export const DEFAULT_FIELD_PARAMS: FieldParams = {
  k1: 1,
  t: 1,
  s: 1,
  rmax: 6,
  N: 10,
  hold: 8,
  dim: 0.2,
};

export const COMET_TAIL = 30; // recent points that stay bright behind a live head

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
