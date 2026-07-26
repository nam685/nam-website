export type Aoe2MatchSummary = {
  id: number;
  played_at: string | null;
  map_name: string;
  duration_seconds: number;
  my_civ: string;
  opponent_civ: string;
  my_result: string;
  my_elo: number | null;
  my_rating_change: number | null;
  opening: string;
  featured: boolean;
  clip_url: string;
};

// ---------------------------------------------------------------------------
// Build-order reference library (public /plays/aoe2/builds) — types + helpers
// ---------------------------------------------------------------------------

export type BuildPhase = "dark_age" | "feudal" | "castle" | "imperial";

export type BuildStep = {
  phase: BuildPhase;
  vils?: number;
  task: string;
  pop?: number;
};

export type BuildAgeTarget = {
  arrival_s: number | null;
  vils_at_click?: number | null;
};

export type BuildSummary = {
  id: string;
  name: string;
  family: string;
  summary: string;
};

export type BuildDetail = {
  id: string;
  name: string;
  family: string;
  source: { guide: string; page: number | null };
  recommended_civs: string[];
  summary: string;
  age_targets: {
    feudal?: BuildAgeTarget;
    castle?: BuildAgeTarget;
    imperial?: BuildAgeTarget;
  };
  eco_split?: Record<string, Record<string, number | null>>;
  steps: BuildStep[];
  whats_next: string[];
  signature?: Record<string, unknown>;
};

// Family slug → human label + ordering for the library index. Slugs come straight from the
// aoe2coach build YAMLs (scouts/archers/maa/drush/knights/fast_castle/trash/drush_fc).
export const BUILD_FAMILY_LABELS: Record<string, string> = {
  scouts: "Scouts",
  archers: "Archers",
  maa: "Men-at-Arms",
  drush: "Drush",
  knights: "Knights",
  fast_castle: "Fast Castle",
  drush_fc: "Drush → Fast Castle",
  trash: "Trash",
};

const BUILD_FAMILY_ORDER = [
  "scouts",
  "archers",
  "maa",
  "drush",
  "knights",
  "fast_castle",
  "drush_fc",
  "trash",
];

export function buildFamilyLabel(family: string): string {
  return BUILD_FAMILY_LABELS[family] ?? family;
}

export type BuildFamilyGroup = {
  family: string;
  label: string;
  builds: BuildSummary[];
};

/**
 * Group the flat build list by family, in the canonical family order (unknown families sorted
 * alphabetically after the known ones). Builds within a family keep their incoming order.
 */
export function groupBuildsByFamily(
  builds: BuildSummary[],
): BuildFamilyGroup[] {
  const byFamily = new Map<string, BuildSummary[]>();
  for (const b of builds) {
    const arr = byFamily.get(b.family) ?? [];
    arr.push(b);
    byFamily.set(b.family, arr);
  }
  const families = [...byFamily.keys()].sort((a, b) => {
    const ia = BUILD_FAMILY_ORDER.indexOf(a);
    const ib = BUILD_FAMILY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return families.map((family) => ({
    family,
    label: buildFamilyLabel(family),
    builds: byFamily.get(family) ?? [],
  }));
}

export const BUILD_PHASE_LABELS: Record<BuildPhase, string> = {
  dark_age: "Dark Age",
  feudal: "Feudal Age",
  castle: "Castle Age",
  imperial: "Imperial Age",
};

const BUILD_PHASE_ORDER: BuildPhase[] = [
  "dark_age",
  "feudal",
  "castle",
  "imperial",
];

export type BuildLane = {
  phase: BuildPhase;
  label: string;
  steps: BuildStep[];
};

/** Split steps into ordered phase lanes for the timeline graphic (empty phases dropped). */
export function buildPhaseLanes(steps: BuildStep[]): BuildLane[] {
  return BUILD_PHASE_ORDER.map((phase) => ({
    phase,
    label: BUILD_PHASE_LABELS[phase],
    steps: steps.filter((s) => s.phase === phase),
  })).filter((lane) => lane.steps.length > 0);
}

// Keyword → aoe2coach icon NAME (the key into AOE2_ICON_BY_NAME). Ordered longest/most-specific
// first so e.g. "cavalry archer" wins over "archer", "scout cavalry" over "cavalry". The icon
// component falls back to a monogram glyph for any task with no keyword hit.
const STEP_ICON_RULES: { re: RegExp; icon: string }[] = [
  // Buildings
  { re: /archery range/i, icon: "Archery Range" },
  { re: /blacksmith/i, icon: "Blacksmith" },
  { re: /monaster|monk/i, icon: "Monastery" },
  { re: /market/i, icon: "Market" },
  { re: /\bstable/i, icon: "Stable" },
  { re: /town cent|\btc\b|2nd tc|second tc|third tc/i, icon: "Town Center" },
  // Units (specific → general)
  { re: /cavalry archer|cav archer/i, icon: "Cavalry Archer" },
  { re: /\bskirm/i, icon: "Skirmisher" },
  { re: /\bknight/i, icon: "Knight" },
  { re: /scout cavalry|\bscout/i, icon: "Light Cavalry" },
  { re: /man-at-arms|man at arms|\bmaa\b/i, icon: "Militia" },
  { re: /\bmilitia/i, icon: "Militia" },
  { re: /crossbow/i, icon: "Crossbowman" },
  { re: /\barcher/i, icon: "Archer" },
  { re: /\bspear/i, icon: "Spearman" },
  // Techs / ages
  { re: /fletching/i, icon: "Fletching" },
  { re: /\bloom\b/i, icon: "Loom" },
  { re: /bloodlines|forging|armor|barding/i, icon: "Blacksmith" },
  { re: /to feudal|click up|click to feudal|feudal age/i, icon: "Feudal Age" },
  { re: /to castle|castle age|fast castle|boom/i, icon: "Castle Age" },
  { re: /imperial/i, icon: "Imperial Age" },
  // Eco fallbacks
  { re: /villager|sheep|wood|gold|farm|boar|lure|eco/i, icon: "Villager" },
];

/**
 * Map a build step's task text to the aoe2coach icon NAME to render (pass to AOE2_ICON_BY_NAME /
 * aoe2IconUrl). Returns null when nothing recognisable matches → the UI shows the monogram glyph.
 * Pure + deterministic — first matching rule wins (rules are ordered specific→general).
 */
export function stepIconName(task: string): string | null {
  if (!task) return null;
  for (const rule of STEP_ICON_RULES) {
    if (rule.re.test(task)) return rule.icon;
  }
  return null;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, "0")}`;
}

export function resultLabel(result: string): string {
  if (result === "win") return "Victory";
  if (result === "loss") return "Defeat";
  return "—";
}

const OPENING_COLORS: Record<string, string> = {
  Scouts: "#f59e0b",
  Archers: "#06b6d4",
  "M@A → Archers": "#a855f7",
  Drush: "#ef4444",
  "Fast Castle": "#22c55e",
  "Tower Rush": "#eab308",
  Other: "#64748b",
};

export function openingColor(opening: string): string {
  return OPENING_COLORS[opening] ?? "#64748b";
}

/**
 * Standardize an opening tag for DISPLAY: drop `-`/`_` separators (→ spaces) and capitalize the first
 * letter of each word, leaving any existing capitals intact. e.g. "fast_castle" → "Fast Castle",
 * "scouts into knights" → "Scouts Into Knights", "archers (1-range)" → "Archers (1 Range)". Pass the
 * RAW tag to openingColor (which keys off the raw value); only the rendered text is formatted.
 */
export function formatOpening(opening: string | null | undefined): string {
  if (!opening) return "";
  return opening
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => w.replace(/[A-Za-z]/, (c) => c.toUpperCase())) // capitalize each word's first letter
    .join(" ");
}

export function gameSharePath(id: number): string {
  return `/plays/aoe2?game=${id}`;
}

/**
 * Convert a YouTube/Twitch watch URL to its embeddable form.
 *
 * Supported inputs:
 *   youtube.com/watch?v=VIDEO_ID         → youtube.com/embed/VIDEO_ID
 *   youtu.be/VIDEO_ID                    → youtube.com/embed/VIDEO_ID
 *   twitch.tv/videos/VOD_ID              → player.twitch.tv/?video=VOD_ID&parent=<hostname>
 *   clips.twitch.tv/CLIP_SLUG           → player.twitch.tv/?clip=CLIP_SLUG&parent=<hostname>
 *   twitch.tv/<channel>/clip/CLIP_SLUG  → player.twitch.tv/?clip=CLIP_SLUG&parent=<hostname>
 *
 * Returns the original URL unchanged if it doesn't match any recognised pattern
 * (e.g. it is already an embed URL, or uses an unsupported host).
 *
 * The optional `hostname` parameter is used as the `parent` domain for Twitch
 * embeds (required by Twitch's embed API).  Defaults to "localhost".
 */
export function clipEmbedUrl(url: string, hostname = "localhost"): string {
  if (!url) return url;

  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    // YouTube
    if (host === "youtube.com" && u.pathname === "/watch") {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
    }
    if (host === "youtu.be") {
      const v = u.pathname.slice(1); // remove leading "/"
      if (v) return `https://www.youtube.com/embed/${v}`;
    }

    // Twitch VOD
    if (host === "twitch.tv" && u.pathname.startsWith("/videos/")) {
      const vodId = u.pathname.replace("/videos/", "");
      if (vodId)
        return `https://player.twitch.tv/?video=${vodId}&parent=${hostname}`;
    }

    // Twitch clip — clips.twitch.tv/<slug>
    if (host === "clips.twitch.tv") {
      const slug = u.pathname.slice(1);
      if (slug)
        return `https://player.twitch.tv/?clip=${slug}&parent=${hostname}`;
    }

    // Twitch clip — twitch.tv/<channel>/clip/<slug>
    if (host === "twitch.tv") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 3 && parts[1] === "clip") {
        return `https://player.twitch.tv/?clip=${parts[2]}&parent=${hostname}`;
      }
    }
  } catch {
    // Invalid URL — return as-is.
  }

  return url;
}

// ---------------------------------------------------------------------------
// aoe2coach v2 viz (sub-project #5) — types + pure helpers (tested in vitest)
// ---------------------------------------------------------------------------

export type DataTier = "exact" | "est" | "unavailable";

export type MapPoint = { x: number; y: number };
export type MapBuilding = { name: string; x: number; y: number; t_s?: number };
export type MapWall = { x: number; y: number; x_end: number; y_end: number };
export type MapEngagement = {
  zone?: string;
  x: number;
  y: number;
  n_commands?: number;
  start_s?: number;
};

export type MapGeometry = {
  map_name?: string;
  map_dim?: number | null;
  duration_s?: number | null;
  me?: {
    base_centroid?: MapPoint | null;
    buildings?: MapBuilding[];
    forward?: MapBuilding[];
    walls?: MapWall[];
  };
  opp?: {
    base_centroid?: MapPoint | null;
    buildings?: MapBuilding[];
    walls?: MapWall[];
  };
  engagements?: MapEngagement[];
};

export type Reconstruction = {
  meta?: Record<string, unknown>;
  ages?: Record<string, number | null | Record<string, unknown>>;
  techs?: {
    eco?: { name: string; t_s: number }[];
    military?: { name: string; t_s: number }[];
    university?: { name: string; t_s: number }[];
  };
  production?: {
    milestones?: Record<string, unknown>;
    produced_units?: {
      name: string;
      unit_id?: number;
      amount?: number;
      t_s: number;
    }[];
    villager_curve?: { t_s: number; villagers: number }[];
  };
  counts?: {
    villagers_produced?: number;
    army_produced?: { name: string; amount: number }[];
  };
  efficiency?: {
    tc_idle_s?: number | null;
    precap_window_s?: number | null;
    longest_villager_gap_s?: number | null;
    apm_total?: number | null;
    apm_eco?: number | null;
    apm_military?: number | null;
  };
};

export type Candidate = {
  build_id: string;
  name: string;
  confidence: number;
  matched_signals?: string[];
  missed_signals?: string[];
};
export type Classifier = {
  candidates?: Candidate[];
  is_confident?: boolean;
  unknown?: boolean;
  notes?: string[];
};

export type Mistake = {
  id: string;
  name: string;
  severity: string;
  confidence_tier?: string;
  magnitude?: number;
  observed?: Record<string, unknown>;
  explanation?: string;
  fix?: string;
  source?: {
    ref?: string;
    detail?: string;
    study?: { url?: string; title?: string };
  };
};

// --- aoe2coach v2 economy: TWO never-conflated blocks (worker COUNTS vs resource SPENDING) ---
export type WorkerAgeSnap = {
  estimate?: boolean;
  unit?: string;
  villagers_present?: number;
  fishing_workers?: number;
  workers_present?: number;
  n_attributed?: number;
  alloc?: Record<string, number>; // villager COUNTS per resource
  shares?: Record<string, number>;
} | null;

// One point of the continuous worker-allocation series (indexed by villager count).
export type WorkerAllocPoint = {
  vils: number;
  t_s: number;
  alloc: Record<string, number>; // worker COUNTS per resource (sums to vils on land)
  active_farms: number; // reseed-excluded distinct farms active at t_s (drives the food line)
  fishing: number;
};

export type WorkerAllocation = {
  unit?: string;
  tier?: string;
  estimate?: boolean;
  per_age?: {
    feudal?: WorkerAgeSnap;
    castle?: WorkerAgeSnap;
    imperial?: WorkerAgeSnap;
  };
  series?: WorkerAllocPoint[];
  mid_game_share?: Record<string, number>;
  fishing_workers_total?: number;
  active_farms?: number;
  note?: string;
};

export type FloatingFlag = {
  resource: string;
  worker_share: number;
  spend_share: number;
  excess: number;
};
export type ResourceBalance = {
  unit?: string;
  tier?: string;
  estimate?: boolean;
  spent_by_resource?: Record<string, number>; // resource AMOUNTS spent
  spend_share?: Record<string, number>;
  series?: ResourceBalancePoint[];
  floating?: {
    estimate?: boolean;
    flags?: FloatingFlag[];
    worker_share?: Record<string, number>;
    spend_share?: Record<string, number>;
    basis?: string;
  };
  collected?: Record<string, unknown> | null; // suppressed by design (null)
  relic_gold?: string; // "unavailable"
  note?: string;
};

// One point of the continuous resource-balance series (cumulative spend; indexed by t_s).
export type ResourceBalancePoint = {
  vils: number;
  t_s: number;
  spent: Record<string, number>; // cumulative near-exact resource AMOUNTS spent by t_s
  floating?: Record<string, number>; // estimated floating (gathered-but-unspent) signal by t_s
};

export type Economy = {
  estimate?: boolean;
  unavailable?: boolean;
  worker_allocation?: WorkerAllocation;
  resource_balance?: ResourceBalance;
  qualitative?: {
    committed_first?: string | null;
    gold_mining_start_s?: number | null;
    eco_techs?: string[];
    note?: string;
  };
  note?: string;
};

export type ViewBox = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

/**
 * Auto-fit an SVG viewBox over all building/wall coords (game tile units), with a margin.
 * Guards empty input and zero-extent (single point) — falls back to a sane default box so the
 * minimap never produces a degenerate (0-width) viewBox. `mapDim`, when given, bounds the box.
 */
export function fitMapViewBox(
  buildings: { x: number; y: number }[],
  walls: { x: number; y: number; x_end: number; y_end: number }[],
  margin = 4,
  mapDim?: number | null,
): ViewBox {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const b of buildings) {
    if (Number.isFinite(b.x) && Number.isFinite(b.y)) {
      xs.push(b.x);
      ys.push(b.y);
    }
  }
  for (const w of walls) {
    if (Number.isFinite(w.x) && Number.isFinite(w.y)) {
      xs.push(w.x);
      ys.push(w.y);
    }
    if (Number.isFinite(w.x_end) && Number.isFinite(w.y_end)) {
      xs.push(w.x_end);
      ys.push(w.y_end);
    }
  }
  if (xs.length === 0) {
    const dim = mapDim && mapDim > 0 ? mapDim : 120;
    return { minX: 0, minY: 0, width: dim, height: dim };
  }
  let minX = Math.min(...xs) - margin;
  let minY = Math.min(...ys) - margin;
  let maxX = Math.max(...xs) + margin;
  let maxY = Math.max(...ys) + margin;
  // Clamp into [0, mapDim] when a map dimension is known.
  if (mapDim && mapDim > 0) {
    minX = Math.max(0, minX);
    minY = Math.max(0, minY);
    maxX = Math.min(mapDim, maxX);
    maxY = Math.min(mapDim, maxY);
  }
  let width = maxX - minX;
  let height = maxY - minY;
  // Degenerate extent (all points coincide) → give it a unit box so it renders.
  if (width <= 0) {
    width = 2 * margin || 8;
    minX -= width / 2;
  }
  if (height <= 0) {
    height = 2 * margin || 8;
    minY -= height / 2;
  }
  return { minX, minY, width, height };
}

/**
 * Project a game tile coord (x, y) into pixel space within an SVG of `svgSize` px, given a viewBox.
 * Uniform scale (preserves aspect by fitting the larger extent), origin top-left (no y-flip —
 * AoE2 y already grows downward). Clamps into [0, svgSize].
 */
export function mapCoordToSvg(
  x: number,
  y: number,
  viewBox: ViewBox,
  svgSize: number,
): { px: number; py: number } {
  const ext = Math.max(viewBox.width, viewBox.height) || 1;
  const scale = svgSize / ext;
  const px = (x - viewBox.minX) * scale;
  const py = (y - viewBox.minY) * scale;
  const clamp = (v: number) => (v < 0 ? 0 : v > svgSize ? svgSize : v);
  return { px: clamp(px), py: clamp(py) };
}

/**
 * Project a game tile coord (x, y) onto AoE2's isometric minimap — a wide diamond (2:1), NOT a
 * square. The world square [0,M]² rotates 45° and is flipped across the y=-x diagonal so the world
 * axes land on the in-game corners: world (M,0)=top(N), (0,M)=bottom(S), (0,0)=left(W),
 * (M,M)=right(E). The vertical axis is compressed to half so the diamond reads ~twice as wide as
 * tall, matching the in-game minimap. Anchored against a real game (ME west / OPP south-east).
 */
export function mapCoordToDiamond(
  x: number,
  y: number,
  mapDim: number | null | undefined,
  width: number,
  height: number,
): { px: number; py: number } {
  const M = mapDim && mapDim > 0 ? mapDim : 120;
  // Flipped across the y=-x diagonal so the world axes land on the in-game minimap corners:
  // (M,0)=N, (0,M)=S, (0,0)=W, (M,M)=E.
  const sum = x + y; // [0, 2M]
  const diff = y - x; // [-M, M]
  const px = (sum / (2 * M)) * width;
  const py = ((diff + M) / (2 * M)) * height;
  const clamp = (a: number, hi: number) => (a < 0 ? 0 : a > hi ? hi : a);
  return { px: clamp(px, width), py: clamp(py, height) };
}

/** SVG polygon `points` for the minimap diamond boundary (N, E, S, W) in a width×height box. */
export function diamondCorners(width: number, height: number): string {
  return `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`;
}

/** Marker x-position on a 0→durationS timeline of pixel `width`. Clamps t_s into range. */
export function timelineX(
  tS: number,
  durationS: number,
  width: number,
): number {
  if (!durationS || durationS <= 0) return 0;
  const t = tS < 0 ? 0 : tS > durationS ? durationS : tS;
  return (t / durationS) * width;
}

/**
 * APM bar segment fractions: eco / military / uncategorized (= total − eco − mil, never negative).
 * Returns fractions of `total` that sum to ≤ 1. Guards divide-by-zero / nullish inputs.
 */
export function apmSplitSegments(
  apmEco: number | null | undefined,
  apmMilitary: number | null | undefined,
  apmTotal: number | null | undefined,
): { eco: number; military: number; other: number } {
  const total = apmTotal ?? 0;
  if (!total || total <= 0) return { eco: 0, military: 0, other: 0 };
  const eco = Math.max(0, apmEco ?? 0);
  const mil = Math.max(0, apmMilitary ?? 0);
  const other = Math.max(0, total - eco - mil);
  return { eco: eco / total, military: mil / total, other: other / total };
}

/**
 * The single source of solid-vs-dashed truth: exact = solid full-opacity; est = dashed reduced
 * opacity; unavailable = dotted, faint. Drives every SVG stroke + fill in the viz.
 */
export function tierStroke(tier: DataTier): {
  strokeDasharray: string;
  opacity: number;
} {
  if (tier === "est") return { strokeDasharray: "4 3", opacity: 0.7 };
  if (tier === "unavailable") return { strokeDasharray: "1 4", opacity: 0.35 };
  return { strokeDasharray: "0", opacity: 1 };
}

/** Map a #6 confidence_tier (exact|heuristic|needs-#2) to the viz DataTier for badge rendering. */
export function mistakeTier(confidenceTier: string | undefined): DataTier {
  if (confidenceTier === "exact") return "exact";
  if (confidenceTier === "heuristic") return "est";
  return "unavailable"; // needs-#2 / unknown
}

/** mm:ss from an arbitrary-second value (used for timeline tooltips). Empty for nullish. */
export function fmtMmss(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  const sec = Math.max(0, Math.floor(s));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/**
 * Conservative display-time sanitizer for stored coach commentary. The text occasionally carries
 * agent scaffolding (e.g. "Now I have all I need. Here is the coaching report:") at the very start
 * or trivial sign-offs at the very end. We strip only clearly-recognised scaffolding lines at the
 * boundaries — never the analysis body. Matching is line-by-line, case-insensitive, and only peels
 * leading/trailing scaffolding (plus the now-empty lines around it).
 */
export function sanitizeCoachText(raw: string | null | undefined): string {
  if (!raw) return "";
  // Lines that, when they appear at the very top/bottom, are pure agent scaffolding.
  const SCAFFOLD = [
    /^(ok(ay)?|alright|great|perfect)?[,.!\s]*now i have (all|everything)( i need| the (data|info|information|details))?[,.!\s]*((let me|i('| wi)?ll) .{0,30}(report|analysis|review)[:.\s]*|here('?s| is)? .{0,30}(report|analysis|review)[:.\s]*)?$/i,
    /^(let me|i('| wi)?ll) (now )?(compose|write|put together|assemble|provide|give|share) (the |my |you )?.{0,30}(report|analysis|review|feedback|breakdown)[:.\s]*$/i,
    /^here('?s| is)( the| my)?( final| full)? (coaching )?(report|analysis|review|feedback|breakdown)[:.\s]*$/i,
    /^here('?s| is)( the| my)?( final| full)? .{0,40}? (report|analysis|review)[:.\s]*$/i,
    /^(below|the following) is( the| my)?.{0,40}?(report|analysis|review)[:.\s]*$/i,
    /^let me (provide|give|write|put together).{0,60}$/i,
    /^i('| wi)?ll (now )?(provide|give|write|put together).{0,60}$/i,
    /^(coaching )?(report|analysis|review)[:.\s]*$/i,
    /^that('?s| is)( all| it)?[.!\s]*$/i,
    /^(hope (this|that) helps|good luck|gl ?hf)\b[\s\S]{0,40}$/i,
  ];
  const isScaffold = (line: string) => {
    const t = line.trim();
    if (t === "") return false;
    return SCAFFOLD.some((re) => re.test(t));
  };

  let lines = raw.replace(/\r\n/g, "\n").split("\n");

  // Peel scaffolding (and blank lines) from the start.
  while (lines.length > 0) {
    const first = lines[0].trim();
    if (first === "" || isScaffold(lines[0])) {
      lines.shift();
    } else {
      break;
    }
  }
  // Peel scaffolding (and blank lines) from the end.
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (last === "" || isScaffold(lines[lines.length - 1])) {
      lines.pop();
    } else {
      break;
    }
  }
  return lines.join("\n").trim();
}

/**
 * TC idle as a PRE-CAP percentage: tc_idle_s / precap_window_s. The window already excludes
 * the post-200-pop tail and age-up pauses, so this is "idle while you should have been making
 * villagers". Returns null when the window is missing/zero (can't honestly compute a %).
 */
export function tcIdlePct(
  tcIdleS: number | null | undefined,
  precapWindowS: number | null | undefined,
): number | null {
  if (
    tcIdleS == null ||
    precapWindowS == null ||
    !Number.isFinite(tcIdleS) ||
    !Number.isFinite(precapWindowS) ||
    precapWindowS <= 0
  ) {
    return null;
  }
  const pct = (tcIdleS / precapWindowS) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * Strip the agentic-coach scaffolding from the stored analysis so only the human-readable verdict
 * remains. The coach sometimes wraps its answer in a tagged block or leads with tool-noise lines;
 * we drop a leading "Thinking…/Reading…/Running…" preamble and unwrap a single fenced/ tagged body,
 * then trim. Pure + idempotent — safe to run on already-clean text (returns it unchanged).
 */
export function stripCoachScaffolding(raw: string | null | undefined): string {
  if (!raw) return "";
  let text = raw.replace(/\r\n/g, "\n").trim();

  // Unwrap a single <final>…</final> / <summary>…</summary> / <answer>…</answer> tag if present.
  const tagMatch = text.match(
    /<(final|summary|answer|verdict|analysis)>\s*([\s\S]*?)\s*<\/\1>/i,
  );
  if (tagMatch) text = tagMatch[2].trim();

  // Unwrap a single top-level fenced ```markdown block wrapping the WHOLE body.
  const fence = text.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  if (fence) text = fence[1].trim();

  // Drop leading agent tool-noise lines (Thinking / Reading file / Running …).
  const lines = text.split("\n");
  let start = 0;
  while (
    start < lines.length &&
    /^(thinking|reading|running|inspecting|loading|tool|analyzing)\b.*[.…]?$/i.test(
      lines[start].trim(),
    )
  ) {
    start += 1;
  }
  return lines.slice(start).join("\n").trim();
}

// --- minimal, dependency-free markdown → typed blocks (rendered by Aoe2Coach) ---
export type MdInline =
  | { t: "text"; v: string }
  | { t: "bold"; v: string }
  | { t: "code"; v: string };
export type MdBlock =
  | { t: "h"; level: number; spans: MdInline[] }
  | { t: "p"; spans: MdInline[] }
  | { t: "ul"; items: MdInline[][] }
  | { t: "ol"; items: MdInline[][] };

/** Parse inline **bold** and `code` runs in a single line into typed spans. */
export function parseInline(line: string): MdInline[] {
  const spans: MdInline[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) spans.push({ t: "text", v: line.slice(last, m.index) });
    if (m[2] !== undefined) spans.push({ t: "bold", v: m[2] });
    else if (m[3] !== undefined) spans.push({ t: "code", v: m[3] });
    last = m.index + m[0].length;
  }
  if (last < line.length) spans.push({ t: "text", v: line.slice(last) });
  return spans.length ? spans : [{ t: "text", v: line }];
}

/**
 * Parse a (scaffolding-stripped) markdown string into a flat block list: headings (#…), bullet
 * lists (- / *), ordered lists (1.), and paragraphs. Intentionally tiny — covers what the coach
 * emits without pulling in a markdown library (CSP/bundle-size friendly).
 */
export function parseMarkdown(src: string | null | undefined): MdBlock[] {
  const text = (src ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const lines = text.split("\n");
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let listKind: "ul" | "ol" | null = null;
  let items: string[] = []; // raw item text (joined, then parsed at flush)

  const flushPara = () => {
    if (para.length) {
      blocks.push({ t: "p", spans: parseInline(para.join(" ").trim()) });
      para = [];
    }
  };
  const flushList = () => {
    if (listKind && items.length) {
      blocks.push({
        t: listKind,
        items: items.map((s) => parseInline(s.trim())),
      });
    }
    listKind = null;
    items = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const h = trimmed.match(/^(#{1,4})\s+(.*)$/);
    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ t: "h", level: h[1].length, spans: parseInline(h[2]) });
    } else if (bullet) {
      flushPara();
      if (listKind === "ol") flushList();
      listKind = "ul";
      items.push(bullet[1]);
    } else if (ordered) {
      flushPara();
      if (listKind === "ul") flushList();
      listKind = "ol";
      items.push(ordered[1]);
    } else if (trimmed === "") {
      flushPara();
      flushList();
    } else if (listKind && items.length && para.length === 0) {
      // Continuation line of the current list item (wrapped, no blank line).
      items[items.length - 1] += ` ${trimmed}`;
    } else {
      flushList();
      para.push(trimmed);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/* ── Stacked production-over-time series (Army & Stats chart) ──────────────
 * Shapes villager_curve + produced_units into ordered cumulative series for a
 * stacked-area chart. Villagers always sit on the bottom; army UNIT TYPES stack
 * above, top-N by total produced, the rest folded into "Other". Every series
 * carries a sampled point per time bucket so the SVG renderer just maps x/y. */

export type ProductionSeries = {
  name: string;
  color: string;
  total: number;
  isVillager: boolean;
  /** cumulative produced count at each bucket boundary (aligned to `times`). */
  values: number[];
};

export type ProductionChart = {
  /** bucket boundary times in seconds (0 … duration), shared x-axis. */
  times: number[];
  /** bottom-to-top stacking order; villagers first. */
  series: ProductionSeries[];
  /** max stacked total across all buckets (y-axis top). */
  yMax: number;
  durationS: number;
};

/* Distinct, readable palette for army unit types (villagers use their own tan). */
const VILLAGER_COLOR = "#d8b878";
const ARMY_COLORS = [
  "#e0564f", // red
  "#4f9be0", // blue
  "#7bc96f", // green
  "#c77dff", // violet
  "#ffb347", // amber
  "#5fd0c5", // teal
];
const OTHER_COLOR = "#8a8f98";

export function buildProductionSeries(
  production:
    | {
        produced_units?: { name: string; amount?: number; t_s: number }[];
        villager_curve?: { t_s: number; villagers: number }[];
      }
    | undefined,
  durationS: number | null | undefined,
  opts?: { stepS?: number; topN?: number },
): ProductionChart | null {
  const stepS = opts?.stepS ?? 30;
  const topN = opts?.topN ?? 5;
  const produced = production?.produced_units ?? [];
  const curve = production?.villager_curve ?? [];

  // Determine the timeline. Prefer explicit duration; fall back to last event.
  const lastEvent = Math.max(
    0,
    ...produced.map((u) => u.t_s || 0),
    ...curve.map((p) => p.t_s || 0),
  );
  const dur = Math.max(durationS && durationS > 0 ? durationS : 0, lastEvent);
  if (dur <= 0) return null;
  if (produced.length === 0 && curve.length === 0) return null;

  // Bucket boundaries: 0, step, 2*step, …, dur (inclusive).
  const times: number[] = [];
  for (let t = 0; t < dur; t += stepS) times.push(t);
  times.push(dur);

  const isVil = (name: string) => name.toLowerCase() === "villager";

  // Villager cumulative per bucket — prefer the explicit curve, else derive
  // from produced_units villager entries.
  const villagerValues = times.map((t) => {
    if (curve.length > 0) {
      let v = 0;
      for (const p of curve) if ((p.t_s || 0) <= t) v = p.villagers;
      return v;
    }
    let v = 0;
    for (const u of produced)
      if (isVil(u.name) && (u.t_s || 0) <= t) v += u.amount ?? 1;
    return v;
  });

  // Army totals by unit type → pick top-N, fold the rest into "Other".
  const totals = new Map<string, number>();
  for (const u of produced) {
    if (isVil(u.name)) continue;
    totals.set(u.name, (totals.get(u.name) ?? 0) + (u.amount ?? 1));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const topNames = ranked.slice(0, topN).map(([n]) => n);
  const topSet = new Set(topNames);
  const hasOther = ranked.length > topN;

  // Cumulative per bucket for each army series (+ Other bucket).
  const armyCumulative = (match: (name: string) => boolean) =>
    times.map((t) => {
      let v = 0;
      for (const u of produced)
        if (!isVil(u.name) && match(u.name) && (u.t_s || 0) <= t)
          v += u.amount ?? 1;
      return v;
    });

  const series: ProductionSeries[] = [];
  const villagerTotal = villagerValues[villagerValues.length - 1] ?? 0;
  if (villagerTotal > 0) {
    series.push({
      name: "Villagers",
      color: VILLAGER_COLOR,
      total: villagerTotal,
      isVillager: true,
      values: villagerValues,
    });
  }
  topNames.forEach((name, i) => {
    series.push({
      name,
      color: ARMY_COLORS[i % ARMY_COLORS.length],
      total: totals.get(name) ?? 0,
      isVillager: false,
      values: armyCumulative((n) => n === name),
    });
  });
  if (hasOther) {
    const otherTotal = ranked.slice(topN).reduce((s, [, amt]) => s + amt, 0);
    series.push({
      name: "Other",
      color: OTHER_COLOR,
      total: otherTotal,
      isVillager: false,
      values: armyCumulative((n) => !topSet.has(n)),
    });
  }

  if (series.length === 0) return null;

  // y-axis top = max stacked sum across buckets.
  let yMax = 0;
  for (let i = 0; i < times.length; i++) {
    let sum = 0;
    for (const s of series) sum += s.values[i];
    if (sum > yMax) yMax = sum;
  }
  yMax = Math.max(yMax, 1);

  return { times, series, yMax, durationS: dur };
}

// ── Economy graphs (worker allocation + resource balance) ────────────────────────────────
// The four gatherable resources, in a fixed stacking order (food at the bottom), with their
// in-game hues. Shared by both economy charts and their icon legends.
export const ECON_RESOURCES = ["food", "wood", "gold", "stone"] as const;
export const ECON_RESOURCE_COLOR: Record<string, string> = {
  food: "#d65a3f", // red — matches the in-game food (meat) hue; kept distinct from gold's yellow
  wood: "#3f9e54",
  gold: "#f0c440",
  stone: "#9aa3ad",
};

/**
 * Clean linear y-axis ticks: 0 up to `max`, stepped at a 1/2/5 ×10ⁿ interval so there are roughly
 * `target` gridlines. The economy graphs use a LINEAR axis (not log) so the stacked food/wood/gold
 * split shows true proportions rather than being visually distorted by log compression.
 */
export function niceTicks(max: number, target = 5): number[] {
  if (!(max > 0)) return [0];
  const raw = max / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v));
  return ticks;
}

export type EconChartPoint = {
  x: number; // villager count (worker alloc) or t_s seconds (resource balance)
  t_s: number;
  values: Record<string, number>;
  active_farms?: number;
};
export type EconChart = {
  points: EconChartPoint[];
  resources: string[]; // present resources, in ECON_RESOURCES order
  xMin: number;
  xMax: number;
  maxStackTotal: number; // largest stacked sum across points (log-axis top)
};

/** Build the villager-count-indexed worker-allocation chart (x = villager count). */
export function buildWorkerAllocChart(
  wa: WorkerAllocation | null | undefined,
): EconChart | null {
  const series = wa?.series;
  if (!series || series.length === 0) return null;
  const points: EconChartPoint[] = series.map((p) => ({
    x: p.vils,
    t_s: p.t_s,
    values: p.alloc ?? {},
    active_farms: p.active_farms ?? 0,
  }));
  return finishEconChart(points);
}

// The resource-balance chart is two-tone per resource: cumulative SPENT (dark, exact) + estimated
// FLOATING (bright) on top. Each point carries both maps; the total stacked height is spent+floating.
export type BalanceChartPoint = {
  x: number; // t_s seconds
  t_s: number;
  spent: Record<string, number>;
  floating: Record<string, number>;
};
export type BalanceChart = {
  points: BalanceChartPoint[];
  resources: string[]; // present resources, in ECON_RESOURCES order
  xMin: number;
  xMax: number;
  maxStackTotal: number;
};

/** Build the real-time-indexed resource-balance chart (x = t_s seconds): spent + floating per point. */
export function buildResourceBalanceChart(
  rb: ResourceBalance | null | undefined,
): BalanceChart | null {
  const series = rb?.series;
  if (!series || series.length === 0) return null;
  const points: BalanceChartPoint[] = series.map((p) => ({
    x: p.t_s,
    t_s: p.t_s,
    spent: p.spent ?? {},
    floating: p.floating ?? {},
  }));
  const present = new Set<string>();
  let maxStackTotal = 0;
  for (const p of points) {
    let sum = 0;
    for (const r of ECON_RESOURCES) {
      const s = p.spent[r] ?? 0;
      const f = p.floating[r] ?? 0;
      if (s > 0 || f > 0) present.add(r);
      sum += s + f;
    }
    if (sum > maxStackTotal) maxStackTotal = sum;
  }
  const resources = ECON_RESOURCES.filter((r) => present.has(r));
  if (resources.length === 0) return null;
  return {
    points,
    resources,
    xMin: points[0]?.x ?? 0,
    xMax: points[points.length - 1]?.x ?? 0,
    maxStackTotal: Math.max(maxStackTotal, 1),
  };
}

/** Lighten a #rrggbb hex toward white by `amt` (0..1) — used for the bright "floating" band. */
export function lightenHex(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amt);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function finishEconChart(points: EconChartPoint[]): EconChart | null {
  const present = new Set<string>();
  let maxStackTotal = 0;
  for (const p of points) {
    let sum = 0;
    for (const r of ECON_RESOURCES) {
      const v = p.values[r] ?? 0;
      if (v > 0) present.add(r);
      sum += v;
    }
    if (sum > maxStackTotal) maxStackTotal = sum;
  }
  const resources = ECON_RESOURCES.filter((r) => present.has(r));
  if (resources.length === 0) return null;
  return {
    points,
    resources,
    xMin: points[0]?.x ?? 0,
    xMax: points[points.length - 1]?.x ?? 0,
    maxStackTotal: Math.max(maxStackTotal, 1),
  };
}
