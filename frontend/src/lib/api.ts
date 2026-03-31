/** API base URL for client-side fetches (empty = relative URL via Caddy proxy) */
export const API = process.env.NEXT_PUBLIC_API_URL ?? "";

/** API base URL for server-side fetches (needs absolute URL, no browser context) */
export const API_INTERNAL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/* ── Shared API types ──────────────────────────────────── */

export interface Thought {
  id: number;
  content: string;
  created_at: string;
}

export interface Drawing {
  id: number;
  image: string;
  category: "pencil" | "camera";
  caption: string;
  created_at: string;
}

export interface ExtraLink {
  label: string;
  url: string;
}

export interface Project {
  title: string;
  slug: string;
  description: string;
  tags: string[];
  github_url: string;
  live_url: string;
  extra_links: ExtraLink[];
  status: "active" | "wip" | "archived";
}

export interface ListenTrack {
  id: number;
  video_id: string;
  title: string;
  artist: string;
  album: string;
  thumbnail_url: string;
  duration: string;
  played_at: string;
}

export interface ListenStats {
  today: number;
  week: number;
  total: number;
  top_tracks: {
    video_id: string;
    title: string;
    artist: string;
    thumbnail_url: string;
    play_count: number;
  }[];
  daily: { date: string; count: number }[];
}
