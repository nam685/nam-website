"use client";

import { useEffect, useState } from "react";

import {
  type ChannelUploadsResponse,
  type StagingChannel,
  type UploadVideo,
  type WatchStagingResponse,
  API,
} from "@/lib/api";
import { getAdminToken } from "@/lib/auth";

const ACCENT = "#1e40af";
const RED = "#f87171";

type ChannelTier = "never_miss" | "regular" | "check_out" | "hidden";

const TIER_LABELS: Record<ChannelTier, string> = {
  never_miss: "never miss",
  regular: "regular",
  check_out: "check out",
  hidden: "hidden",
};

const TIER_SECTIONS: { tier: ChannelTier; label: string }[] = [
  { tier: "never_miss", label: "NEVER MISS" },
  { tier: "regular", label: "ROTATION" },
  { tier: "check_out", label: "CHECK OUT" },
  { tier: "hidden", label: "HIDDEN" },
];

/* -- Shared button styles -------------------------------- */
function accentBtnStyle(active = false) {
  return {
    padding: "0.2rem 0.6rem",
    border: `1px solid ${active ? ACCENT : `${ACCENT}50`}`,
    background: active ? `${ACCENT}35` : "none",
    color: active ? "#e5e2e1" : `${ACCENT}aa`,
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
    border: `1px solid ${RED}50`,
    background: "none",
    color: `${RED}bb`,
    fontFamily: "var(--font-headline)" as const,
    fontSize: "0.6rem" as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.1em" as const,
    cursor: "pointer" as const,
    borderRadius: 2,
    transition: "border-color 0.15s, color 0.15s",
  };
}

/* -- Channel Row ----------------------------------------- */
function ChannelRow({
  channel,
  onTierChange,
  onDelete,
  onPinVideo,
}: {
  channel: StagingChannel;
  onTierChange: (channelId: number, tier: ChannelTier) => void;
  onDelete: (channelId: number) => void;
  onPinVideo: (channel: StagingChannel) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.6rem 0",
        borderBottom: "1px solid #1a1a1a",
        flexWrap: "wrap",
      }}
    >
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

      <div style={{ flex: 1, minWidth: 120 }}>
        <a
          href={`https://www.youtube.com/channel/${channel.youtube_channel_id}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
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
        {channel.pinned_count > 0 && (
          <span
            style={{
              fontSize: "0.65rem",
              color: "#555",
              marginLeft: "0.5rem",
            }}
          >
            {channel.pinned_count} pinned
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
        {(
          ["never_miss", "regular", "check_out", "hidden"] as ChannelTier[]
        ).map((tier) => (
          <button
            key={tier}
            onClick={() => onTierChange(channel.id, tier)}
            style={accentBtnStyle(channel.tier === tier)}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = ACCENT;
              e.currentTarget.style.color = "#e5e2e1";
              e.currentTarget.style.background = `${ACCENT}20`;
            }}
            onMouseLeave={(e) => {
              const active = channel.tier === tier;
              e.currentTarget.style.borderColor = active
                ? ACCENT
                : `${ACCENT}50`;
              e.currentTarget.style.color = active ? "#e5e2e1" : `${ACCENT}aa`;
              e.currentTarget.style.background = active
                ? `${ACCENT}35`
                : "none";
            }}
          >
            {TIER_LABELS[tier]}
          </button>
        ))}
      </div>

      {channel.tier !== "hidden" && (
        <button
          onClick={() => onPinVideo(channel)}
          style={accentBtnStyle()}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = ACCENT;
            e.currentTarget.style.color = "#e5e2e1";
            e.currentTarget.style.background = `${ACCENT}20`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = `${ACCENT}50`;
            e.currentTarget.style.color = `${ACCENT}aa`;
            e.currentTarget.style.background = "none";
          }}
        >
          pin video
        </button>
      )}

      <button
        onClick={() => onDelete(channel.id)}
        style={redBtnStyle()}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = RED;
          e.currentTarget.style.color = RED;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = `${RED}50`;
          e.currentTarget.style.color = `${RED}bb`;
        }}
      >
        delete
      </button>
    </div>
  );
}

/* -- Pin Video Popup ------------------------------------- */
function PinVideoPopup({
  channel,
  onClose,
  onPinned,
}: {
  channel: StagingChannel;
  onClose: () => void;
  onPinned: (channelId: number, count: number) => void;
}) {
  const [uploads, setUploads] = useState<UploadVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pinning, setPinning] = useState(false);

  useEffect(() => {
    const token = getAdminToken();
    if (!token) return;
    fetch(`${API}/api/watches/channels/${channel.id}/uploads/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        const data: ChannelUploadsResponse = await res.json();
        setUploads(data.videos);
      })
      .catch(() => setUploads([]))
      .finally(() => setLoading(false));
  }, [channel.id]);

  function toggleSelect(videoId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  }

  async function handlePin() {
    const token = getAdminToken();
    if (!token || selected.size === 0) return;
    setPinning(true);
    try {
      const videosToPin = uploads.filter((v) =>
        selected.has(v.youtube_video_id),
      );
      const res = await fetch(
        `${API}/api/watches/channels/${channel.id}/pin-videos/`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ videos: videosToPin }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        onPinned(channel.id, data.pinned);
      }
    } finally {
      setPinning(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#111",
          border: `1px solid ${ACCENT}30`,
          borderRadius: 8,
          maxWidth: 600,
          width: "100%",
          maxHeight: "80vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "1rem 1.25rem",
            borderBottom: `1px solid ${ACCENT}20`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h3
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "#e5e2e1",
              margin: 0,
            }}
          >
            Pin videos — {channel.name}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#666",
              cursor: "pointer",
              fontSize: "1.2rem",
              padding: "0 0.25rem",
            }}
          >
            x
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.25rem" }}>
          {loading ? (
            <p
              style={{
                color: "#555",
                fontSize: "0.8rem",
                fontStyle: "italic",
                fontFamily: "monospace",
              }}
            >
              loading uploads...
            </p>
          ) : uploads.length === 0 ? (
            <p
              style={{
                color: "#555",
                fontSize: "0.8rem",
                fontStyle: "italic",
                fontFamily: "monospace",
              }}
            >
              no new uploads found
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: "0.75rem",
              }}
            >
              {uploads.map((video) => {
                const isSelected = selected.has(video.youtube_video_id);
                return (
                  <div
                    key={video.youtube_video_id}
                    onClick={() => toggleSelect(video.youtube_video_id)}
                    style={{
                      cursor: "pointer",
                      border: `2px solid ${isSelected ? ACCENT : "transparent"}`,
                      borderRadius: 4,
                      padding: "0.35rem",
                      background: isSelected ? `${ACCENT}15` : "transparent",
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                  >
                    {video.thumbnail_url ? (
                      <img
                        src={video.thumbnail_url}
                        alt={video.title}
                        style={{
                          width: "100%",
                          aspectRatio: "16/9",
                          objectFit: "cover",
                          borderRadius: 3,
                          background: "#1a1a1a",
                          display: "block",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          aspectRatio: "16/9",
                          background: "#1a1a1a",
                          borderRadius: 3,
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
                        fontSize: "0.7rem",
                        color: isSelected ? "#e5e2e1" : "#999",
                        marginTop: "0.3rem",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {video.title}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {uploads.length > 0 && (
          <div
            style={{
              padding: "0.75rem 1.25rem",
              borderTop: `1px solid ${ACCENT}20`,
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <button
              onClick={handlePin}
              disabled={selected.size === 0 || pinning}
              style={{
                padding: "0.35rem 1rem",
                border: `1px solid ${selected.size > 0 ? ACCENT : `${ACCENT}30`}`,
                background: selected.size > 0 ? `${ACCENT}25` : "none",
                color: selected.size > 0 ? "#e5e2e1" : "#555",
                fontFamily: "var(--font-headline)",
                fontSize: "0.7rem",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                cursor:
                  selected.size > 0 && !pinning ? "pointer" : "not-allowed",
                borderRadius: 3,
                transition: "all 0.15s",
              }}
            >
              {pinning ? "pinning..." : `pin selected (${selected.size})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* -- Main Page ------------------------------------------- */
export default function WatchesStagingPage() {
  const [channels, setChannels] = useState<StagingChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pinPopupChannel, setPinPopupChannel] = useState<StagingChannel | null>(
    null,
  );

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
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load staging");
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleTierChange(id: number, tier: ChannelTier) {
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
      setChannels((prev) =>
        prev.map((c) => (c.id === id ? { ...c, tier } : c)),
      );
    }
  }

  async function handleDelete(id: number) {
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

  function handlePinned(channelId: number, count: number) {
    setChannels((prev) =>
      prev.map((c) =>
        c.id === channelId
          ? { ...c, pinned_count: c.pinned_count + count }
          : c,
      ),
    );
    setPinPopupChannel(null);
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
          position: "relative",
          zIndex: 1,
        }}
      >
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

        {TIER_SECTIONS.map(({ tier, label }) => {
          const tierChannels = channels.filter((c) => c.tier === tier);
          return (
            <section key={tier} style={{ marginBottom: "2.5rem" }}>
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
                {label} ({tierChannels.length})
              </h2>

              {tierChannels.length === 0 ? (
                <p
                  style={{
                    fontStyle: "italic",
                    color: "#444",
                    fontSize: "0.8rem",
                    fontFamily: "monospace",
                  }}
                >
                  no channels
                </p>
              ) : (
                tierChannels.map((channel) => (
                  <ChannelRow
                    key={channel.id}
                    channel={channel}
                    onTierChange={handleTierChange}
                    onDelete={handleDelete}
                    onPinVideo={(ch) => setPinPopupChannel(ch)}
                  />
                ))
              )}
            </section>
          );
        })}
      </div>

      {pinPopupChannel && (
        <PinVideoPopup
          channel={pinPopupChannel}
          onClose={() => setPinPopupChannel(null)}
          onPinned={handlePinned}
        />
      )}
    </>
  );
}
