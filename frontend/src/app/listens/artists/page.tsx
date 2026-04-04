"use client";

import { useCallback, useEffect, useState } from "react";
import { API, type ListenTopArtist, type ListenTrack } from "@/lib/api";
import { store } from "@/lib/auth";
import { usePlayer } from "@/lib/player";
import { useBreakpoint } from "@/lib/useBreakpoint";

const ACCENT = "#f97316";
const PANEL_BG = "rgba(14, 14, 14, 0.5)";
const PAGE_SIZE = 30;

export default function ListensArtistsPage() {
  const player = usePlayer();
  const bp = useBreakpoint();
  const [artists, setArtists] = useState<ListenTopArtist[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");

  const fetchArtists = useCallback(async (offset: number) => {
    const resp = await fetch(`${API}/api/listens/artists/?limit=${PAGE_SIZE}&offset=${offset}`);
    return resp.json();
  }, []);

  useEffect(() => {
    fetchArtists(0).then((data) => {
      setArtists(data.artists || []);
      setTotal(data.total || 0);
      setLoading(false);
    });
  }, [fetchArtists]);

  const loadMore = async () => {
    setLoadingMore(true);
    const data = await fetchArtists(artists.length);
    setArtists((prev) => [...prev, ...(data.artists || [])]);
    setLoadingMore(false);
  };

  if (loading)
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        Loading...
      </div>
    );
  if (artists.length === 0)
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        No artists yet.
      </div>
    );

  return (
    <div style={{ background: PANEL_BG, backdropFilter: "blur(12px)", borderRadius: "0 0 8px 8px", padding: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: bp === "mobile" ? "1fr" : bp === "tablet" ? "repeat(2, 1fr)" : "repeat(3, 1fr)", gridAutoRows: "1fr", gap: 12 }}>
        {artists.map((artist) => (
          <div
            key={artist.name}
            style={{
              background: "rgba(20, 20, 20, 0.6)",
              border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: 8,
              padding: 16,
              transition: "border-color 0.15s",
              display: "flex",
              flexDirection: "column" as const,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(249,115,22,0.2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.05)";
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: `color-mix(in srgb, ${ACCENT} 25%, #1a1a1a)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  color: ACCENT,
                  fontWeight: "bold",
                  fontFamily: "var(--font-headline)",
                  flexShrink: 0,
                }}
              >
                {artist.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: "#eee",
                    fontSize: 14,
                    fontFamily: "var(--font-headline)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {artist.name}
                </div>
                <div style={{ color: "#666", fontSize: 10, fontFamily: "monospace" }}>
                  {artist.play_count}× · {artist.track_count} {artist.track_count === 1 ? "track" : "tracks"}
                </div>
              </div>
              {isAdmin && (
                <button
                  onClick={() => {
                    const queue: ListenTrack[] = artist.top_tracks.map((t) => ({
                      id: 0,
                      video_id: t.video_id,
                      title: t.title,
                      artist: artist.name,
                      album: "",
                      thumbnail_url: t.thumbnail_url,
                      duration: "",
                      played_at: "",
                    }));
                    if (queue.length) player.play(queue[0], queue);
                  }}
                  style={{
                    background: "none",
                    border: `1px solid rgba(249,115,22,0.3)`,
                    color: ACCENT,
                    borderRadius: 4,
                    padding: "3px 8px",
                    cursor: "pointer",
                    fontSize: 10,
                    flexShrink: 0,
                  }}
                >
                  ▶ ALL
                </button>
              )}
            </div>
            {artist.top_tracks.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                {artist.top_tracks.map((t) => (
                  <div key={t.video_id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {t.thumbnail_url ? (
                      <img
                        src={t.thumbnail_url}
                        alt=""
                        style={{ width: 20, height: 20, borderRadius: 2, objectFit: "cover", flexShrink: 0 }}
                      />
                    ) : (
                      <div style={{ width: 20, height: 20, borderRadius: 2, background: "#222", flexShrink: 0 }} />
                    )}
                    <div
                      style={{
                        color: "#aaa",
                        fontSize: 10,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {t.title}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {artists.length < total && (
        <div style={{ textAlign: "center", padding: "16px 0 4px" }}>
          <button
            onClick={loadMore}
            disabled={loadingMore}
            style={{
              background: "none",
              border: "none",
              color: loadingMore ? "#444" : ACCENT,
              fontSize: 10,
              letterSpacing: 1,
              fontFamily: "monospace",
              cursor: loadingMore ? "default" : "pointer",
              padding: "8px 16px",
            }}
          >
            {loadingMore ? "LOADING..." : "LOAD MORE"}
          </button>
        </div>
      )}
    </div>
  );
}
