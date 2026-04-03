"use client";

import { useCallback, useEffect, useState } from "react";
import { API, type ListenTrack } from "@/lib/api";
import { store } from "@/lib/auth";
import { timeAgo } from "@/lib/date";
import { usePlayer } from "@/lib/player";

const ACCENT = "#f97316";
const PANEL_BG = "rgba(14, 14, 14, 0.5)";
const PAGE_SIZE = 50;

export default function ListensHistoryPage() {
  const player = usePlayer();
  const [tracks, setTracks] = useState<ListenTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");

  const fetchTracks = useCallback(async (offset: number) => {
    const resp = await fetch(`${API}/api/listens/?limit=${PAGE_SIZE}&offset=${offset}`);
    return resp.json();
  }, []);

  useEffect(() => {
    fetchTracks(0).then((data) => {
      setTracks(data.tracks || []);
      setTotal(data.total || 0);
      setLoading(false);
    });
  }, [fetchTracks]);

  // Handle OAuth callback error
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) {
      setError(err);
      window.history.replaceState({}, "", "/listens");
    }
  }, []);

  const loadMore = async () => {
    setLoadingMore(true);
    const data = await fetchTracks(tracks.length);
    setTracks((prev) => [...prev, ...(data.tracks || [])]);
    setLoadingMore(false);
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        Loading...
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        No listening history yet.
      </div>
    );
  }

  return (
    <div style={{ background: PANEL_BG, backdropFilter: "blur(12px)", borderRadius: "0 0 8px 8px", padding: 20 }}>
      {error && (
        <div
          style={{
            padding: "10px 14px", marginBottom: 16,
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 6, color: "#f87171", fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px" }}>
        {tracks.map((track, i) => (
          <div
            key={`${track.id}-${i}`}
            style={{
              display: "flex", gap: 10, alignItems: "center", padding: "8px 4px",
              borderBottom: "1px solid rgba(255,255,255,0.03)", borderRadius: 4,
              cursor: isAdmin ? "pointer" : "default", transition: "background 0.15s",
            }}
            onClick={() => { if (isAdmin) player.play(track, tracks); }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
          >
            {track.thumbnail_url ? (
              <img src={track.thumbnail_url} alt="" style={{ width: 36, height: 36, borderRadius: 3, objectFit: "cover", flexShrink: 0 }} />
            ) : (
              <div style={{ width: 36, height: 36, borderRadius: 3, background: "#1a1a1a", flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#ddd", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {track.title}
              </div>
              <div style={{ color: "#666", fontSize: 10 }}>{track.artist}</div>
            </div>
            <div style={{ color: "#444", fontSize: 10, fontFamily: "monospace", flexShrink: 0 }}>
              {timeAgo(track.played_at)}
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
              background: "none", border: "none",
              color: loadingMore ? "#444" : ACCENT,
              fontSize: 10, letterSpacing: 1, fontFamily: "monospace",
              cursor: loadingMore ? "default" : "pointer", padding: "8px 16px",
            }}
          >
            {loadingMore ? "LOADING..." : "LOAD MORE"}
          </button>
        </div>
      )}
    </div>
  );
}
