"use client";

import { useEffect, useState } from "react";

import {
  type StagingChannel,
  type StagingVideo,
  type WatchStagingResponse,
  API,
} from "@/lib/api";
import { getAdminToken } from "@/lib/auth";

const ACCENT = "#1e40af";
const RED = "#f87171";

type ChannelTier = "never_miss" | "regular" | "check_out";

const TIER_LABELS: Record<ChannelTier, string> = {
  never_miss: "never miss",
  regular: "regular",
  check_out: "check out",
};

/* ── Shared button styles ──────────────────────────── */
function accentBtnStyle(active = false) {
  return {
    padding: "0.2rem 0.6rem",
    border: `1px solid ${active ? ACCENT : `${ACCENT}40`}`,
    background: active ? `${ACCENT}20` : "none",
    color: active ? ACCENT : `${ACCENT}80`,
    fontFamily: "var(--font-headline)" as const,
    fontSize: "0.6rem" as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.1em" as const,
    cursor: "pointer" as const,
    borderRadius: 2,
    transition: "border-color 0.15s, background 0.15s, color 0.15s",
  };
}

function redBtnStyle() {
  return {
    padding: "0.2rem 0.6rem",
    border: `1px solid ${RED}40`,
    background: "none",
    color: `${RED}99`,
    fontFamily: "var(--font-headline)" as const,
    fontSize: "0.6rem" as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.1em" as const,
    cursor: "pointer" as const,
    borderRadius: 2,
    transition: "border-color 0.15s, color 0.15s",
  };
}

/* ── Staging Channel Row ───────────────────────────── */
function ChannelRow({
  channel,
  onPromote,
  onDelete,
}: {
  channel: StagingChannel;
  onPromote: (channelId: number, tier: ChannelTier) => void;
  onDelete: (channelId: number) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.6rem 0",
        borderBottom: `1px solid #1a1a1a`,
        flexWrap: "wrap",
      }}
    >
      {/* Avatar */}
      {channel.thumbnail_url ? (
        <img
          src={channel.thumbnail_url}
          alt={channel.name}
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            objectFit: "cover",
            background: "#1a1a1a",
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "#1a1a1a",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#444",
            fontSize: "0.75rem",
          }}
        >
          ~
        </div>
      )}

      {/* Name */}
      <a
        href={`https://www.youtube.com/channel/${channel.youtube_channel_id}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          flex: 1,
          minWidth: 120,
          fontSize: "0.85rem",
          color: "#ccc",
          textDecoration: "none",
          fontWeight: 500,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = ACCENT;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "#ccc";
        }}
      >
        {channel.name}
      </a>

      {/* Tier promote buttons */}
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
        {(["never_miss", "regular", "check_out"] as ChannelTier[]).map(
          (tier) => (
            <button
              key={tier}
              onClick={() => onPromote(channel.id, tier)}
              style={accentBtnStyle(channel.tier === tier)}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = ACCENT;
                e.currentTarget.style.color = ACCENT;
                e.currentTarget.style.background = `${ACCENT}15`;
              }}
              onMouseLeave={(e) => {
                const active = channel.tier === tier;
                e.currentTarget.style.borderColor = active
                  ? ACCENT
                  : `${ACCENT}40`;
                e.currentTarget.style.color = active ? ACCENT : `${ACCENT}80`;
                e.currentTarget.style.background = active
                  ? `${ACCENT}20`
                  : "none";
              }}
            >
              {TIER_LABELS[tier]}
            </button>
          ),
        )}
      </div>

      {/* Delete */}
      <button
        onClick={() => onDelete(channel.id)}
        style={redBtnStyle()}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = RED;
          e.currentTarget.style.color = RED;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = `${RED}40`;
          e.currentTarget.style.color = `${RED}99`;
        }}
      >
        delete
      </button>
    </div>
  );
}

/* ── Staging Video Row ─────────────────────────────── */
function VideoRow({
  video,
  onPin,
  onDelete,
}: {
  video: StagingVideo;
  onPin: (videoId: number) => void;
  onDelete: (videoId: number) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.6rem 0",
        borderBottom: `1px solid #1a1a1a`,
        flexWrap: "wrap",
      }}
    >
      {/* Thumbnail */}
      <a
        href={`https://www.youtube.com/watch?v=${video.youtube_video_id}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ flexShrink: 0, display: "block" }}
      >
        {video.thumbnail_url ? (
          <img
            src={video.thumbnail_url}
            alt={video.title}
            style={{
              width: 64,
              height: 36,
              objectFit: "cover",
              borderRadius: 2,
              background: "#1a1a1a",
              border: `1px solid #222`,
            }}
          />
        ) : (
          <div
            style={{
              width: 64,
              height: 36,
              borderRadius: 2,
              background: "#1a1a1a",
              border: `1px solid #222`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#444",
              fontSize: "0.6rem",
              fontFamily: "monospace",
            }}
          >
            no img
          </div>
        )}
      </a>

      {/* Title + channel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: "0.8rem",
            color: "#ccc",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {video.title}
        </p>
        {video.channel_name && (
          <p
            style={{
              fontSize: "0.7rem",
              color: "#555",
              fontFamily: "var(--font-headline)",
              marginTop: 2,
            }}
          >
            {video.channel_name}
          </p>
        )}
      </div>

      {/* Pin */}
      <button
        onClick={() => onPin(video.id)}
        style={accentBtnStyle(video.pinned)}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = ACCENT;
          e.currentTarget.style.color = ACCENT;
          e.currentTarget.style.background = `${ACCENT}15`;
        }}
        onMouseLeave={(e) => {
          const active = video.pinned;
          e.currentTarget.style.borderColor = active ? ACCENT : `${ACCENT}40`;
          e.currentTarget.style.color = active ? ACCENT : `${ACCENT}80`;
          e.currentTarget.style.background = active ? `${ACCENT}20` : "none";
        }}
      >
        {video.pinned ? "pinned" : "pin"}
      </button>

      {/* Delete */}
      <button
        onClick={() => onDelete(video.id)}
        style={redBtnStyle()}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = RED;
          e.currentTarget.style.color = RED;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = `${RED}40`;
          e.currentTarget.style.color = `${RED}99`;
        }}
      >
        delete
      </button>
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────── */
export default function WatchesStagingPage() {
  const [channels, setChannels] = useState<StagingChannel[]>([]);
  const [videos, setVideos] = useState<StagingVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getAdminToken();
    if (!token) return;

    fetch(`${API}/api/watches/staging/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        const data: WatchStagingResponse = await res.json();
        setChannels(data.channels);
        setVideos(data.videos);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load staging");
      })
      .finally(() => setLoading(false));
  }, []);

  async function promoteChannel(id: number, tier: ChannelTier) {
    const token = getAdminToken();
    if (!token) return;
    const res = await fetch(`${API}/api/watches/channels/${id}/tier/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tier }),
    });
    if (res.ok) {
      setChannels((prev) => prev.filter((c) => c.id !== id));
    }
  }

  async function deleteChannel(id: number) {
    const token = getAdminToken();
    if (!token) return;
    const res = await fetch(`${API}/api/watches/channels/${id}/delete/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setChannels((prev) => prev.filter((c) => c.id !== id));
    }
  }

  async function pinVideo(id: number) {
    const token = getAdminToken();
    if (!token) return;
    const res = await fetch(`${API}/api/watches/videos/${id}/pin/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setVideos((prev) => prev.filter((v) => v.id !== id));
    }
  }

  async function deleteVideo(id: number) {
    const token = getAdminToken();
    if (!token) return;
    const res = await fetch(`${API}/api/watches/videos/${id}/delete/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setVideos((prev) => prev.filter((v) => v.id !== id));
    }
  }

  if (loading) {
    return (
      <div
        style={{
          maxWidth: 800,
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
      <title>Watches — Staging</title>

      <div
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "2rem 1.5rem 6rem",
          position: "relative" as const,
          zIndex: 1,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            marginBottom: "2rem",
          }}
        >
          <a
            href="/watches"
            style={{
              color: `${ACCENT}80`,
              textDecoration: "none",
              fontFamily: "var(--font-headline)",
              fontSize: "0.75rem",
              letterSpacing: "0.1em",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = ACCENT;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = `${ACCENT}80`;
            }}
          >
            ← watches
          </a>
          <h1
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "1.25rem",
              fontWeight: 700,
              color: ACCENT,
              letterSpacing: "-0.02em",
            }}
          >
            Staging
          </h1>
        </div>

        {/* Error */}
        {error && (
          <p
            style={{
              color: RED,
              fontSize: "0.8rem",
              marginBottom: "1rem",
              fontFamily: "monospace",
            }}
          >
            Error: {error}
          </p>
        )}

        {/* Channels section */}
        <section style={{ marginBottom: "3rem" }}>
          <h2
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.75rem",
              fontWeight: 700,
              color: `${ACCENT}cc`,
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              marginBottom: "1rem",
              borderBottom: `1px solid ${ACCENT}20`,
              paddingBottom: "0.5rem",
            }}
          >
            Channels ({channels.length})
          </h2>

          {channels.length === 0 ? (
            <p
              style={{
                fontStyle: "italic",
                color: "#444",
                fontSize: "0.8rem",
                fontFamily: "monospace",
              }}
            >
              no staged channels
            </p>
          ) : (
            channels.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                onPromote={promoteChannel}
                onDelete={deleteChannel}
              />
            ))
          )}
        </section>

        {/* Videos section */}
        <section>
          <h2
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.75rem",
              fontWeight: 700,
              color: `${ACCENT}cc`,
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              marginBottom: "1rem",
              borderBottom: `1px solid ${ACCENT}20`,
              paddingBottom: "0.5rem",
            }}
          >
            Videos ({videos.length})
          </h2>

          {videos.length === 0 ? (
            <p
              style={{
                fontStyle: "italic",
                color: "#444",
                fontSize: "0.8rem",
                fontFamily: "monospace",
              }}
            >
              no staged videos
            </p>
          ) : (
            videos.map((video) => (
              <VideoRow
                key={video.id}
                video={video}
                onPin={pinVideo}
                onDelete={deleteVideo}
              />
            ))
          )}
        </section>
      </div>
    </>
  );
}
