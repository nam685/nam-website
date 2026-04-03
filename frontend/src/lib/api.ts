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

export interface ListenTopTrack {
  video_id: string;
  title: string;
  artist: string;
  album: string;
  thumbnail_url: string;
  play_count: number;
}

export interface ListenTopArtist {
  name: string;
  play_count: number;
  track_count: number;
  top_tracks: { video_id: string; title: string; thumbnail_url: string }[];
}

export interface ListenTopAlbum {
  name: string;
  artist: string;
  thumbnail_url: string;
  play_count: number;
  track_count: number;
}

export interface WatchVideo {
  id: number;
  youtube_video_id: string;
  title: string;
  thumbnail_url: string;
  note: string;
}

export interface WatchChannel {
  id: number;
  youtube_channel_id: string;
  name: string;
  description: string;
  thumbnail_url: string;
  tier: "never_miss" | "regular" | "check_out";
  display_order: number;
  videos: WatchVideo[];
}

export interface WatchListResponse {
  channels: WatchChannel[];
  total: number;
  limit: number;
  offset: number;
}

export interface StagingChannel {
  id: number;
  youtube_channel_id: string;
  name: string;
  description: string;
  thumbnail_url: string;
  tier: string;
}

export interface StagingVideo {
  id: number;
  youtube_video_id: string;
  title: string;
  thumbnail_url: string;
  channel_name: string | null;
  pinned: boolean;
}

export interface WatchStagingResponse {
  channels: StagingChannel[];
  videos: StagingVideo[];
}

export interface WatchSyncStatus {
  available: boolean;
  cooldown_remaining: number;
  connected: boolean;
  last_synced: string | null;
}

export interface LichessStatus {
  connected: boolean;
  username: string | null;
}
