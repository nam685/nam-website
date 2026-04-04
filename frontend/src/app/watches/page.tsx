"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type WatchChannel,
  type WatchListResponse,
  type WatchRecommended,
  type WatchSyncStatus,
  type WatchVideo,
  API,
} from "@/lib/api";
import { store } from "@/lib/auth";

const ACCENT = "#1e40af";
const PAGE_SIZE = 100;

type TierKey = "never_miss" | "regular" | "check_out";

/* ── Fisher-Yates shuffle ──────────────────────────── */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── Format counts ─────────────────────────────────── */
function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/* ── Tier visual config ────────────────────────────── */
const TIER_STYLE: Record<
  TierKey,
  {
    border: string;
    borderHover: string;
    shadow: string;
    opacity: number;
    bg: string;
  }
> = {
  never_miss: {
    border: `${ACCENT}60`,
    borderHover: `${ACCENT}e6`,
    shadow: `0 0 12px ${ACCENT}20`,
    opacity: 1,
    bg: "#111",
  },
  regular: {
    border: `${ACCENT}25`,
    borderHover: `${ACCENT}80`,
    shadow: "none",
    opacity: 0.85,
    bg: "#0e0e0e",
  },
  check_out: {
    border: `${ACCENT}10`,
    borderHover: `${ACCENT}4d`,
    shadow: "none",
    opacity: 0.65,
    bg: "#0a0a0a",
  },
};

/* ── Hero video state ──────────────────────────────── */
interface HeroVideo {
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
}

/* ── Channel Card ──────────────────────────────────── */
function ChannelCard({
  channel,
  isExpanded,
  onToggle,
}: {
  channel: WatchChannel;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const tier = TIER_STYLE[channel.tier] ?? TIER_STYLE.check_out;
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="watches-card"
      style={{
        background: hovered ? `${ACCENT}0d` : tier.bg,
        border: `1px solid ${hovered ? tier.borderHover : tier.border}`,
        boxShadow: hovered ? `0 0 12px ${ACCENT}15` : tier.shadow,
        borderRadius: 6,
        padding: "0.75rem",
        cursor: "pointer",
        transition:
          "border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease",
        opacity: tier.opacity,
        outline: isExpanded ? `2px solid ${ACCENT}60` : "none",
        outlineOffset: -1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.5rem",
        textAlign: "center",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      {channel.thumbnail_url ? (
        <img
          src={channel.thumbnail_url}
          alt={channel.name}
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            objectFit: "cover",
            background: "#1a1a1a",
            border: `1px solid ${tier.border}`,
          }}
        />
      ) : (
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "#1a1a1a",
            border: `1px solid ${tier.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#444",
            fontSize: "1rem",
          }}
        >
          ~
        </div>
      )}
      <p
        style={{
          fontSize: "0.8rem",
          fontWeight: 600,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical" as const,
          wordBreak: "break-word" as const,
          color: "#e5e2e1",
          width: "100%",
          margin: 0,
        }}
      >
        {channel.name}
      </p>
    </div>
  );
}

/* ── Expanded Channel Block ────────────────────────── */
function ExpandedBlock({
  channel,
  onVideoClick,
}: {
  channel: WatchChannel;
  onVideoClick: (_v: WatchVideo, _ch: WatchChannel) => void;
}) {
  const tier = TIER_STYLE[channel.tier] ?? TIER_STYLE.check_out;

  return (
    <div
      className="watches-expanded"
      style={{
        gridColumn: "1 / -1",
        background: "#0c0c0c",
        border: `1px solid ${ACCENT}30`,
        borderRadius: 6,
        padding: "1.25rem",
        animation: "fadeIn 0.2s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "1.25rem",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        {/* Avatar + name */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.5rem",
            minWidth: 80,
          }}
        >
          {channel.thumbnail_url ? (
            <img
              src={channel.thumbnail_url}
              alt={channel.name}
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                objectFit: "cover",
                background: "#1a1a1a",
                border: `2px solid ${tier.border}`,
              }}
            />
          ) : (
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                background: "#1a1a1a",
                border: `2px solid ${tier.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#444",
                fontSize: "1.5rem",
              }}
            >
              ~
            </div>
          )}
          <a
            href={`https://www.youtube.com/channel/${channel.youtube_channel_id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "0.7rem",
              color: `${ACCENT}99`,
              textDecoration: "none",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = ACCENT;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = `${ACCENT}99`;
            }}
          >
            YouTube
          </a>
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <p
            style={{
              fontSize: "1rem",
              fontWeight: 600,
              color: "#e5e2e1",
              margin: "0 0 0.35rem",
            }}
          >
            {channel.name}
          </p>
          {channel.description && (
            <p
              style={{
                fontSize: "0.8rem",
                color: "#888",
                margin: "0 0 0.75rem",
                lineHeight: 1.5,
                maxHeight: "4.5rem",
                overflow: "hidden",
              }}
            >
              {channel.description}
            </p>
          )}

          {/* Pinned videos */}
          {channel.videos.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.5rem",
              }}
            >
              {channel.videos.map((video) => (
                <div
                  key={video.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onVideoClick(video, channel);
                  }}
                  title={video.title}
                  style={{ cursor: "pointer", flexShrink: 0 }}
                >
                  {video.thumbnail_url ? (
                    <img
                      src={video.thumbnail_url}
                      alt={video.title}
                      style={{
                        width: 140,
                        height: 79,
                        objectFit: "cover",
                        borderRadius: 3,
                        background: "#1a1a1a",
                        border: `1px solid ${ACCENT}20`,
                        transition: "border-color 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = `${ACCENT}60`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = `${ACCENT}20`;
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 140,
                        height: 79,
                        borderRadius: 3,
                        background: "#1a1a1a",
                        border: `1px solid ${ACCENT}20`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#444",
                        fontSize: "0.7rem",
                        fontFamily: "monospace",
                      }}
                    >
                      no thumb
                    </div>
                  )}
                  <p
                    style={{
                      fontSize: "0.65rem",
                      color: "#888",
                      margin: "0.2rem 0 0",
                      maxWidth: 140,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {video.title}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Hero Panel ────────────────────────────────────── */
function HeroPanel({
  video,
  playing,
  onPlay,
}: {
  video: HeroVideo | null;
  playing: boolean;
  onPlay: () => void;
}) {
  const [descExpanded, setDescExpanded] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      {/* Video area */}
      <div
        style={{
          position: "relative",
          width: "100%",
          paddingBottom: "56.25%",
          background: "#0a0a0a",
          borderRadius: 6,
          overflow: "hidden",
          border: `1px solid ${ACCENT}15`,
          flexShrink: 0,
        }}
      >
        {video && playing ? (
          <iframe
            src={`https://www.youtube.com/embed/${video.youtube_video_id}?autoplay=1&rel=0`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              border: "none",
            }}
            allow="autoplay; encrypted-media"
            allowFullScreen
          />
        ) : video?.thumbnail_url ? (
          <div
            onClick={onPlay}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              cursor: "pointer",
            }}
          >
            <img
              src={video.thumbnail_url}
              alt={video.title}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
            {/* Play button overlay */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "rgba(0,0,0,0.7)",
                border: `2px solid ${ACCENT}80`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.2s, border-color 0.2s",
              }}
            >
              <div
                style={{
                  width: 0,
                  height: 0,
                  borderStyle: "solid",
                  borderWidth: "10px 0 10px 18px",
                  borderColor: `transparent transparent transparent ${ACCENT}cc`,
                  marginLeft: 3,
                }}
              />
            </div>
          </div>
        ) : (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#333",
              fontSize: "0.8rem",
              fontFamily: "monospace",
            }}
          >
            no video selected
          </div>
        )}
      </div>

      {/* Video info */}
      {video && (
        <div style={{ marginTop: "0.75rem", flexShrink: 0 }}>
          <p
            style={{
              fontSize: "1rem",
              fontWeight: 600,
              color: "#e5e2e1",
              margin: "0 0 0.25rem",
              lineHeight: 1.3,
            }}
          >
            {video.title}
          </p>
          <p
            style={{
              fontSize: "0.8rem",
              color: "#888",
              margin: "0 0 0.4rem",
            }}
          >
            {video.channel_name}
            {video.duration && (
              <span style={{ marginLeft: "0.5rem", color: "#555" }}>
                {video.duration}
              </span>
            )}
          </p>
          <p
            style={{
              fontSize: "0.7rem",
              color: "#555",
              margin: "0 0 0.5rem",
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
            }}
          >
            <span>
              {"👁 "}
              {fmtCount(video.view_count)}
            </span>
            <span>
              {"👍 "}
              {fmtCount(video.like_count)}
            </span>
            <span>
              {"💬 "}
              {fmtCount(video.comment_count)}
            </span>
          </p>
          {video.description && (
            <div
              onClick={() => setDescExpanded(!descExpanded)}
              style={{
                fontSize: "0.75rem",
                color: "#666",
                lineHeight: 1.5,
                maxHeight: descExpanded ? "none" : "4.5rem",
                overflow: "hidden",
                cursor: "pointer",
                transition: "max-height 0.3s ease",
              }}
            >
              {video.description}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

/* ── Main Page ─────────────────────────────────────── */
export default function WatchesPage() {
  const [channels, setChannels] = useState<WatchChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [heroVideo, setHeroVideo] = useState<HeroVideo | null>(null);
  const [playing, setPlaying] = useState(false);
  const [syncStatus, setSyncStatus] = useState<WatchSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const initialLoadDone = useRef(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");

  /* ── Fetch channels ───────────────────────────────── */
  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch(
        `${API}/api/watches/?limit=${PAGE_SIZE}&offset=0`,
      );
      if (!res.ok) return;
      const data: WatchListResponse = await res.json();
      // Only shuffle on initial load — re-fetches (e.g. after sync) keep current order
      setChannels(initialLoadDone.current ? data.channels : shuffle(data.channels));
      initialLoadDone.current = true;
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── Fetch recommended video ──────────────────────── */
  const fetchRecommended = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/watches/recommended/`);
      if (!res.ok) return;
      const data: WatchRecommended = await res.json();
      if (data.video) {
        setHeroVideo({
          youtube_video_id: data.video.youtube_video_id,
          title: data.video.title,
          thumbnail_url: data.video.thumbnail_url,
          view_count: data.video.view_count,
          like_count: data.video.like_count,
          comment_count: data.video.comment_count,
          description: data.video.description,
          duration: data.video.duration,
          channel_name: data.video.channel_name,
          channel_thumbnail_url: data.video.channel_thumbnail_url,
        });
      }
    } catch {
      // ignore — hero will just show "no video selected"
    }
  }, []);

  /* ── Fetch sync status ────────────────────────────── */
  const fetchSyncStatus = useCallback(async () => {
    const token = store("adminToken");
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/watches/sync-status/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setSyncStatus(await res.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchChannels();
    fetchRecommended();
    if (isAdmin) fetchSyncStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Handlers ─────────────────────────────────────── */
  function handleVideoClick(video: WatchVideo, channel: WatchChannel) {
    setHeroVideo({
      youtube_video_id: video.youtube_video_id,
      title: video.title,
      thumbnail_url: video.thumbnail_url,
      view_count: video.view_count,
      like_count: video.like_count,
      comment_count: video.comment_count,
      description: video.description,
      duration: video.duration,
      channel_name: channel.name,
      channel_thumbnail_url: channel.thumbnail_url,
    });
    setPlaying(true);
    // On mobile, scroll to hero
    if (window.innerWidth < 768 && heroRef.current) {
      heroRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function handlePlay() {
    setPlaying(true);
  }

  function toggleExpand(id: number) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  async function handleSync() {
    const token = store("adminToken");
    if (!token) return;
    setSyncing(true);
    try {
      await fetch(`${API}/api/watches/sync/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchSyncStatus();
      await fetchChannels();
    } finally {
      setSyncing(false);
    }
  }

  function handleConnectYouTube() {
    const token = store("adminToken");
    if (!token) return;
    window.location.href = `${API}/api/watches/auth/?token=${encodeURIComponent(token)}`;
  }

  function handleGridScroll() {
    const el = gridScrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    setScrolledToBottom(atBottom);
  }

  /* ── Build grid items with expansion ──────────────── */
  function buildGridItems(cols: number) {
    const items: React.ReactNode[] = [];
    const expandedIndex = channels.findIndex((ch) => ch.id === expandedId);

    // Calculate insertion point: after the last card in the expanded card's row
    let insertAt = -1;
    if (expandedIndex >= 0) {
      const rowEnd = Math.ceil((expandedIndex + 1) / cols) * cols - 1;
      insertAt = Math.min(rowEnd, channels.length - 1);
    }

    for (let i = 0; i < channels.length; i++) {
      const ch = channels[i];
      items.push(
        <ChannelCard
          key={ch.id}
          channel={ch}
          isExpanded={expandedId === ch.id}
          onToggle={() => toggleExpand(ch.id)}
        />,
      );

      // Insert expanded block after the last card in the row
      if (i === insertAt) {
        const expandedChannel = channels[expandedIndex];
        items.push(
          <ExpandedBlock
            key={`expanded-${expandedChannel.id}`}
            channel={expandedChannel}
            onVideoClick={handleVideoClick}
          />,
        );
      }
    }

    return items;
  }

  /* ── Responsive column detection ─────────────────── */
  const [cols, setCols] = useState(5);

  useEffect(() => {
    function updateCols() {
      const w = window.innerWidth;
      if (w < 768) setCols(2);
      else if (w < 1024) setCols(3);
      else setCols(5);
    }
    updateCols();
    window.addEventListener("resize", updateCols);
    return () => window.removeEventListener("resize", updateCols);
  }, []);

  if (loading) {
    return (
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: "2rem 1.5rem",
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontStyle: "italic",
            color: "#555",
            fontSize: "0.85rem",
            fontFamily: "monospace",
          }}
        >
          loading...
        </p>
      </div>
    );
  }

  const gridItems = buildGridItems(cols);

  return (
    <>
      <title>Nam watches</title>

      <style>{`
        .watches-admin-bar {
          max-width: 1400px;
          margin: 0 auto;
          padding: 0.75rem 1.5rem;
          display: flex;
          justify-content: flex-end;
          gap: 0.5rem;
          position: relative;
          z-index: 2;
        }
        .watches-layout {
          display: flex;
          flex-wrap: wrap;
          padding: 0 0 6rem;
          gap: 0;
          position: relative;
          z-index: 1;
        }
        .watches-hero {
          width: 50%;
          flex-shrink: 0;
          position: sticky;
          top: 80px;
          align-self: flex-start;
          max-height: calc(100vh - 100px);
          overflow-y: auto;
          padding: 0 1rem 0 1.5rem;
        }
        .watches-grid-container {
          width: 50%;
          min-width: 0;
          position: relative;
          padding-right: 1.5rem;
        }
        .watches-grid-scroll {
          height: calc(100vh - 100px);
          overflow-y: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
          padding-bottom: 2rem;
        }
        .watches-grid-scroll::-webkit-scrollbar {
          display: none;
        }
        .watches-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 0.65rem;
        }
        @media (max-width: 1023px) {
          .watches-hero {
            width: 50%;
            padding: 0 0.75rem 0 1rem;
          }
          .watches-grid-container {
            width: 50%;
            padding-right: 1rem;
          }
          .watches-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (max-width: 767px) {
          .watches-layout {
            flex-direction: column;
            padding: 0 1rem 6rem;
            gap: 1.5rem;
          }
          .watches-hero {
            width: 100%;
            padding: 0;
            position: static;
            max-height: none;
            overflow-y: visible;
          }
          .watches-grid-container {
            width: 100%;
            padding-right: 0;
          }
          .watches-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .watches-grid-scroll {
            height: auto;
            overflow-y: visible;
          }
        }
      `}</style>

      {/* Admin controls — above layout so always visible */}
      {isAdmin && (
        <div className="watches-admin-bar">
          {syncStatus?.connected ? (
            <button
              onClick={handleSync}
              disabled={syncing || !syncStatus.available}
              title={
                !syncStatus.available
                  ? `cooldown: ${Math.ceil(syncStatus.cooldown_remaining)}s`
                  : "sync YouTube data"
              }
              style={{
                padding: "0.25rem 0.75rem",
                border: `1px solid ${ACCENT}40`,
                background: "none",
                color: ACCENT,
                fontFamily: "var(--font-headline)",
                fontSize: "0.6875rem",
                textTransform: "uppercase",
                letterSpacing: "0.15em",
                cursor:
                  syncing || !syncStatus.available ? "not-allowed" : "pointer",
                opacity: syncing || !syncStatus.available ? 0.5 : 1,
                borderRadius: 2,
                transition: "border-color 0.2s, background 0.2s",
              }}
              onMouseEnter={(e) => {
                if (!syncing && syncStatus?.available) {
                  e.currentTarget.style.borderColor = ACCENT;
                  e.currentTarget.style.background = `${ACCENT}15`;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = `${ACCENT}40`;
                e.currentTarget.style.background = "none";
              }}
            >
              {syncing ? "syncing..." : "sync"}
            </button>
          ) : (
            <button
              onClick={handleConnectYouTube}
              style={{
                padding: "0.25rem 0.75rem",
                border: `1px solid ${ACCENT}40`,
                background: "none",
                color: ACCENT,
                fontFamily: "var(--font-headline)",
                fontSize: "0.6875rem",
                textTransform: "uppercase",
                letterSpacing: "0.15em",
                cursor: "pointer",
                borderRadius: 2,
                transition: "border-color 0.2s, background 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = ACCENT;
                e.currentTarget.style.background = `${ACCENT}15`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = `${ACCENT}40`;
                e.currentTarget.style.background = "none";
              }}
            >
              connect youtube
            </button>
          )}
          <a
            href="/watches/staging"
            style={{
              padding: "0.25rem 0.75rem",
              border: `1px solid ${ACCENT}20`,
              color: `${ACCENT}99`,
              fontFamily: "var(--font-headline)",
              fontSize: "0.6875rem",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              borderRadius: 2,
              textDecoration: "none",
              transition: "border-color 0.2s, color 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = `${ACCENT}50`;
              e.currentTarget.style.color = ACCENT;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = `${ACCENT}20`;
              e.currentTarget.style.color = `${ACCENT}99`;
            }}
          >
            staging
          </a>
        </div>
      )}

      <div className="watches-layout">
        {/* Hero Panel */}
        <div className="watches-hero" ref={heroRef}>
          <HeroPanel
            video={heroVideo}
            playing={playing}
            onPlay={handlePlay}
          />
        </div>

        {/* Channel Grid */}
        <div className="watches-grid-container">
          {channels.length === 0 ? (
            <p
              style={{
                fontStyle: "italic",
                color: "#444",
                fontSize: "0.85rem",
                fontFamily: "monospace",
                textAlign: "center",
                padding: "3rem 0",
              }}
            >
              nothing here yet
            </p>
          ) : (
            <>
              <div
                className="watches-grid-scroll"
                ref={gridScrollRef}
                onScroll={handleGridScroll}
              >
                <div className="watches-grid">{gridItems}</div>
              </div>
              {!scrolledToBottom && (
                <div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 60,
                    background: "linear-gradient(transparent, #0a0a0a)",
                    pointerEvents: "none",
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>

      <p
        className="watches-tagline"
        style={{
          position: "fixed",
          bottom: "1.5rem",
          left: "4.5rem",
          fontStyle: "italic",
          color: "#444",
          fontSize: "0.8rem",
          margin: 0,
          width: "fit-content",
          pointerEvents: "none",
        }}
      >
        at least i don&apos;t doom scroll facebook et al.
      </p>
    </>
  );
}
