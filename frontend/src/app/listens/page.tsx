"use client";

import { useCallback, useEffect, useState } from "react";

import { type ListenStats, type ListenTrack, API } from "@/lib/api";
import { getAdminToken, storeDel } from "@/lib/auth";
import { timeAgo } from "@/lib/date";

const ORANGE = "#f97316";

function formatTotal(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/* ── Now Playing Card ──────────────────────────────── */
function NowPlaying({ track }: { track: ListenTrack | null }) {
  if (!track) return null;
  return (
    <section>
      <div
        style={{
          background: "#1a1a1a",
          borderLeft: `2px solid ${ORANGE}`,
          padding: "1rem",
          display: "flex",
          gap: "1rem",
          alignItems: "center",
        }}
      >
        {track.thumbnail_url ? (
          <img
            src={track.thumbnail_url}
            alt={track.album || track.title}
            style={{
              width: 80,
              height: 80,
              borderRadius: 2,
              objectFit: "cover",
              flexShrink: 0,
              background: "#2a2a2a",
            }}
          />
        ) : (
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: 2,
              flexShrink: 0,
              background: "#2a2a2a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#555",
              fontSize: "1.5rem",
            }}
          >
            ~
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: "0.625rem",
              fontFamily: "monospace",
              color: ORANGE,
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              marginBottom: 4,
            }}
          >
            Latest
          </p>
          <h2
            style={{
              fontSize: "1.125rem",
              fontWeight: 700,
              lineHeight: 1.2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {track.title}
          </h2>
          <p
            style={{
              color: "#a3a3a3",
              fontSize: "0.875rem",
              fontFamily: "var(--font-headline)",
            }}
          >
            {track.artist}
          </p>
          {track.album && (
            <p
              style={{
                color: "#666",
                fontSize: "0.75rem",
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {track.album}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Track Row ─────────────────────────────────────── */
function TrackRow({ track }: { track: ListenTrack }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        padding: "0.75rem 0.5rem",
        borderBottom: "1px solid #1f1f1f",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "#1a1a1a";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {track.thumbnail_url ? (
        <img
          src={track.thumbnail_url}
          alt=""
          style={{
            width: 40,
            height: 40,
            borderRadius: 2,
            objectFit: "cover",
            flexShrink: 0,
            background: "#2a2a2a",
          }}
        />
      ) : (
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 2,
            flexShrink: 0,
            background: "#2a2a2a",
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: "0.875rem",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {track.title}
        </p>
        <p
          style={{
            fontSize: "0.75rem",
            color: "#666",
            fontFamily: "var(--font-headline)",
          }}
        >
          {track.artist}
        </p>
      </div>
      <span
        style={{
          fontFamily: "monospace",
          fontSize: "0.625rem",
          color: "#666",
          flexShrink: 0,
        }}
      >
        {timeAgo(track.played_at)}
      </span>
    </div>
  );
}

/* ── Top Track Card ────────────────────────────────── */
function TopTrackCard({
  track,
  large,
}: {
  track: ListenStats["top_tracks"][0];
  large?: boolean;
}) {
  return (
    <div
      style={{
        position: "relative",
        aspectRatio: "1",
        background: "#0e0e0e",
        borderRadius: 2,
        overflow: "hidden",
        ...(large ? { gridColumn: "span 2" } : {}),
      }}
    >
      {track.thumbnail_url && (
        <img
          src={track.thumbnail_url}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: large ? 0.6 : 0.4,
            transition: "opacity 0.3s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = large ? "0.7" : "0.6";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = large ? "0.6" : "0.4";
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: large ? 16 : 8,
          left: large ? 16 : 8,
          right: large ? 16 : 8,
        }}
      >
        <p
          style={{
            fontFamily: "monospace",
            color: ORANGE,
            fontSize: large ? "0.625rem" : "0.5rem",
            marginBottom: 2,
          }}
        >
          {track.play_count} PLAYS
        </p>
        <h4
          style={{
            fontFamily: "var(--font-headline)",
            fontWeight: 700,
            fontSize: large ? "1.125rem" : "0.625rem",
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {track.title}
        </h4>
        {large && (
          <p style={{ fontSize: "0.75rem", color: "#a3a3a3" }}>
            {track.artist}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Stats Bar ─────────────────────────────────────── */
function StatsBar({ stats }: { stats: ListenStats | null }) {
  if (!stats) return null;
  return (
    <section
      style={{
        borderTop: "1px solid #1f1f1f",
        borderBottom: "1px solid #1f1f1f",
        padding: "2rem 0",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "1rem",
          textAlign: "center",
        }}
      >
        {[
          { label: "Today", value: stats.today },
          { label: "Weekly", value: stats.week },
          { label: "Total", value: stats.total },
        ].map((s) => (
          <div key={s.label}>
            <p
              style={{
                fontFamily: "monospace",
                fontSize: "1.5rem",
                fontWeight: 700,
                color: ORANGE,
              }}
            >
              {formatTotal(s.value)}
            </p>
            <p
              style={{
                fontFamily: "monospace",
                fontSize: "0.625rem",
                color: "#666",
                textTransform: "uppercase",
                letterSpacing: "0.15em",
              }}
            >
              {s.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Main Page ─────────────────────────────────────── */
export default function ListensPage() {
  const [tracks, setTracks] = useState<ListenTrack[]>([]);
  const [stats, setStats] = useState<ListenStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const token = getAdminToken();
    if (!token) return;

    try {
      const [tracksRes, statsRes] = await Promise.all([
        fetch(`${API}/api/listens/?limit=50`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API}/api/listens/stats/`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (tracksRes.status === 401 || statsRes.status === 401) {
        storeDel("adminToken");
        window.location.href = `/sudo?from=${encodeURIComponent(window.location.pathname)}`;
        return;
      }

      if (tracksRes.ok) {
        const data = await tracksRes.json();
        setTracks(data.tracks);
      }
      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
    } catch {
      setError("Failed to load listening data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Check URL for error/success from OAuth callback
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error");
    if (oauthError) {
      setError(oauthError);
      window.history.replaceState({}, "", "/listens");
    }
  }, [fetchData]);

  function handleSync() {
    const token = getAdminToken();
    if (!token) return;
    // Redirect to Google OAuth flow — backend handles the rest
    window.location.href = `${API}/api/listens/auth/?token=${encodeURIComponent(token)}`;
  }

  const nowPlaying = tracks[0] ?? null;
  const recentTracks = tracks.slice(1);
  const topTracks = stats?.top_tracks ?? [];

  if (loading) {
    return (
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "2rem 1.5rem",
          textAlign: "center",
          color: "#666",
        }}
      >
        <p style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
          Loading...
        </p>
      </div>
    );
  }

  return (
    <>
      <title>Nam listens</title>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1.5rem" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "2rem",
          }}
        >
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <span style={{ color: ORANGE, fontSize: "0.75rem" }}>~</span>
            <h1
              style={{
                fontFamily: "var(--font-headline)",
                fontSize: "1.25rem",
                fontWeight: 700,
                color: ORANGE,
                letterSpacing: "-0.02em",
              }}
            >
              Listens
            </h1>
          </div>
          <button
            onClick={handleSync}
            style={{
              padding: "0.25rem 0.75rem",
              border: `1px solid ${ORANGE}40`,
              background: "none",
              color: ORANGE,
              fontFamily: "var(--font-headline)",
              fontSize: "0.6875rem",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              cursor: "pointer",
              transition: "border-color 0.2s, background 0.2s",
              borderRadius: 2,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = ORANGE;
              e.currentTarget.style.background = `${ORANGE}15`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = `${ORANGE}40`;
              e.currentTarget.style.background = "none";
            }}
          >
            Sync
          </button>
        </div>

        {/* Error */}
        {error && (
          <p
            style={{
              color: "#f87171",
              fontSize: "0.8rem",
              marginBottom: "1rem",
              fontFamily: "monospace",
            }}
          >
            {error}
          </p>
        )}

        {/* Content */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
          {/* Now Playing */}
          <NowPlaying track={nowPlaying} />

          {/* Recently Played */}
          {recentTracks.length > 0 && (
            <section>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  marginBottom: "1.5rem",
                }}
              >
                <h3
                  style={{
                    fontFamily: "var(--font-headline)",
                    fontWeight: 700,
                    fontSize: "1.25rem",
                    letterSpacing: "-0.02em",
                  }}
                >
                  Recently Played
                </h3>
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: "0.625rem",
                    color: "#666",
                  }}
                >
                  {recentTracks.length} /{" "}
                  {formatTotal(stats?.total ?? tracks.length)} TOTAL
                </span>
              </div>
              <div>
                {recentTracks.map((t) => (
                  <TrackRow key={t.id} track={t} />
                ))}
              </div>
            </section>
          )}

          {/* Top Tracks */}
          {topTracks.length > 0 && (
            <section>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  marginBottom: "1.5rem",
                }}
              >
                <h3
                  style={{
                    fontFamily: "var(--font-headline)",
                    fontWeight: 700,
                    fontSize: "1.25rem",
                    letterSpacing: "-0.02em",
                  }}
                >
                  Top This Month
                </h3>
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: "0.625rem",
                    color: ORANGE,
                  }}
                >
                  M_TRACK_01-{String(topTracks.length).padStart(2, "0")}
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "1rem",
                }}
              >
                {topTracks.map((t, i) => (
                  <TopTrackCard
                    key={t.video_id}
                    track={t}
                    large={i === 0}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Stats */}
          <StatsBar stats={stats} />

          {/* Empty state */}
          {tracks.length === 0 && !error && (
            <div style={{ textAlign: "center", padding: "3rem 0" }}>
              <p
                style={{
                  color: "#666",
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                  marginBottom: "1rem",
                }}
              >
                No listening data yet.
              </p>
              <p style={{ color: "#555", fontSize: "0.75rem" }}>
                Hit <span style={{ color: ORANGE }}>Sync</span> to pull your
                YouTube Music history.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
