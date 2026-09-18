/** Types + pure helpers for the /plays/badminton tab (badminton-coach report.json, schema_version 1). */

export type Measurement = {
  id?: string;
  label: string;
  value: number | null;
  unit: string | null;
  reference?: number | null;
};

export type Finding = {
  title: string;
  category?: string;
  severity?: number;
  pattern?: "consistent" | "inconsistent" | "single" | string;
  explanation?: string;
  cue?: string;
  drill?: string;
  evidence?: {
    visual?: string;
    attempts?: number[];
    measurements?: Measurement[];
  };
};

export type Attempt = {
  number: number;
  verdict?: string | null;
  video_name?: string;
  start_s?: number;
  end_s?: number;
  capture_fps?: number | null;
  playback_speed?: number | null;
  annotated_clip?: string | null;
  extracted_clip?: string | null;
  key_moments?: string | null;
  signals?: string | null;
  measurements?: { group: string; rows: Measurement[] }[];
  footwork_labels?: { id: string; label: string; value: string }[];
  notes?: string[];
};

export type ReportSubmission = {
  id?: string;
  recorded_at?: string | null;
  reference?: string | null;
  videos?: {
    name: string;
    duration_s?: number;
    capture_fps?: number | null;
    attempts_found?: number;
    attempts_kept?: number;
    timeline?: string | null;
  }[];
  verdict?: {
    progress?: string | null;
    strengths?: string[];
    findings?: Finding[];
    measurement_notes?: string | null;
    confidence?: string | null;
  } | null;
  attempts?: Attempt[];
};

export type SubmissionSummary = {
  id: number;
  recorded_on: string;
  recorded_at: string | null;
  attempts: number;
  findings: number;
};

export type Player = {
  slug: string;
  name: string;
  hand: string;
  height_m: number | null;
  submissions: SubmissionSummary[];
};

export type SubmissionDetail = SubmissionSummary & {
  player: { slug: string; name: string; hand: string };
  report: ReportSubmission;
};

export type SubmissionStatus =
  | "uploading"
  | "pending"
  | "approved"
  | "running"
  | "done"
  | "failed";

export type QueueRow = SubmissionSummary & {
  status: SubmissionStatus;
  player: { slug: string; name: string };
  height_m: number | null;
  hand: string;
  lang: string;
  note: string;
  filename: string;
  size_bytes: number;
  received_bytes: number;
  video_url: string | null;
  step: string;
  stage: string;
  error: string;
  created_at: string;
  approved_at: string | null;
  started_at: string | null;
  queue_position: number | null;
};

/** Site-relative media paths (/media/…) need the API origin in local dev (no Caddy); no-op in prod. */
export function mediaUrl(apiBase: string, url: string): string;
export function mediaUrl(
  apiBase: string,
  url: string | null | undefined,
): string | undefined;
export function mediaUrl(
  apiBase: string,
  url: string | null | undefined,
): string | undefined {
  if (!url) return undefined;
  return url.startsWith("/") ? `${apiBase}${url}` : url;
}

/** Format a raw measurement with its unit. Small lengths go to cm (0.35 m → "35 cm"). */
export function formatMeasure(
  value: number | null | undefined,
  unit: string | null | undefined,
): string {
  if (value == null || !Number.isFinite(value)) return "";
  switch (unit) {
    case "m":
      return Math.abs(value) < 1
        ? `${Math.round(value * 100)} cm`
        : `${value.toFixed(2)} m`;
    case "m/s":
      return `${value.toFixed(1)} m/s`;
    case "deg":
      return `${Math.round(value)}°`;
    case "s":
      return `${value.toFixed(2)} s`;
    case "ms":
      return `${Math.round(value)} ms`;
    case "ratio":
      return value.toFixed(2);
    case "torso":
      return `${value.toFixed(2)} torso`;
    case "torso/s":
      return `${value.toFixed(2)} torso/s`;
    default:
      return unit ? `${round2(value)} ${unit}` : `${round2(value)}`;
  }
}

function round2(v: number): string {
  return String(Math.round(v * 100) / 100);
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** Relative weights of badminton-coach's analysing stages (measure_racket dominates). */
const STAGE_WEIGHTS: [string, number][] = [
  ["split", 2],
  ["retime", 1],
  ["ingest", 2],
  ["measure_body", 10],
  ["measure_racket", 50],
  ["measure_shuttle", 10],
  ["track", 4],
  ["swings", 2],
  ["body3d", 12],
  ["metrics", 2],
];
const STAGE_TOTAL = STAGE_WEIGHTS.reduce((s, [, w]) => s + w, 0);

/** Overall-progress bands per worker step, as [start, end] fractions. */
const STEP_BANDS: Record<string, [number, number]> = {
  downloading: [0, 0.03],
  sending: [0.03, 0.06],
  queued: [0.06, 0.06],
  receiving: [0.03, 0.06],
  analyzing: [0.06, 0.8],
  judging: [0.8, 0.92],
  rendering: [0.92, 0.96],
  reporting: [0.96, 0.97],
  uploading: [0.97, 1],
};

/** Rough 0..1 progress of a running analysis, from the worker's step + stage. */
export function analysisProgress(
  step: string | null | undefined,
  stage: string | null | undefined,
): number {
  const band = step ? STEP_BANDS[step] : undefined;
  if (!band) return 0;
  const [lo, hi] = band;
  if (step !== "analyzing" || !stage) return lo;
  let done = 0;
  for (const [name, w] of STAGE_WEIGHTS) {
    if (stage === name || stage.startsWith(`${name}_`)) {
      // Stage is running: count it as half done.
      return lo + ((hi - lo) * (done + w / 2)) / STAGE_TOTAL;
    }
    done += w;
  }
  return lo;
}

const STEP_LABELS: Record<string, string> = {
  downloading: "fetching the video",
  sending: "handing it to the coach",
  receiving: "handing it to the coach",
  queued: "waiting for the GPU",
  analyzing: "tracking body, racket & shuttle",
  judging: "the coach is watching",
  rendering: "drawing the annotated clips",
  reporting: "writing the report",
  uploading: "publishing the report",
};

export function stepLabel(step: string | null | undefined): string {
  return (step && STEP_LABELS[step]) || "starting";
}

export function statusLabel(
  status: SubmissionStatus,
  queuePosition?: number | null,
): string {
  switch (status) {
    case "uploading":
      return "uploading";
    case "pending":
      return "waiting for Nam to approve";
    case "approved":
      return queuePosition && queuePosition > 1
        ? `queued (#${queuePosition})`
        : "queued — starts when Nam's PC is on";
    case "running":
      return "analysing";
    case "done":
      return "report ready";
    case "failed":
      return "analysis failed";
  }
}

/** Measurements worth showing: drop rows with no value (the report says: hide, don't dash-wall). */
export function visibleRows(rows: Measurement[] | undefined): Measurement[] {
  return (rows || []).filter((r) => r.value != null);
}

/** "2026-09-17" (+ optional ISO time) → "Wed 17 Sep 2026" / "…, 18:57". */
export function formatSubmissionDate(
  recordedOn: string,
  recordedAt?: string | null,
): string {
  const d = new Date(`${recordedOn}T12:00:00`);
  const date = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  if (!recordedAt) return date;
  const t = new Date(recordedAt);
  // Only add the time when it belongs to the same day (uploader-given date wins).
  if (Number.isNaN(t.getTime()) || localIsoDate(t.getTime()) !== recordedOn)
    return date;
  const time = t.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date}, ${time}`;
}

/** Local YYYY-MM-DD of a timestamp (for defaulting the recording date to the file's mtime). */
export function localIsoDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Uploads started from this browser, so the uploader can follow them (localStorage). */
export type TrackedUpload = {
  id: number;
  name: string;
  recorded_on: string;
};

export function parseTrackedUploads(raw: string | null): TrackedUpload[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (u): u is TrackedUpload =>
        u &&
        typeof u.id === "number" &&
        typeof u.name === "string" &&
        typeof u.recorded_on === "string",
    );
  } catch {
    return [];
  }
}
