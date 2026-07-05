import type { BuildDetail, BuildSummary } from "@/lib/aoe2";

/** API base URL for client-side fetches (empty = relative URL via Caddy proxy) */
export const API = process.env.NEXT_PUBLIC_API_URL ?? "";

/** API base URL for server-side fetches (needs absolute URL, no browser context) */
export const API_INTERNAL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/* ── Shared API types ──────────────────────────────────── */

export interface Thought {
  id: number;
  content: string;
  image: string | null;
  video: string | null;
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

export async function fetchRadioTracks(
  seed: string,
  exclude: string[],
): Promise<ListenTrack[]> {
  const params = new URLSearchParams({ seed });
  if (exclude.length) params.set("exclude", exclude.join(","));
  try {
    const res = await fetch(`${API}/api/listens/radio/?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.tracks ?? []) as ListenTrack[];
  } catch {
    return [];
  }
}

/* ── AoE2 build-order library ──────────────────────────── */

/** Fetch the public build-order library list (server-side). Empty on error. */
export async function fetchAoe2Builds(): Promise<BuildSummary[]> {
  try {
    const res = await fetch(`${API_INTERNAL}/api/aoe2/builds/`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.builds ?? []) as BuildSummary[];
  } catch {
    return [];
  }
}

/** Fetch a single build's full detail (server-side). Null if unknown / error. */
export async function fetchAoe2Build(id: string): Promise<BuildDetail | null> {
  try {
    const res = await fetch(
      `${API_INTERNAL}/api/aoe2/builds/${encodeURIComponent(id)}/`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as BuildDetail;
  } catch {
    return null;
  }
}

/* ── Listens graph ─────────────────────────────────────── */

export type GraphNodeType = "artist" | "album" | "track";
export type GraphEdgeType =
  | "similar_artist"
  | "similar_track"
  | "colisten"
  | "structural";

export interface GraphNode {
  key: string;
  node_type: GraphNodeType;
  title: string;
  subtitle: string;
  thumbnail_url: string;
  video_id: string;
  play_count: number;
  is_liked: boolean;
  is_subscribed: boolean;
  in_library: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  edge_type: GraphEdgeType;
  weight: number;
}

export interface GraphPatch {
  seed: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphSearchResult {
  key: string;
  node_type: GraphNodeType;
  title: string;
  subtitle: string;
  thumbnail_url: string;
}

/* ── Listens graph: full diagnostic (admin-gated) ──────── */

/** Node types in the full graph — includes "tag", which the patch graph omits. */
export type GraphFullNodeType = "track" | "artist" | "album" | "tag";
export type GraphFullEdgeType = "structural" | "tag" | "affinity";

export interface GraphFullNode {
  id: string; // "<node_type>:<key>" — globally unique, use as force-graph id
  key: string;
  node_type: GraphFullNodeType;
  title: string;
  subtitle: string;
  video_id: string;
  play_count: number;
  is_liked: boolean;
  is_subscribed: boolean;
  in_library: boolean;
  degree: number; // total degree in full graph
  component: number; // 0 = giant component; 1..N = smaller components (sorted desc by size)
}

export interface GraphFullEdge {
  source: string; // node id ("<node_type>:<key>")
  target: string; // node id
  edge_type: GraphFullEdgeType;
  source_kind: string; // "" for structural/tag; "colisten"|"similar_artist"|"similar_track" for affinity
  weight: number;
}

export interface GraphSummary {
  node_count: number;
  edge_count: number;
  component_count: number;
  giant_size: number; // size of component 0
  component_sizes: number[]; // desc
  islands: {
    component: number;
    size: number;
    nodes: { id: string; node_type: string; title: string }[];
  }[]; // comps of size <= 5
  degree: {
    min: number;
    max: number;
    mean: number;
    median: number;
    histogram: Record<string, number>; // "deg" -> count
  };
  top_hubs: {
    id: string;
    node_type: string;
    title: string;
    degree: number;
    play_count: number;
  }[]; // top 20 by degree
  edge_type_counts: Record<string, number>;
  source_kind_counts: Record<string, number>;
  articulation_points: { id: string; node_type: string; title: string }[]; // within giant component
  bridges: { source: string; target: string }[]; // within giant component
  tagless_artists: number;
}

export interface GraphFull {
  nodes: GraphFullNode[];
  edges: GraphFullEdge[];
  summary: GraphSummary;
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

/* ── Bets: backtester + paper trading ──────────────────────── */

export interface StrategyParam {
  name: string;
  label: string;
  type: "int" | "float";
  default: number;
  min: number;
  max: number;
}

export interface StrategyInfo {
  key: string;
  label: string;
  params: StrategyParam[];
}

export interface BacktestMetrics {
  total_return_pct: number;
  cagr_pct: number;
  max_drawdown_pct: number;
  sharpe: number;
  num_trades: number;
  win_rate_pct: number | null;
}

export interface BacktestTrade {
  date: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  cash_after: number;
  reason: string;
}

export interface BacktestResult {
  ticker: { id: number; symbol: string; name: string; currency: string };
  strategy: string;
  params: Record<string, number>;
  dates: string[];
  equity_curve: number[];
  benchmark_curve: number[];
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  benchmark_metrics: BacktestMetrics;
}

export interface PaperAccount {
  id: number;
  ticker: { id: number; symbol: string; name: string; currency: string };
  strategy: string;
  params: Record<string, number>;
  starting_cash: number;
  started_on: string;
  is_active: boolean;
  current_value: number | null;
  in_position: boolean;
  metrics: BacktestMetrics | null;
}

export interface PaperDetail extends PaperAccount {
  dates: string[];
  equity_curve: number[];
  trades: BacktestTrade[];
}

/* ── Slops (Agent Showcase) ────────────────────────── */

export type TurnStatus =
  | "pending"
  | "approved"
  | "running"
  | "done"
  | "failed"
  | "rejected";

export interface Download {
  id: number;
  filename: string;
  size: number;
  oversize: boolean;
}

export interface Attachment {
  id: number;
  filename: string;
  size: number;
  previewable: boolean;
}

export interface Turn {
  id: number;
  prompt: string;
  status: TurnStatus;
  submitter_ip: string;
  token_count: number;
  tool_calls: number;
  summary: string;
  error: string;
  created_at: string;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  downloads?: Download[];
  attachments: Attachment[];
}

export interface Session {
  id: number;
  workspace: string;
  status: string;
  created_at: string;
  turns: Turn[];
}

export interface SessionListResponse {
  sessions: Session[];
  total: number;
}

export interface SessionTrace {
  trace: Record<string, unknown> | null;
}

export interface SlopsStats {
  total_sessions: number;
  total_turns: number;
  total_tokens: number;
  total_tool_calls: number;
  success_rate: number;
}

/* ── Audiobook ─────────────────────────────────────── */

export type AudiobookChunkKind =
  | "prose"
  | "paraphrased_code"
  | "code_bridge"
  | "figure_bridge"
  | "table_bridge"
  | "equation_bridge";

export interface AudiobookChunk {
  id: number;
  text: string;
  duration_s: number;
  kind: AudiobookChunkKind;
  page?: number;
  original?: string;
}

export interface AudiobookChapter {
  id: string;
  label: string;
  chunk_start: number;
}

export interface AudiobookManifest {
  slug: string;
  title: string;
  author: string;
  source_pdf_url?: string;
  voice: string;
  preprocessor?: { model: string; version: string };
  chapters: AudiobookChapter[];
  chunks: AudiobookChunk[];
}

export async function fetchAudiobookManifest(
  slug: string,
  token: string,
): Promise<AudiobookManifest | null> {
  const res = await fetch(`${API}/api/audiobooks/${slug}/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchAudiobookPlaybackToken(
  slug: string,
  token: string,
): Promise<{ token: string; expires_at: string }> {
  const res = await fetch(`${API}/api/audiobooks/${slug}/playback-token/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`playback-token fetch failed: ${res.status}`);
  return res.json();
}

export function audiobookAudioUrl(
  slug: string,
  chunkId: number,
  playbackToken: string,
): string {
  return `${API}/api/audiobooks/${slug}/audio/${chunkId}/?t=${encodeURIComponent(playbackToken)}`;
}
