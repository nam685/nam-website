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
import { getAdminToken, storeDel, useIsAdmin } from "@/lib/auth";
import { edgeColor, nodeColor, nodeRadius, toForceData, type ForceNode } from "@/lib/graph";
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
  const fgRef = useRef<{
    zoomToFit?: (ms: number, px: number) => void;
    d3Force?: (name: string) => { strength?: (n: number) => void; distance?: (n: number) => void } | undefined;
  } | null>(null);
  // Auto-fit only once per patch (on first settle) — not on every engine stop, or
  // interacting with the graph (dragging a node reheats the sim) would yank the view back.
  const fittedRef = useRef(false);
  // Measure the canvas container so the graph fills it (full page width, tall).
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 1000, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setDims({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  // On each new patch: allow one auto-fit, and spread nodes apart so a dense patch
  // sprawls to fill the canvas instead of collapsing into a tight ball.
  useEffect(() => {
    fittedRef.current = false;
    if (!patch) return;
    fgRef.current?.d3Force?.("charge")?.strength?.(-320);
    fgRef.current?.d3Force?.("link")?.distance?.(70);
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
        // The graph now rebuilds asynchronously (Celery) since the Last.fm pass takes minutes,
        // so the new tracks won't appear in the graph until that finishes — say so.
        if ((data.synced > 0 || data.synced_liked > 0) && data.graph_rebuilding) {
          setSyncMessage(`Synced ${data.synced + data.synced_liked} tracks — graph rebuilding in the background.`);
        } else if (data.synced > 0 || data.synced_liked > 0) {
          // Rebuild ran inline (broker down fallback) — graph is current, refresh it.
          loadPatch();
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

      <div
        ref={containerRef}
        style={{
          // Full-bleed: break out of the centered max-width layout to span the page width.
          width: "100vw",
          marginLeft: "calc(50% - 50vw)",
          height: "calc(100vh - 200px)",
          minHeight: 480,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          overflow: "hidden",
          // Ambient orange hue behind the dots, like the home-page constellation backdrop.
          background: "radial-gradient(circle at 50% 42%, rgba(249,115,22,0.07) 0%, #0a0a0a 68%)",
        }}
      >
        <ForceGraph2D
          ref={fgRef as never}
          width={dims.width}
          height={dims.height}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          nodeRelSize={1}
          cooldownTicks={120}
          onEngineStop={() => {
            if (!fittedRef.current) {
              fgRef.current?.zoomToFit?.(400, 80);
              fittedRef.current = true;
            }
          }}
          linkColor={(l: { edge_type: string; weight: number }) => edgeColor(l.edge_type as never, l.weight)}
          linkWidth={0.5}
          onNodeClick={(node: ForceNode) => {
            // Click = walk the graph: play (admin) and re-center on this node.
            if (isAdmin) playNode(node);
            loadPatch(node.key, node.node_type);
          }}
          onNodeHover={(node: ForceNode | null) => setHovered(node ? node.key : null)}
          nodePointerAreaPaint={(
            node: ForceNode & { x: number; y: number },
            color: string,
            ctx: CanvasRenderingContext2D,
            scale: number,
          ) => {
            // Match the hover/click hit-area to the drawn dot (scale-invariant, like the dot).
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, (nodeRadius(node.play_count) + 2) / scale, 0, 2 * Math.PI);
            ctx.fill();
          }}
          nodeCanvasObject={(node: ForceNode & { x: number; y: number }, ctx: CanvasRenderingContext2D, scale: number) => {
            const isSeed = patch?.seed === node.key;
            const isHovered = hovered === node.key;
            // Divide by scale so the dot keeps a constant on-screen size at any zoom,
            // matching the home-page constellation dots. Hover grows it ~1.6x.
            const r = (nodeRadius(node.play_count) * (isHovered ? 1.6 : 1)) / scale;
            // Color-coded by type: song=orange, artist=amber, album=teal.
            const fill = nodeColor(node.node_type);
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
            // Seed is marked by a bright outer ring (color now encodes type, not seed).
            if (isSeed) {
              ctx.strokeStyle = "rgba(255,255,255,0.9)";
              ctx.lineWidth = 1.5 / scale;
              ctx.beginPath();
              ctx.arc(node.x, node.y, r + 3 / scale, 0, 2 * Math.PI);
              ctx.stroke();
            }
            if (node.is_liked) {
              ctx.strokeStyle = "#ffd400";
              ctx.lineWidth = 2 / scale;
              ctx.beginPath();
              ctx.arc(node.x, node.y, r + 2 / scale, 0, 2 * Math.PI);
              ctx.stroke();
            }
            if (node.is_subscribed) {
              ctx.strokeStyle = ACCENT;
              ctx.setLineDash([2, 2]);
              ctx.lineWidth = 1.5 / scale;
              ctx.beginPath();
              ctx.arc(node.x, node.y, r + 4 / scale, 0, 2 * Math.PI);
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
    </div>
  );
}
