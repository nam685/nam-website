"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  API,
  type GraphPatch,
  type GraphSearchResult,
  type ListenStats,
  type ListenTrack,
} from "@/lib/api";
import { getAdminToken, storeDel, useIsAdmin } from "@/lib/auth";
import { toForceData, type ForceNode } from "@/lib/graph";
import GraphCanvas from "@/components/GraphCanvas";
import { usePlayer } from "@/lib/player";

const ACCENT = "#f97316";

export default function ListensGraphPage() {
  const player = usePlayer();
  // Gate admin controls (SYNC / AUTH) behind a *server-validated* admin token — a stale/expired
  // token must not surface these buttons.
  const isAdmin = useIsAdmin();
  const [patch, setPatch] = useState<GraphPatch | null>(null);
  const [stats, setStats] = useState<ListenStats | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GraphSearchResult[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [syncMessage, setSyncMessage] = useState("");
  const [showReauth, setShowReauth] = useState(false);
  const [reauthHeaders, setReauthHeaders] = useState("");
  const [reauthStatus, setReauthStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [reauthError, setReauthError] = useState("");

  // Admin actions require a valid token; bounce expired/absent sessions to the login.
  const handleAuthExpired = () => {
    storeDel("adminToken");
    if (typeof window !== "undefined") window.location.href = "/sudo?from=/listens";
  };

  const loadPatch = useCallback(async (seed?: string, type?: string) => {
    const qs = seed ? `?seed=${encodeURIComponent(seed)}&type=${type ?? ""}` : "";
    const data: GraphPatch = await fetch(`${API}/api/listens/graph/patch/${qs}`).then((r) => r.json());
    setPatch(data);
  }, []);

  const loadStats = useCallback(() => {
    fetch(`${API}/api/listens/stats/`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  // Timers that reload the graph while the async (Celery) rebuild runs, so freshly-synced tracks
  // appear without a manual refresh. Tracked so they can be cleared on unmount / re-sync.
  const rebuildPollRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearRebuildPoll = useCallback(() => {
    rebuildPollRef.current.forEach(clearTimeout);
    rebuildPollRef.current = [];
  }, []);
  useEffect(() => clearRebuildPoll, [clearRebuildPoll]);

  useEffect(() => {
    loadPatch();
    loadStats();
  }, [loadPatch, loadStats]);

  // Follow the player: whenever the playing track changes (next/prev/auto-advance/radio), re-center
  // the graph on that song — same as clicking its node. Lets you "walk the graph" hands-free.
  const currentVideoId = player.queue[player.currentIndex]?.video_id;
  useEffect(() => {
    if (currentVideoId) loadPatch(currentVideoId, "song");
  }, [currentVideoId, loadPatch]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`${API}/api/listens/graph/search/?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((d) => setResults(d.results || []))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const playNode = (node: ForceNode) => {
    if (!isAdmin || !node.video_id) return;
    const track: ListenTrack = {
      id: 0,
      video_id: node.video_id,
      title: node.title,
      artist: node.subtitle || node.title,
      album: "",
      thumbnail_url: node.thumbnail_url,
      duration: "",
      played_at: "",
    };
    player.play(track, [track]);
  };

  const doSync = async () => {
    const token = getAdminToken(); // redirects to /sudo if no token
    if (!token) return;
    setSyncStatus("syncing");
    setSyncMessage("");
    try {
      const res = await fetch(`${API}/api/listens/sync/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      // 401 = admin token expired (bounce to login). YTM-cookie expiry is 409 — handled below
      // so it doesn't get mistaken for admin-token expiry and log the user out.
      if (res.status === 401) {
        handleAuthExpired();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.auth_expired) {
        setSyncStatus("error");
        setSyncMessage("YouTube Music session expired — re-authenticate below, then sync again.");
        setShowReauth(true);
        return; // leave the message + panel up; don't auto-clear
      }
      if (!res.ok) {
        setSyncStatus("error");
        setSyncMessage(data.error || "Sync failed.");
      } else {
        setSyncStatus("done");
        const newCount = (data.synced || 0) + (data.synced_liked || 0);
        // Tracks land in the DB immediately, so refresh the stats now — the total/today counters
        // jump right away instead of requiring a manual page reload.
        loadStats();
        if (newCount > 0 && data.graph_rebuilding) {
          // The graph rebuild (Last.fm pass) runs asynchronously in Celery and takes a few minutes.
          // Poll the graph a handful of times so the new nodes appear on their own once it finishes.
          setSyncMessage(`Synced ${newCount} tracks — graph updating in the background (~a few min).`);
          clearRebuildPoll();
          rebuildPollRef.current = [60, 150, 300].map((s) =>
            setTimeout(() => {
              loadPatch();
              loadStats();
            }, s * 1000),
          );
        } else if (newCount > 0) {
          setSyncMessage(`Synced ${newCount} tracks.`);
          loadPatch();
        } else {
          setSyncMessage("Already up to date.");
        }
      }
    } catch {
      setSyncStatus("error");
      setSyncMessage("Network error.");
    }
    setTimeout(() => {
      setSyncStatus("idle");
      setSyncMessage("");
    }, 4000);
  };

  const saveReauth = async () => {
    const token = getAdminToken(); // redirects to /sudo if no token
    if (!token) return;
    setReauthStatus("saving");
    setReauthError("");
    try {
      const res = await fetch(`${API}/api/listens/reauth/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ headers: reauthHeaders }),
      });
      if (res.status === 401) {
        // Admin token expired. Do NOT redirect/clear — that discards the pasted headers and is
        // exactly how this silently failed before. Keep the textarea; the user can re-login in a
        // new tab and click Save again (getAdminToken reads the refreshed token from storage).
        setReauthError("Admin login expired. Open /sudo in another tab, log in, then click SAVE again — your pasted headers are kept.");
        setReauthStatus("error");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setReauthError(data.error || "Failed");
        setReauthStatus("error");
      } else {
        setReauthStatus("done");
        setTimeout(() => {
          setShowReauth(false);
          setReauthHeaders("");
          setReauthStatus("idle");
        }, 1500);
      }
    } catch {
      setReauthError("Network error");
      setReauthStatus("error");
    }
  };

  // Memoize on `patch` so the graphData reference stays stable across re-renders
  // (e.g. the player ticking every second while a song plays). A fresh object each
  // render would make react-force-graph reheat the simulation in an endless loop.
  const data = useMemo(
    () => (patch ? toForceData(patch) : { nodes: [], links: [] }),
    [patch],
  );

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "12px 4px" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="⌕ jump to artist / track / album…"
            style={{
              width: "100%", background: "#161616", border: `1px solid rgba(249,115,22,0.3)`,
              borderRadius: 6, padding: "8px 12px", color: "#ddd", fontSize: 13,
              fontFamily: "monospace", outline: "none",
            }}
          />
          {results.length > 0 && (
            <div
              style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, marginTop: 4,
                background: "#141414", border: "1px solid rgba(249,115,22,0.3)", borderRadius: 6,
                overflow: "hidden",
              }}
            >
              {results.map((r) => (
                <div
                  key={`${r.node_type}:${r.key}`}
                  onClick={() => {
                    setQuery("");
                    setResults([]);
                    loadPatch(r.key, r.node_type);
                  }}
                  style={{ padding: "8px 12px", cursor: "pointer", color: "#ddd", fontSize: 12 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(249,115,22,0.1)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ color: ACCENT, fontSize: 9, fontFamily: "monospace" }}>
                    {r.node_type.toUpperCase()}
                  </span>{" "}
                  {r.title}
                  {r.subtitle ? <span style={{ color: "#666" }}> · {r.subtitle}</span> : null}
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => loadPatch()}
          style={{
            background: "rgba(249,115,22,0.12)", border: `1px solid ${ACCENT}`, borderRadius: 6,
            padding: "8px 14px", color: ACCENT, fontSize: 10, fontFamily: "monospace",
            letterSpacing: 1, cursor: "pointer",
          }}
        >
          ↻ SHUFFLE
        </button>
        {isAdmin && (
          <>
            <button
              onClick={doSync}
              disabled={syncStatus === "syncing"}
              style={{
                background: "none", border: `1px solid rgba(249,115,22,0.3)`, borderRadius: 6,
                padding: "8px 14px", color: ACCENT, fontSize: 10, fontFamily: "monospace",
                letterSpacing: 1, cursor: "pointer",
              }}
            >
              {syncStatus === "syncing" ? "SYNCING..." : syncStatus === "done" ? "SYNCED!" : syncStatus === "error" ? "FAILED" : "SYNC"}
            </button>
            <button
              onClick={() => {
                if (!getAdminToken()) return;
                setShowReauth(!showReauth);
              }}
              style={{
                background: showReauth ? "rgba(249,115,22,0.15)" : "none",
                border: `1px solid rgba(249,115,22,0.3)`, borderRadius: 6,
                padding: "8px 14px", color: ACCENT, fontSize: 10, fontFamily: "monospace",
                letterSpacing: 1, cursor: "pointer",
              }}
            >
              AUTH
            </button>
          </>
        )}
      </div>

      {isAdmin && syncMessage && (
        <div
          style={{
            color: syncStatus === "error" ? "#f87171" : "#888",
            fontSize: 11,
            fontFamily: "monospace",
            padding: "0 4px 8px",
            lineHeight: 1.5,
          }}
        >
          {syncMessage}
        </div>
      )}

      {isAdmin && showReauth && (
        <div style={{ background: "rgba(20,20,20,0.8)", border: "1px solid rgba(249,115,22,0.2)", borderRadius: 8, padding: 16, marginBottom: 8 }}>
          <div style={{ color: "#888", fontSize: 10, fontFamily: "monospace", letterSpacing: 1, marginBottom: 8 }}>YTM RE-AUTH</div>
          <div style={{ color: "#555", fontSize: 10, marginBottom: 10, lineHeight: 1.5 }}>
            music.youtube.com → DevTools → Network → click a song → right-click the POST request → Copy request headers → paste below
          </div>
          <textarea
            value={reauthHeaders}
            onChange={(e) => setReauthHeaders(e.target.value)}
            placeholder="Paste request headers here..."
            style={{
              width: "100%", minHeight: 120, background: "#111", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4, color: "#ccc", fontSize: 11, fontFamily: "monospace", padding: 10,
              resize: "vertical", outline: "none",
            }}
          />
          {reauthError && <div style={{ color: "#f87171", fontSize: 10, marginTop: 6 }}>{reauthError}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
            <button
              onClick={() => { setShowReauth(false); setReauthHeaders(""); setReauthError(""); setReauthStatus("idle"); }}
              style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "#888", borderRadius: 4, padding: "4px 12px", cursor: "pointer", fontSize: 10, fontFamily: "monospace" }}
            >
              CANCEL
            </button>
            <button
              disabled={reauthStatus === "saving" || !reauthHeaders.trim()}
              onClick={saveReauth}
              style={{
                background: reauthStatus === "done" ? "rgba(34,197,94,0.2)" : "rgba(249,115,22,0.15)",
                border: `1px solid ${reauthStatus === "done" ? "rgba(34,197,94,0.4)" : "rgba(249,115,22,0.3)"}`,
                color: reauthStatus === "done" ? "#22c55e" : ACCENT,
                borderRadius: 4, padding: "4px 12px", cursor: "pointer", fontSize: 10, fontFamily: "monospace", letterSpacing: 1,
              }}
            >
              {reauthStatus === "saving" ? "SAVING..." : reauthStatus === "done" ? "SAVED!" : "SAVE"}
            </button>
          </div>
        </div>
      )}

      {stats && (
        <div style={{ display: "flex", gap: 22, padding: "4px 4px 10px", fontFamily: "monospace" }}>
          <span style={{ color: ACCENT, fontSize: 13 }}>
            {stats.total.toLocaleString()}
            <span style={{ color: "#666", fontSize: 8, letterSpacing: 1, marginLeft: 5 }}>TOTAL PLAYS</span>
          </span>
          <span style={{ color: ACCENT, fontSize: 13 }}>
            {stats.today}
            <span style={{ color: "#666", fontSize: 8, letterSpacing: 1, marginLeft: 5 }}>TODAY</span>
          </span>
        </div>
      )}

      <GraphCanvas
        data={data}
        seedKey={patch?.seed ?? null}
        isAdmin={isAdmin}
        hovered={hovered}
        onNodeHover={(node) => setHovered(node ? node.key : null)}
        onNodeClick={(node) => {
          // Click = walk the graph: play (admin) and re-center on this node.
          if (isAdmin) playNode(node);
          loadPatch(node.key, node.node_type);
        }}
        alwaysLabel
        centerOnSeed
        minimalThreshold={0}
      />
    </div>
  );
}
