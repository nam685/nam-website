"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  API,
  type ListenTrack,
  type ListenStats,
  type ListenRecommended,
} from "@/lib/api";
import { store } from "@/lib/auth";
import { usePlayer } from "@/lib/player";
import { useBreakpoint } from "@/lib/useBreakpoint";

const ACCENT = "#f97316";
const PANEL_BG = "transparent";

const TABS = [
  { label: "History", href: "/listens" },
  { label: "Tracks", href: "/listens/tracks" },
  { label: "Artists", href: "/listens/artists" },
  { label: "Albums", href: "/listens/albums" },
] as const;

export default function ListensLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const player = usePlayer();
  const bp = useBreakpoint();
  const isMobile = bp === "mobile";
  const [recommended, setRecommended] = useState<ListenRecommended | null>(
    null,
  );
  const [stats, setStats] = useState<ListenStats | null>(null);
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/listens/recommended/`).then((r) => r.json()),
      fetch(`${API}/api/listens/stats/`).then((r) => r.json()),
    ]).then(([recData, statsData]) => {
      setRecommended(recData.track || null);
      setStats(statsData);
    });
  }, []);

  const topTracks = stats?.top_tracks || [];
  const daily = stats?.daily || [];
  const maxDaily = Math.max(...daily.map((d) => d.count), 1);

  return (
    <div
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "0.5rem 1.5rem 2rem",
      }}
    >
      {/* Tagline */}
      <p
        style={{
          fontStyle: "italic",
          color: "#888",
          fontSize: "0.85rem",
          letterSpacing: "0.02em",
          marginBottom: "1rem",
        }}
      >
        vibing...
      </p>

      {/* ---- Mobile compact stats bar ---- */}
      {isMobile && stats && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-around",
            padding: 14,
            background: PANEL_BG,
            borderRadius: "8px 8px 0 0",
            marginBottom: 1,
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ color: ACCENT, fontSize: 16, fontWeight: "bold" }}>
              {stats.today}
            </div>
            <div
              style={{
                color: "#888",
                fontSize: 8,
                letterSpacing: 1,
                fontFamily: "monospace",
              }}
            >
              TODAY
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: ACCENT, fontSize: 16, fontWeight: "bold" }}>
              {stats.week}
            </div>
            <div
              style={{
                color: "#888",
                fontSize: 8,
                letterSpacing: 1,
                fontFamily: "monospace",
              }}
            >
              WEEK
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: ACCENT, fontSize: 16, fontWeight: "bold" }}>
              {stats.total.toLocaleString()}
            </div>
            <div
              style={{
                color: "#888",
                fontSize: 8,
                letterSpacing: 1,
                fontFamily: "monospace",
              }}
            >
              TOTAL
            </div>
          </div>
        </div>
      )}

      {/* ---- Hero ---- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr",
          alignItems: "start",
          gap: 1,
          marginBottom: 0,
        }}
      >
        {/* Left panel */}
        <div
          style={{
            background: PANEL_BG,
            padding: 24,
            borderRadius: isMobile && stats ? 0 : "8px 0 0 8px",
          }}
        >
          {/* Recommended */}
          <div
            style={{
              color: ACCENT,
              fontSize: 10,
              letterSpacing: 2,
              fontFamily: "monospace",
              marginBottom: 12,
            }}
          >
            RECOMMENDED
          </div>
          {recommended ? (
            <div
              style={{
                display: "flex",
                gap: 16,
                alignItems: "center",
                marginBottom: 24,
                cursor: isAdmin ? "pointer" : "default",
                borderRadius: 6,
                padding: "6px 0",
              }}
              onClick={() => {
                if (!isAdmin) return;
                player.play({
                  id: 0,
                  video_id: recommended.video_id,
                  title: recommended.title,
                  artist: recommended.artist,
                  album: recommended.album,
                  thumbnail_url: recommended.thumbnail_url,
                  duration: "",
                  played_at: "",
                });
              }}
            >
              {recommended.thumbnail_url ? (
                <img
                  src={recommended.thumbnail_url}
                  alt=""
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 6,
                    objectFit: "cover",
                    aspectRatio: "1/1",
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 6,
                    background: ACCENT,
                    opacity: 0.4,
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    color: "#eee",
                    fontSize: 18,
                    fontFamily: "var(--font-headline)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {recommended.title}
                </div>
                <div
                  style={{
                    color: "#999",
                    fontSize: 13,
                    marginTop: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {recommended.artist}
                  {recommended.album ? ` — ${recommended.album}` : ""}
                </div>
                <div
                  style={{
                    color: "#888",
                    fontSize: 11,
                    marginTop: 4,
                    fontFamily: "monospace",
                  }}
                >
                  {recommended.play_count}× played
                </div>
              </div>
              {isAdmin && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const token = store("adminToken");
                    if (token) {
                      fetch(`${API}/api/listens/sync/`, {
                        method: "POST",
                        headers: { Authorization: `Bearer ${token}` },
                      });
                    }
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = `rgba(249,115,22,0.15)`;
                    e.currentTarget.style.borderColor = ACCENT;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "none";
                    e.currentTarget.style.borderColor = "rgba(249,115,22,0.3)";
                  }}
                  style={{
                    background: "none",
                    border: `1px solid rgba(249,115,22,0.3)`,
                    color: ACCENT,
                    borderRadius: 4,
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontSize: 10,
                    fontFamily: "monospace",
                    letterSpacing: 1,
                    flexShrink: 0,
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                >
                  SYNC
                </button>
              )}
            </div>
          ) : (
            <div style={{ color: "#888", marginBottom: 24 }}>
              Not enough data for recommendations yet.
            </div>
          )}

          {/* Top This Month */}
          {topTracks.length > 0 && (
            <>
              <div
                style={{
                  color: ACCENT,
                  fontSize: 10,
                  letterSpacing: 1,
                  fontFamily: "monospace",
                  marginBottom: 10,
                }}
              >
                TOP THIS MONTH
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  paddingBottom: 4,
                }}
              >
                {topTracks.slice(0, 12).map((t, i) => (
                  <div
                    key={t.video_id}
                    style={{
                      width: 96,
                      background: "rgba(20,20,20,0.6)",
                      borderRadius: 6,
                      padding: 8,
                      border: "1px solid rgba(255,255,255,0.05)",
                      cursor: isAdmin ? "pointer" : "default",
                      overflow: "hidden",
                    }}
                    onClick={() => {
                      if (!isAdmin) return;
                      const queue: ListenTrack[] = topTracks
                        .slice(0, 10)
                        .map((tt) => ({
                          id: 0,
                          video_id: tt.video_id,
                          title: tt.title,
                          artist: tt.artist,
                          album: "",
                          thumbnail_url: tt.thumbnail_url,
                          duration: "",
                          played_at: "",
                        }));
                      player.play(queue[i], queue);
                    }}
                  >
                    {t.thumbnail_url ? (
                      <img
                        src={t.thumbnail_url}
                        alt=""
                        style={{
                          width: 80,
                          height: 80,
                          aspectRatio: "1/1",
                          borderRadius: 4,
                          objectFit: "cover",
                          marginBottom: 6,
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 80,
                          height: 80,
                          borderRadius: 4,
                          background: "#1a1a1a",
                          marginBottom: 6,
                        }}
                      />
                    )}
                    <div
                      style={{
                        color: "#ccc",
                        fontSize: 10,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {t.title}
                    </div>
                    <div
                      style={{
                        color: "#666",
                        fontSize: 9,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {t.artist} · {t.play_count}×
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right panel */}
        {!isMobile && (
          <div
            style={{
              background: PANEL_BG,
                padding: 24,
              borderRadius: "0 8px 8px 0",
            }}
          >
            {stats && (
              <>
                <div
                  style={{
                    color: ACCENT,
                    fontSize: 32,
                    fontWeight: "bold",
                    fontFamily: "var(--font-headline)",
                  }}
                >
                  {stats.total.toLocaleString()}
                </div>
                <div
                  style={{
                    color: "#888",
                    fontSize: 10,
                    letterSpacing: 2,
                    fontFamily: "monospace",
                    marginBottom: 20,
                  }}
                >
                  TOTAL PLAYS
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 24,
                    marginBottom: 20,
                  }}
                >
                  <div>
                    <div
                      style={{
                        color: ACCENT,
                        fontSize: 20,
                        fontFamily: "var(--font-headline)",
                      }}
                    >
                      {stats.today}
                    </div>
                    <div
                      style={{
                        color: "#888",
                        fontSize: 9,
                        letterSpacing: 1,
                        fontFamily: "monospace",
                      }}
                    >
                      TODAY
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        color: ACCENT,
                        fontSize: 20,
                        fontFamily: "var(--font-headline)",
                      }}
                    >
                      {stats.week}
                    </div>
                    <div
                      style={{
                        color: "#888",
                        fontSize: 9,
                        letterSpacing: 1,
                        fontFamily: "monospace",
                      }}
                    >
                      THIS WEEK
                    </div>
                  </div>
                </div>

                {/* Sparkline */}
                {daily.length > 0 && (
                  <>
                    <div
                      style={{
                        color: "#888",
                        fontSize: 9,
                        letterSpacing: 1,
                        fontFamily: "monospace",
                        marginBottom: 8,
                      }}
                    >
                      LAST 30 DAYS
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-end",
                        gap: 2,
                        height: 50,
                        marginBottom: 20,
                      }}
                    >
                      {daily.map((d) => (
                        <div
                          key={d.date}
                          style={{
                            flex: 1,
                            background: ACCENT,
                            opacity: 0.15 + (d.count / maxDaily) * 0.7,
                            height: `${Math.max(4, (d.count / maxDaily) * 100)}%`,
                            borderRadius: 1,
                          }}
                          title={`${d.date}: ${d.count}`}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* Top Artists (derived from top_tracks) */}
                {stats.top_tracks.length > 0 && (
                  <>
                    <div
                      style={{
                        color: "#888",
                        fontSize: 9,
                        letterSpacing: 1,
                        fontFamily: "monospace",
                        marginBottom: 8,
                      }}
                    >
                      TOP ARTISTS
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {(() => {
                        const artistMap = new Map<string, number>();
                        for (const t of stats.top_tracks) {
                          artistMap.set(
                            t.artist,
                            (artistMap.get(t.artist) || 0) + t.play_count,
                          );
                        }
                        return [...artistMap.entries()]
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 3)
                          .map(([name, count]) => (
                            <div
                              key={name}
                              style={{
                                display: "flex",
                                gap: 8,
                                alignItems: "center",
                              }}
                            >
                              <div
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: "50%",
                                  background: `color-mix(in srgb, ${ACCENT} 30%, #222)`,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 10,
                                  color: ACCENT,
                                  fontWeight: "bold",
                                  flexShrink: 0,
                                }}
                              >
                                {name.charAt(0).toUpperCase()}
                              </div>
                              <div
                                style={{ color: "#ccc", fontSize: 11, flex: 1 }}
                              >
                                {name}
                              </div>
                              <div
                                style={{
                                  color: "#888",
                                  fontSize: 10,
                                  fontFamily: "monospace",
                                }}
                              >
                                {count}×
                              </div>
                            </div>
                          ));
                      })()}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ---- Tab bar ---- */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          marginTop: 1,
          background: PANEL_BG,
          overflowX: "auto",
        }}
      >
        {TABS.map((tab) => {
          const active =
            tab.href === "/listens"
              ? pathname === "/listens"
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                padding: "10px 20px",
                color: active ? ACCENT : "#555",
                fontSize: 11,
                letterSpacing: 1,
                fontFamily: "monospace",
                textDecoration: "none",
                borderBottom: active
                  ? `2px solid ${ACCENT}`
                  : "2px solid transparent",
                whiteSpace: "nowrap",
                transition: "color 0.15s",
              }}
            >
              {tab.label.toUpperCase()}
            </Link>
          );
        })}
      </div>

      {/* ---- Sub-route content ---- */}
      <div style={{ marginTop: 1 }}>{children}</div>

      {/* ---- Tagline ---- */}
      <div style={{ textAlign: "center", marginTop: "3rem" }}>
        <span
          style={{
            fontFamily: "var(--font-headline)",
            fontSize: "0.6rem",
            color: "#2a2a2a",
            letterSpacing: "0.2em",
            textTransform: "lowercase",
          }}
        >
          vibing...
        </span>
      </div>
    </div>
  );
}
