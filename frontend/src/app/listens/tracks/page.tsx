"use client";

import { useCallback, useEffect, useState } from "react";
import { API, type ListenTopTrack, type ListenTrack } from "@/lib/api";
import { store } from "@/lib/auth";
import { usePlayer } from "@/lib/player";

const ACCENT = "#f97316";
const PANEL_BG = "rgba(14, 14, 14, 0.5)";
const PAGE_SIZE = 50;

function topTrackToListenTrack(t: ListenTopTrack): ListenTrack {
  return {
    id: 0,
    video_id: t.video_id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    thumbnail_url: t.thumbnail_url,
    duration: "",
    played_at: "",
  };
}

export default function ListensTracksPage() {
  const player = usePlayer();
  const [tracks, setTracks] = useState<ListenTopTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");

  const fetchTracks = useCallback(async (offset: number) => {
    const resp = await fetch(`${API}/api/listens/tracks/?limit=${PAGE_SIZE}&offset=${offset}`);
    return resp.json();
  }, []);

  useEffect(() => {
    fetchTracks(0).then((data) => {
      setTracks(data.tracks || []);
      setTotal(data.total || 0);
      setLoading(false);
    });
  }, [fetchTracks]);

  const loadMore = async () => {
    setLoadingMore(true);
    const data = await fetchTracks(tracks.length);
    setTracks((prev) => [...prev, ...(data.tracks || [])]);
    setLoadingMore(false);
  };

  if (loading)
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        Loading...
      </div>
    );
  if (tracks.length === 0)
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        No tracks yet.
      </div>
    );

  const allAsListenTracks = tracks.map(topTrackToListenTrack);

  return (
    <div style={{ background: PANEL_BG, backdropFilter: "blur(12px)", borderRadius: "0 0 8px 8px", padding: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {tracks.map((track, i) => (
          <div
            key={track.video_id}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: "8px 6px",
              borderBottom: "1px solid rgba(255,255,255,0.03)",
              borderRadius: 4,
              cursor: isAdmin ? "pointer" : "default",
              transition: "background 0.15s",
            }}
            onClick={() => {
              if (isAdmin) player.play(allAsListenTracks[i], allAsListenTracks);
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "transparent";
            }}
          >
            <div
              style={{
                width: 28,
                textAlign: "right",
                color: i < 3 ? ACCENT : "#555",
                fontSize: 13,
                fontFamily: "monospace",
                fontWeight: i < 3 ? "bold" : "normal",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </div>
            {track.thumbnail_url ? (
              <img
                src={track.thumbnail_url}
                alt=""
                style={{ width: 40, height: 40, borderRadius: 3, objectFit: "cover", flexShrink: 0 }}
              />
            ) : (
              <div style={{ width: 40, height: 40, borderRadius: 3, background: "#1a1a1a", flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{ color: "#ddd", fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {track.title}
              </div>
              <div style={{ color: "#666", fontSize: 10 }}>{track.artist}</div>
            </div>
            <div style={{ color: ACCENT, fontSize: 12, fontFamily: "monospace", flexShrink: 0 }}>
              {track.play_count}×
            </div>
          </div>
        ))}
      </div>
      {tracks.length < total && (
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
