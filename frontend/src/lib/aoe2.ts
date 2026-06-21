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

export function gameSharePath(id: number): string {
  return `/plays?game=${id}`;
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
