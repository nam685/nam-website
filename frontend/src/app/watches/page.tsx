"use client";

import { useEffect, useState } from "react";

import {
  type WatchChannel,
  type WatchListResponse,
  type WatchSyncStatus,
  API,
} from "@/lib/api";
import { store } from "@/lib/auth";

const ACCENT = "#1e40af";
const PAGE_SIZE = 30;

type TierKey = "never_miss" | "regular" | "check_out";

const TIER_CONFIG: Record<
  TierKey,
  {
    border: string;
    shadow: string;
    avatarSize: number;
    opacity: number;
    label: string;
  }
> = {
  never_miss: {
    border: `${ACCENT}60`,
    shadow: `0 0 15px ${ACCENT}30`,
    avatarSize: 48,
    opacity: 1,
    label: "NEVER MISS",
  },
  regular: {
    border: `${ACCENT}30`,
    shadow: "none",
    avatarSize: 40,
    opacity: 0.85,
    label: "ROTATION",
  },
  check_out: {
    border: `${ACCENT}15`,
    shadow: "none",
    avatarSize: 36,
    opacity: 0.65,
    label: "CHECK OUT",
  },
};

/* ── Channel Card ──────────────────────────────────── */
function ChannelCard({
  channel,
  expanded,
  onToggle,
}: {
  channel: WatchChannel;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tier = TIER_CONFIG[channel.tier] ?? TIER_CONFIG.check_out;
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        gridColumn: expanded ? "span 2" : "span 1",
        background: "#0e0e0e",
        border: `1px solid ${hovered ? `${ACCENT}50` : tier.border}`,
        boxShadow: hovered ? `0 0 20px ${ACCENT}20` : tier.shadow,
        borderRadius: 6,
        padding: expanded ? "1rem" : "0.75rem",
        cursor: "pointer",
        transition: "border-color 0.2s, box-shadow 0.2s, padding 0.2s",
        opacity: tier.opacity,
      }}
    >
      {/* Card header */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.5rem",
          textAlign: "center",
        }}
      >
        <a
          href={`https://www.youtube.com/channel/${channel.youtube_channel_id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ flexShrink: 0 }}
        >
          {channel.thumbnail_url ? (
            <img
              src={channel.thumbnail_url}
              alt={channel.name}
              style={{
                width: tier.avatarSize,
                height: tier.avatarSize,
                borderRadius: "50%",
                objectFit: "cover",
                background: "#1a1a1a",
                border: `1px solid ${tier.border}`,
              }}
            />
          ) : (
            <div
              style={{
                width: tier.avatarSize,
                height: tier.avatarSize,
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
        </a>

        <div style={{ minWidth: 0, width: "100%" }}>
          <p
            style={{
              fontSize: "0.8rem",
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "#e5e2e1",
              marginBottom: 2,
            }}
          >
            {channel.name}
          </p>
          <p
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.55rem",
              color: `${ACCENT}cc`,
              textTransform: "uppercase",
              letterSpacing: "0.15em",
            }}
          >
            {tier.label}
          </p>
        </div>
      </div>

      {/* Expanded: pinned videos */}
      {expanded && channel.videos.length > 0 && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            marginTop: "0.75rem",
            borderTop: `1px solid ${ACCENT}20`,
            paddingTop: "0.75rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          {channel.videos.map((video) => (
            <a
              key={video.id}
              href={`https://www.youtube.com/watch?v=${video.youtube_video_id}`}
              target="_blank"
              rel="noopener noreferrer"
              title={video.title}
              style={{ display: "block", flexShrink: 0 }}
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
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────── */
export default function WatchesPage() {
  const [channels, setChannels] = useState<WatchChannel[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [syncStatus, setSyncStatus] = useState<WatchSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");

  async function fetchChannels(offset: number, append = false) {
    try {
      const res = await fetch(
        `${API}/api/watches/?limit=${PAGE_SIZE}&offset=${offset}`,
      );
      if (!res.ok) return;
      const data: WatchListResponse = await res.json();
      setChannels((prev) =>
        append ? [...prev, ...data.channels] : data.channels,
      );
      setTotal(data.total);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  async function fetchSyncStatus() {
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
  }

  useEffect(() => {
    fetchChannels(0);
    if (isAdmin) fetchSyncStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      await fetchChannels(0);
    } finally {
      setSyncing(false);
    }
  }

  function handleConnectYouTube() {
    const token = store("adminToken");
    if (!token) return;
    window.location.href = `${API}/api/watches/auth/?token=${encodeURIComponent(token)}`;
  }

  function handleShowMore() {
    setLoadingMore(true);
    fetchChannels(channels.length, true);
  }

  function toggleExpand(id: number) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  if (loading) {
    return (
      <div
        style={{
          maxWidth: 900,
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

  return (
    <>
      <title>Nam watches</title>

      <style>{`
        .watch-card-hover:hover {
          border-color: ${ACCENT}50 !important;
          box-shadow: 0 0 20px ${ACCENT}20 !important;
        }
      `}</style>

      <div
        style={{
          maxWidth: 900,
          margin: "0 auto",
          padding: "2rem 1.5rem 6rem",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "2rem",
          }}
        >
          <p
            style={{
              fontStyle: "italic",
              color: "#555",
              fontSize: "0.85rem",
              letterSpacing: "0.02em",
            }}
          >
            at least i don&apos;t doom scroll facebook et al.
          </p>

          {/* Admin controls */}
          {isAdmin && (
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
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
                      syncing || !syncStatus.available
                        ? "not-allowed"
                        : "pointer",
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
        </div>

        {/* Grid */}
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
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(min(160px, 100%), 1fr))",
              gap: "0.75rem",
            }}
          >
            {channels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                expanded={expandedId === channel.id}
                onToggle={() => toggleExpand(channel.id)}
              />
            ))}
          </div>
        )}

        {/* Show more */}
        {channels.length < total && (
          <div style={{ textAlign: "center", marginTop: "2rem" }}>
            <button
              onClick={handleShowMore}
              disabled={loadingMore}
              style={{
                padding: "0.5rem 1.5rem",
                border: `1px solid ${ACCENT}30`,
                background: "none",
                color: `${ACCENT}cc`,
                fontFamily: "var(--font-headline)",
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.15em",
                cursor: loadingMore ? "not-allowed" : "pointer",
                borderRadius: 2,
                transition: "border-color 0.2s, background 0.2s",
              }}
              onMouseEnter={(e) => {
                if (!loadingMore) {
                  e.currentTarget.style.borderColor = `${ACCENT}60`;
                  e.currentTarget.style.background = `${ACCENT}10`;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = `${ACCENT}30`;
                e.currentTarget.style.background = "none";
              }}
            >
              {loadingMore
                ? "loading..."
                : `show more (${total - channels.length} remaining)`}
            </button>
          </div>
        )}

      </div>
    </>
  );
}
