/** Accent color used across the codes page */
export const CONTRIB_ACCENT = "#22c55e";

/**
 * Maps a contribution count to a CSS color string.
 * 0 = dark bg, higher counts = more saturated accent.
 */
export function getContribColor(count: number): string {
  if (count === 0) return "#161b22";
  if (count <= 2) return `color-mix(in srgb, ${CONTRIB_ACCENT} 25%, #0e0e0e)`;
  if (count <= 5) return `color-mix(in srgb, ${CONTRIB_ACCENT} 45%, #0e0e0e)`;
  if (count <= 10) return `color-mix(in srgb, ${CONTRIB_ACCENT} 65%, #0e0e0e)`;
  return CONTRIB_ACCENT;
}
