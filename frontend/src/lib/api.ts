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

export interface ListenRecommended {
  video_id: string;
  title: string;
  artist: string;
  album: string;
  thumbnail_url: string;
  play_count: number;
  last_played: string | null;
}

export interface WatchVideo {
  id: number;
  youtube_video_id: string;
  title: string;
  thumbnail_url: string;
  note: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  description: string;
  duration: string;
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
  display_order: number;
  pinned_count: number;
}

export interface WatchStagingResponse {
  channels: StagingChannel[];
}

export interface UploadVideo {
  youtube_video_id: string;
  title: string;
  thumbnail_url: string;
  view_count?: number;
}

export interface ChannelUploadsResponse {
  videos: UploadVideo[];
  message?: string;
}

export interface WatchSyncStatus {
  available: boolean;
  cooldown_remaining: number;
  connected: boolean;
  last_synced: string | null;
}

export interface WatchRecommended {
  video: {
    id: number;
    youtube_video_id: string;
    title: string;
    thumbnail_url: string;
    view_count: number;
    like_count: number;
    comment_count: number;
    description: string;
    duration: string;
    channel_name: string;
    channel_thumbnail_url: string;
  } | null;
}

export interface LichessStatus {
  connected: boolean;
  username: string | null;
}

export interface BetsTicker {
  id: number;
  symbol: string;
  name: string;
  asset_type: "stock" | "commodity" | "crypto" | "bond";
  display_order: number;
  price: string | null;
  change_pct: string | null;
  currency: string;
  sparkline: number[];
  updated_at: string | null;
}

export interface BetsHistoryPrice {
  date: string;
  price: string;
  change_pct: string | null;
}

export interface BetsHistory {
  id: number;
  symbol: string;
  name: string;
  asset_type: string;
  currency: string;
  period: string;
  prices: BetsHistoryPrice[];
  change_periods: Record<string, string | null>;
}

export interface BetsSearchResult {
  symbol: string;
  name: string;
  asset_type: "stock" | "commodity" | "crypto" | "bond";
  provider: string;
  provider_id: string;
  currency: string;
  match_score: number;
}

/* ── Slops (Agent Showcase) ────────────────────────── */

export type MissionStatus =
  | "pending"
  | "approved"
  | "running"
  | "done"
  | "failed"
  | "rejected";

export interface Mission {
  id: number;
  prompt: string;
  status: MissionStatus;
  workspace: string;
  token_count: number;
  tool_calls: number;
  summary: string;
  error: string;
  created_at: string;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface MissionListResponse {
  missions: Mission[];
  total: number;
  limit: number;
  offset: number;
}

export interface MissionStats {
  total_missions: number;
  total_tokens: number;
  total_tool_calls: number;
  success_rate: number;
  pending_count: number;
}

export interface ATIFStep {
  step_id: number;
  timestamp: string;
  source: "user" | "agent" | "system";
  message: string | null;
  model_name?: string;
  tool_calls?: {
    tool_call_id: string;
    function_name: string;
    arguments: Record<string, unknown>;
  }[];
  observation?: {
    results: { tool_call_id: string; content: string }[];
  };
  metrics?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export interface ATIFDocument {
  schema_version: string;
  session_id: string;
  agent: { name: string; version: string; model_name: string };
  steps: ATIFStep[];
  final_metrics?: {
    total_prompt_tokens: number;
    total_completion_tokens: number;
    total_cached_tokens: number;
    total_cost_usd: number;
    total_steps: number;
  };
}

export interface MissionTrace {
  trace: ATIFDocument | null;
  status: MissionStatus;
}
