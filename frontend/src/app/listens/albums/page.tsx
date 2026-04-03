"use client";

import { useCallback, useEffect, useState } from "react";
import { API, type ListenTopAlbum, type ListenTrack } from "@/lib/api";
import { store } from "@/lib/auth";
import { usePlayer } from "@/lib/player";
import { useBreakpoint } from "@/lib/useBreakpoint";

const ACCENT = "#f97316";
const PANEL_BG = "rgba(14, 14, 14, 0.5)";
const PAGE_SIZE = 30;

export default function ListensAlbumsPage() {
  const player = usePlayer();
  const bp = useBreakpoint();
  const [albums, setAlbums] = useState<ListenTopAlbum[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");

  const fetchAlbums = useCallback(async (offset: number) => {
    const resp = await fetch(`${API}/api/listens/albums/?limit=${PAGE_SIZE}&offset=${offset}`);
    return resp.json();
  }, []);

  useEffect(() => {
    fetchAlbums(0).then((data) => {
      setAlbums(data.albums || []);
      setTotal(data.total || 0);
      setLoading(false);
    });
  }, [fetchAlbums]);

  const loadMore = async () => {
    setLoadingMore(true);
    const data = await fetchAlbums(albums.length);
    setAlbums((prev) => [...prev, ...(data.albums || [])]);
    setLoadingMore(false);
  };

  if (loading)
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        Loading...
      </div>
    );
  if (albums.length === 0)
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        No albums yet.
      </div>
    );

  return (
    <div style={{ background: PANEL_BG, backdropFilter: "blur(12px)", borderRadius: "0 0 8px 8px", padding: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: bp === "mobile" ? "1fr" : bp === "tablet" ? "repeat(2, 1fr)" : "repeat(3, 1fr)", gap: 12 }}>
        {albums.map((album) => (
          <div
            key={`${album.name}-${album.artist}`}
            style={{
              background: "rgba(20, 20, 20, 0.6)",
              border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: 8,
              transition: "border-color 0.15s",
              cursor: isAdmin ? "pointer" : "default",
            }}
            onClick={async () => {
              if (!isAdmin) return;
              const resp = await fetch(`${API}/api/listens/?limit=200&offset=0`);
              const data = await resp.json();
              const seen = new Set<string>();
              const queue: ListenTrack[] = [];
              for (const t of data.tracks as ListenTrack[]) {
                if (t.album === album.name && t.artist === album.artist && !seen.has(t.video_id)) {
                  seen.add(t.video_id);
                  queue.push(t);
                }
              }
              if (queue.length) player.play(queue[0], queue);
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(249,115,22,0.2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.05)";
            }}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "center", padding: 14 }}>
              {album.thumbnail_url ? (
                <img
                  src={album.thumbnail_url}
                  alt=""
                  style={{ width: 56, height: 56, borderRadius: 4, objectFit: "cover", flexShrink: 0 }}
                />
              ) : (
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 4,
                    background: `color-mix(in srgb, ${ACCENT} 15%, #111)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    color: ACCENT,
                    fontWeight: "bold",
                    flexShrink: 0,
                  }}
                >
                  {album.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: "#eee",
                    fontSize: 13,
                    fontFamily: "var(--font-headline)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    marginBottom: 2,
                  }}
                >
                  {album.name}
                </div>
                <div style={{ color: "#888", fontSize: 10, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{album.artist}</div>
                <div style={{ color: "#555", fontSize: 10, fontFamily: "monospace" }}>
                  {album.play_count}× · {album.track_count} {album.track_count === 1 ? "track" : "tracks"}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {albums.length < total && (
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
