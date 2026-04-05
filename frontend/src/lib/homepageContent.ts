import { API, type Thought, type Drawing } from "@/lib/api";

/* ── Dot data ─────────────────────────────────────────── */

export interface Dot {
  label: string;
  href: string;
  color: string;
  size: number;
  angle: number; // degrees, 0 = top, clockwise
  desc: string;
  breatheDur: number; // seconds
  breatheDelay: number; // seconds
}

export const DOTS: Dot[] = [
  // Ordered by color wavelength (hue angle) — creates a smooth rainbow around the orbit
  { label: "listens", href: "/listens", color: "#f97316", size: 7, angle: 0, desc: "vibing...", breatheDur: 4.4, breatheDelay: 0.6 },
  { label: "grinds", href: "/grinds", color: "#f59e0b", size: 8, angle: 36, desc: "i press buttons to pay rent", breatheDur: 3.5, breatheDelay: 1.2 },
  { label: "codes", href: "/codes", color: "#22c55e", size: 9, angle: 72, desc: "i embrace the slop", breatheDur: 4.1, breatheDelay: 0.8 },
  { label: "slops", href: "/slops", color: "#39ff14", size: 8, angle: 108, desc: "handmade slop machine", breatheDur: 3.7, breatheDelay: 1.1 },
  { label: "plays", href: "/plays", color: "#06b6d4", size: 9, angle: 144, desc: "i spent waaay too much time on this", breatheDur: 3.6, breatheDelay: 0.3 },
  { label: "reads", href: "/reads", color: "#94a3b8", size: 7, angle: 180, desc: "i know many words", breatheDur: 3.9, breatheDelay: 1.5 },
  { label: "watches", href: "/watches", color: "#1e40af", size: 8, angle: 216, desc: "at least i don't doom scroll facebook et al.", breatheDur: 4.2, breatheDelay: 1.0 },
  { label: "draws", href: "/draws", color: "#a855f7", size: 10, angle: 252, desc: "eye candy!", breatheDur: 3.8, breatheDelay: 0.4 },
  { label: "bets", href: "/bets", color: "#db2777", size: 8, angle: 288, desc: "i look here to feel very smart", breatheDur: 3.4, breatheDelay: 0.7 },
  { label: "thinks", href: "/thinks", color: "#FF1744", size: 11, angle: 324, desc: "sometimes, some of my neurons fire", breatheDur: 3.2, breatheDelay: 0 },
];

/* ── Angle + color math ───────────────────────────────── */

/** Angle in degrees (0° = top, clockwise) from dx/dy relative to center. */
export function angleFromCenter(dx: number, dy: number): number {
  const rad = Math.atan2(dx, -dy);
  return ((rad * 180) / Math.PI + 360) % 360;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Interpolate between dot colors based on angle (0–360°). Returns [r, g, b]. */
export function lerpDotColor(angle: number): [number, number, number] {
  const a = ((angle % 360) + 360) % 360;
  const sectorSize = 360 / DOTS.length;
  const sector = a / sectorSize;
  const i = Math.floor(sector) % DOTS.length;
  const j = (i + 1) % DOTS.length;
  const t = sector - Math.floor(sector);

  const [r1, g1, b1] = hexToRgb(DOTS[i].color);
  const [r2, g2, b2] = hexToRgb(DOTS[j].color);

  return [
    Math.round(r1 + (r2 - r1) * t),
    Math.round(g1 + (g2 - g1) * t),
    Math.round(b1 + (b2 - b1) * t),
  ];
}

/* ── Random center content ────────────────────────────── */

export const GREETINGS = [
  "hey",
  "welcome back",
  "you found me",
  "nice to see you",
  "come on in",
  "hello, friend",
  "what's up",
  "good to see you",
];

export type ContentItem =
  | { type: "thought"; text: string; date: string }
  | { type: "drawing"; src: string; alt: string }
  | { type: "greeting"; text: string };

export async function fetchRandomContent(): Promise<ContentItem> {
  const types = ["thought", "drawing", "greeting"] as const;
  const chosen = types[Math.floor(Math.random() * types.length)];

  try {
    if (chosen === "thought") {
      const res = await fetch(`${API}/api/thoughts/?page=1`);
      if (!res.ok) throw new Error();
      const data: { thoughts: Thought[] } = await res.json();
      if (data.thoughts.length === 0) throw new Error();
      const t = data.thoughts[Math.floor(Math.random() * data.thoughts.length)];
      return { type: "thought", text: t.content, date: t.created_at.slice(0, 10) };
    }

    if (chosen === "drawing") {
      const res = await fetch(`${API}/api/drawings/`);
      if (!res.ok) throw new Error();
      const drawings: Drawing[] = await res.json();
      if (drawings.length === 0) throw new Error();
      const d = drawings[Math.floor(Math.random() * drawings.length)];
      return { type: "drawing", src: `${API}${d.image}`, alt: d.caption || "drawing" };
    }
  } catch {
    // fall through to greeting
  }

  const text = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  return { type: "greeting", text };
}
