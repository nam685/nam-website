"use client";

import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  API,
  type GraphPatch,
  type GraphSearchResult,
  type ListenStats,
  type ListenTrack,
} from "@/lib/api";
import { getAdminToken, store, storeDel } from "@/lib/auth";
import { edgeColor, edgeDashed, nodeRadius, toForceData, type ForceNode } from "@/lib/graph";
import { usePlayer } from "@/lib/player";

// Cast to permissive type at import boundary: react-force-graph-2d's callback
// prop types expect its own internal NodeObject/LinkObject generics which are
// incompatible with our strongly-typed ForceNode/ForceLink shapes. Casting
// here avoids wholesale `as any` on every individual prop callback.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as React.ComponentType<Record<string, unknown>>;

const ACCENT = "#f97316";

export default function ListensGraphPage() {
  const player = usePlayer();
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");
  const [patch, setPatch] = useState<GraphPatch | null>(null);
  const [stats, setStats] = useState<ListenStats | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GraphSearchResult[]>([]);
  const [selected, setSelected] = useState<ForceNode | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [showReauth, setShowReauth] = useState(false);
  const [reauthHeaders, setReauthHeaders] = useState("");
  const [reauthStatus, setReauthStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [reauthError, setReauthError] = useState("");
  const fgRef = useRef<{
    zoomToFit?: (ms: number, px: number) => void;
    d3Force?: (name: string) => { strength?: (n: number) => void; distance?: (n: number) => void } | undefined;
  } | null>(null);

  // Admin actions require a valid token; bounce expired/absent sessions to the login.
  const handleAuthExpired = () => {
    storeDel("adminToken");
    if (typeof window !== "undefined") window.location.href = "/sudo?from=/listens";
  };

  const loadPatch = useCallback(async (seed?: string, type?: string) => {
    const qs = seed ? `?seed=${encodeURIComponent(seed)}&type=${type ?? ""}` : "";
    const data: GraphPatch = await fetch(`${API}/api/listens/graph/patch/${qs}`).then((r) => r.json());
    setPatch(data);
    setSelected(null);
  }, []);

  useEffect(() => {
    loadPatch();
    fetch(`${API}/api/listens/stats/`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, [loadPatch]);

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

  // Spread nodes apart so a dense patch doesn't collapse into one blob.
  useEffect(() => {
    if (!patch) return;
    fgRef.current?.d3Force?.("charge")?.strength?.(-180);
    fgRef.current?.d3Force?.("link")?.distance?.(50);
  }, [patch]);

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
    try {
      const res = await fetch(`${API}/api/listens/sync/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        handleAuthExpired();
        return;
      }
      if (!res.ok) {
        setSyncStatus("error");
      } else {
        const data = await res.json();
        setSyncStatus("done");
        // Sync rebuilds the graph server-side; refresh the current patch.
        if (data.synced > 0 || data.synced_liked > 0) loadPatch();
      }
    } catch {
      setSyncStatus("error");
    }
    setTimeout(() => setSyncStatus("idle"), 3000);
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
        handleAuthExpired();
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
          {(() => {
            const seedNode = patch?.nodes.find((n) => n.key === patch.seed);
            if (!seedNode) return null;
            return (
              <span style={{ color: "#888", fontSize: 11, marginLeft: "auto" }}>
                centered on · <span style={{ color: "#ccc" }}>{seedNode.title}</span>
                {seedNode.subtitle ? <span style={{ color: "#666" }}> — {seedNode.subtitle}</span> : null}
              </span>
            );
          })()}
        </div>
      )}

      <div style={{ height: 540, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, overflow: "hidden", background: "#0a0a0a" }}>
        <ForceGraph2D
          ref={fgRef as never}
          graphData={data}
          backgroundColor="#0a0a0a"
          nodeRelSize={1}
          cooldownTicks={120}
          onEngineStop={() => fgRef.current?.zoomToFit?.(400, 60)}
          linkColor={(l: { edge_type: string }) => edgeColor(l.edge_type as never)}
          linkLineDash={(l: { edge_type: string }) => (edgeDashed(l.edge_type as never) ? [3, 3] : null)}
          linkWidth={(l: { edge_type: string; weight: number }) =>
            l.edge_type.startsWith("similar") ? 1 + l.weight * 1.5 : 0.8
          }
          onNodeClick={(node: ForceNode) => {
            setSelected(node);
          }}
          onNodeHover={(node: ForceNode | null) => setHovered(node ? node.key : null)}
          nodePointerAreaPaint={(
            node: ForceNode & { x: number; y: number },
            color: string,
            ctx: CanvasRenderingContext2D,
          ) => {
            // Match the hover/click hit-area to the drawn dot (nodes are small).
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, nodeRadius(node.play_count) + 2, 0, 2 * Math.PI);
            ctx.fill();
          }}
          nodeCanvasObject={(node: ForceNode & { x: number; y: number }, ctx: CanvasRenderingContext2D, scale: number) => {
            const isSeed = patch?.seed === node.key;
            const isHovered = hovered === node.key;
            // Hover grows the dot ~1.6x, just like the home-page constellation.
            const r = nodeRadius(node.play_count) * (isHovered ? 1.6 : 1);
            const fill = isSeed ? ACCENT : "#c2540a";
            // Glowing dot like the home-page constellation (boxShadow → canvas shadowBlur).
            ctx.save();
            ctx.shadowColor = fill;
            ctx.shadowBlur = r * (isSeed || isHovered ? 2.4 : 1.5);
            ctx.globalAlpha = isHovered ? 1 : 0.92;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.restore();
            if (node.is_liked) {
              ctx.strokeStyle = "#ffd400";
              ctx.lineWidth = 2 / scale;
              ctx.beginPath();
              ctx.arc(node.x, node.y, r + 2, 0, 2 * Math.PI);
              ctx.stroke();
            }
            if (node.is_subscribed) {
              ctx.strokeStyle = ACCENT;
              ctx.setLineDash([2, 2]);
              ctx.lineWidth = 1.5 / scale;
              ctx.beginPath();
              ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI);
              ctx.stroke();
              ctx.setLineDash([]);
            }
            // Label the seed, the hovered node, and (when zoomed in) larger nodes —
            // avoids a wall of overlapping text at the default overview zoom.
            if (isSeed || isHovered || scale > 1.6) {
              const label = node.title.length > 18 ? node.title.slice(0, 17) + "…" : node.title;
              ctx.font = `${10 / scale}px monospace`;
              ctx.fillStyle = "#ccc";
              ctx.textAlign = "center";
              ctx.fillText(label, node.x, node.y + r + 9 / scale);
            }
          }}
        />
      </div>

      {selected && (
        <div
          style={{
            position: "absolute", right: 14, bottom: 14, width: 200, background: "#141414",
            border: `1px solid rgba(249,115,22,0.3)`, borderRadius: 8, padding: 10,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {selected.thumbnail_url ? (
              <img src={selected.thumbnail_url} alt="" style={{ width: 40, height: 40, borderRadius: 4, objectFit: "cover" }} />
            ) : (
              <div style={{ width: 40, height: 40, borderRadius: 4, background: "#c2540a" }} />
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#eee", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {selected.title}
              </div>
              <div style={{ color: "#888", fontSize: 9 }}>
                {selected.subtitle || selected.node_type} · {selected.play_count}×
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
            {isAdmin && selected.video_id && (
              <button
                onClick={() => playNode(selected)}
                style={{
                  flex: 1, background: "rgba(249,115,22,0.15)", border: `1px solid ${ACCENT}`,
                  borderRadius: 5, padding: 5, color: ACCENT, fontSize: 9, fontFamily: "monospace",
                  letterSpacing: 1, cursor: "pointer",
                }}
              >
                ▶ PLAY
              </button>
            )}
            <button
              onClick={() => loadPatch(selected.key, selected.node_type)}
              style={{
                flex: 1, background: "#1d1d1d", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 5, padding: 5, color: "#aaa", fontSize: 9, fontFamily: "monospace",
                letterSpacing: 1, cursor: "pointer",
              }}
            >
              ⊙ CENTER
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
