"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Mission,
  type MissionListResponse,
  type MissionTrace,
  type MissionStatus,
  API,
} from "@/lib/api";
import HeroSection from "./components/HeroSection";
import MatrixBg from "./components/MatrixBg";
import TraceViewer from "./components/TraceViewer";

const ACCENT = "#39ff14";

/* ── Status badge colors ──────────────────────────────── */

const STATUS_COLORS: Record<MissionStatus, string> = {
  pending: "#f59e0b",
  approved: "#60a5fa",
  running: "#39ff14",
  done: "#4ade80",
  failed: "#ef4444",
  rejected: "#666",
};

function StatusBadge({ status }: { status: MissionStatus }) {
  const color = STATUS_COLORS[status] || "#666";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        background: `${color}18`,
        border: `1px solid ${color}40`,
        color,
        fontSize: 10,
        fontFamily: "monospace",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {status}
    </span>
  );
}

/* ── Time formatting ──────────────────────────────────── */

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ── Main Page ────────────────────────────────────────── */

export default function SlopsPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showPlayground, setShowPlayground] = useState(false);
  const [trace, setTrace] = useState<MissionTrace | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const traceAreaRef = useRef<HTMLDivElement>(null);

  /* ── Load admin token (SSR-safe) ────────────────────── */

  useEffect(() => {
    setAdminToken(localStorage.getItem("adminToken"));
  }, []);

  /* ── Fetch missions ─────────────────────────────────── */

  const fetchMissions = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/slops/?limit=50`);
      if (!res.ok) return;
      const data: MissionListResponse = await res.json();
      setMissions(data.missions || []);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchMissions();
  }, [fetchMissions]);

  /* ── Fetch trace for selected mission ───────────────── */

  const fetchTrace = useCallback(async (id: number) => {
    setTraceLoading(true);
    try {
      // Fetch mission detail (for status)
      const detailRes = await fetch(`${API}/api/slops/${id}/`);
      if (!detailRes.ok) {
        setTrace(null);
        return;
      }
      const detail = await detailRes.json();

      // Fetch trace (ATIF document)
      const traceRes = await fetch(`${API}/api/slops/${id}/trace/`);
      const traceData = traceRes.ok ? await traceRes.json() : { trace: null };

      setTrace({ trace: traceData.trace, status: detail.status });
    } catch {
      setTrace(null);
    } finally {
      setTraceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId !== null) {
      fetchTrace(selectedId);
    } else {
      setTrace(null);
    }
  }, [selectedId, fetchTrace]);

  /* ── Poll running/approved missions ─────────────────── */

  useEffect(() => {
    const hasActive = missions.some(
      (m) => m.status === "running" || m.status === "approved",
    );

    if (hasActive) {
      pollRef.current = setInterval(() => {
        fetchMissions();
        if (
          selectedId !== null &&
          missions.find(
            (m) =>
              m.id === selectedId &&
              (m.status === "running" || m.status === "approved"),
          )
        ) {
          fetchTrace(selectedId);
        }
      }, 5000);
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [missions, selectedId, fetchMissions, fetchTrace]);

  /* ── Select mission ─────────────────────────────────── */

  const selectMission = (id: number) => {
    setShowPlayground(false);
    setSelectedId(id === selectedId ? null : id);
    setSidebarOpen(false);
  };

  const selectPlayground = () => {
    setSelectedId(null);
    setShowPlayground(!showPlayground);
    setSidebarOpen(false);
  };

  /* ── Admin actions ──────────────────────────────────── */

  const doAction = async (action: "approve" | "reject") => {
    if (!adminToken || selectedId === null) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API}/api/slops/${selectedId}/${action}/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        await fetchMissions();
        await fetchTrace(selectedId);
      }
    } catch {
      /* silent */
    } finally {
      setActionLoading(false);
    }
  };

  /* ── Submit prompt ──────────────────────────────────── */

  const handleSubmit = async () => {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);
    try {
      const res = await fetch(`${API}/api/slops/submit/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      if (res.status === 429) {
        setSubmitError("Rate limited. Try again in a minute.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSubmitError(
          (data as { error?: string }).error || "Submission failed",
        );
        return;
      }
      setPrompt("");
      setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 3000);
      await fetchMissions();
    } catch {
      setSubmitError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Derived state ──────────────────────────────────── */

  const selected = missions.find((m) => m.id === selectedId) ?? null;
  const showAdminControls = !!adminToken && selected?.status === "pending";

  /* ── Render ─────────────────────────────────────────── */

  return (
    <div
      className="flex flex-col lg:flex-row"
      style={{
        height: "calc(100vh - 60px)",
        fontFamily: "monospace",
        overflow: "hidden",
      }}
    >
      <MatrixBg />

      {/* ── Mobile sidebar toggle ───────────────────────── */}
      <button
        className="lg:hidden"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        style={{
          position: "fixed",
          bottom: 80,
          right: 16,
          zIndex: 50,
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: ACCENT,
          color: "#000",
          border: "none",
          fontSize: 18,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: `0 0 20px ${ACCENT}40`,
        }}
      >
        {sidebarOpen ? "\u2715" : "\u2630"}
      </button>

      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside
        className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
        style={{
          position: "fixed",
          top: 60,
          left: 0,
          bottom: 0,
          width: sidebarCollapsed ? 40 : 280,
          zIndex: 40,
          background: "#0a0a0a",
          borderRight: `1px solid ${ACCENT}40`,
          overflowY: sidebarCollapsed ? "hidden" : "auto",
          overflowX: "hidden",
          transition: "width 0.2s ease, transform 0.2s ease",
          cursor: "pointer",
        }}
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
      >
        {sidebarCollapsed ? (
          <div
            style={{
              writingMode: "vertical-rl",
              padding: "16px 0",
              fontSize: 11,
              color: "#666",
              textTransform: "uppercase",
              letterSpacing: 1,
              textAlign: "center",
              width: "100%",
              userSelect: "none",
            }}
          >
            Missions
          </div>
        ) : (
          <>
            {/* ── Workspace section ─────────────────────── */}
            <div
              style={{
                padding: "16px 12px 8px",
                fontSize: 11,
                color: "#666",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Workspace
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                selectPlayground();
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "10px 12px",
                background: showPlayground ? `${ACCENT}10` : "transparent",
                border: "none",
                borderLeft: showPlayground
                  ? `2px solid ${ACCENT}`
                  : "2px solid transparent",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!showPlayground)
                  e.currentTarget.style.background = `${ACCENT}08`;
              }}
              onMouseLeave={(e) => {
                if (!showPlayground)
                  e.currentTarget.style.background = "transparent";
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 2,
                }}
              >
                <span style={{ color: ACCENT, fontSize: 12, fontWeight: 600 }}>
                  klaude-playground
                </span>
              </div>
              <div style={{ color: "#555", fontSize: 10 }}>
                klaude works here!
              </div>
            </button>

            {/* ── Missions section ────────────────────────── */}
            <div
              style={{
                padding: "16px 12px 8px",
                fontSize: 11,
                color: "#666",
                textTransform: "uppercase",
                letterSpacing: 1,
                borderTop: `1px solid ${ACCENT}15`,
                marginTop: 4,
              }}
            >
              Missions
            </div>

            {missions.length === 0 && (
              <div
                style={{ padding: "20px 12px", color: "#555", fontSize: 12 }}
              >
                No missions yet. Submit the first one!
              </div>
            )}

            {missions.map((m) => (
              <button
                key={m.id}
                onClick={(e) => {
                  e.stopPropagation();
                  selectMission(m.id);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "10px 12px",
                  background:
                    m.id === selectedId ? `${ACCENT}10` : "transparent",
                  border: "none",
                  borderLeft:
                    m.id === selectedId
                      ? `2px solid ${ACCENT}`
                      : "2px solid transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (m.id !== selectedId)
                    e.currentTarget.style.background = `${ACCENT}08`;
                }}
                onMouseLeave={(e) => {
                  if (m.id !== selectedId)
                    e.currentTarget.style.background = "transparent";
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      color: "#ccc",
                      fontSize: 12,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                    }}
                  >
                    {m.prompt.length > 40
                      ? m.prompt.slice(0, 40) + "\u2026"
                      : m.prompt}
                  </span>
                  <StatusBadge status={m.status} />
                </div>
                <div style={{ color: "#555", fontSize: 10 }}>
                  {timeAgo(m.created_at)}
                  {m.token_count > 0 && (
                    <span style={{ marginLeft: 8 }}>
                      {m.token_count.toLocaleString()} tokens
                    </span>
                  )}
                  {m.tool_calls > 0 && (
                    <span style={{ marginLeft: 8 }}>
                      {m.tool_calls} tool calls
                    </span>
                  )}
                </div>
              </button>
            ))}
          </>
        )}
      </aside>

      {/* ── Main area ───────────────────────────────────── */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          height: "100%",
          marginLeft: sidebarCollapsed ? 40 : 280,
          transition: "margin-left 0.2s ease",
        }}
        className="max-lg:!ml-0"
      >
        {/* Hero */}
        <HeroSection compact={selectedId !== null || showPlayground} />

        {/* Trace area */}
        <div
          ref={traceAreaRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0 20px",
          }}
        >
          {showPlayground ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                padding: "80px 24px 40px",
                flex: 1,
                textAlign: "center",
              }}
            >
              <a
                href="https://github.com/nam685/klaude-playground"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: "monospace",
                  fontSize: 48,
                  fontWeight: 700,
                  color: ACCENT,
                  letterSpacing: 4,
                  textShadow: `0 0 30px ${ACCENT}40`,
                  textDecoration: "none",
                  transition: "text-shadow 0.2s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.textShadow = `0 0 40px ${ACCENT}, 0 0 80px ${ACCENT}60`)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.textShadow = `0 0 30px ${ACCENT}40`)
                }
              >
                klaude-playground
              </a>
              <p
                style={{
                  color: "#999",
                  fontSize: 14,
                  fontFamily: "monospace",
                  maxWidth: 440,
                  lineHeight: 1.6,
                }}
              >
                check out what klaude can do
              </p>
            </div>
          ) : selectedId ===
            null /* No selection — hero takes space, nothing here */ ? null : traceLoading ? (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "#555",
                fontSize: 12,
              }}
            >
              Loading trace...
            </div>
          ) : (
            <>
              {/* Mission summary bar */}
              {selected && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 0",
                    borderBottom: "1px solid #222",
                    marginBottom: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <StatusBadge status={selected.status} />
                  <span style={{ color: "#999", fontSize: 12, flex: 1 }}>
                    {selected.prompt}
                  </span>
                  {selected.token_count > 0 && (
                    <span style={{ color: "#555", fontSize: 11 }}>
                      {selected.token_count.toLocaleString()} tokens
                    </span>
                  )}

                  {/* Admin three-dot menu */}
                  {showAdminControls && (
                    <div style={{ position: "relative" }}>
                      <button
                        onClick={() => setMenuOpen(!menuOpen)}
                        style={{
                          width: 28,
                          height: 28,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border: `1px solid ${ACCENT}40`,
                          borderRadius: 4,
                          background: "transparent",
                          color: ACCENT,
                          cursor: "pointer",
                          fontSize: 14,
                          lineHeight: 1,
                        }}
                      >
                        &#8942;
                      </button>
                      {menuOpen && (
                        <div
                          style={{
                            position: "absolute",
                            top: "100%",
                            right: 0,
                            marginTop: 4,
                            background: "#111",
                            border: `1px solid ${ACCENT}40`,
                            borderRadius: 4,
                            zIndex: 50,
                            minWidth: 120,
                            overflow: "hidden",
                          }}
                        >
                          <button
                            onClick={() => {
                              setMenuOpen(false);
                              doAction("approve");
                            }}
                            disabled={actionLoading}
                            style={{
                              display: "block",
                              width: "100%",
                              padding: "8px 12px",
                              border: "none",
                              background: "transparent",
                              color: ACCENT,
                              fontSize: 12,
                              fontFamily: "monospace",
                              cursor: actionLoading ? "not-allowed" : "pointer",
                              textAlign: "left",
                            }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.background = `${ACCENT}15`)
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.background = "transparent")
                            }
                          >
                            {actionLoading ? "\u2026" : "Approve"}
                          </button>
                          <button
                            onClick={() => {
                              setMenuOpen(false);
                              doAction("reject");
                            }}
                            disabled={actionLoading}
                            style={{
                              display: "block",
                              width: "100%",
                              padding: "8px 12px",
                              border: "none",
                              borderTop: "1px solid #222",
                              background: "transparent",
                              color: "#ef4444",
                              fontSize: 12,
                              fontFamily: "monospace",
                              cursor: actionLoading ? "not-allowed" : "pointer",
                              textAlign: "left",
                            }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.background =
                                "rgba(239,68,68,0.1)")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.background = "transparent")
                            }
                          >
                            {actionLoading ? "\u2026" : "Reject"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Error display */}
              {selected?.error && (
                <div
                  style={{
                    padding: "10px 14px",
                    marginBottom: 12,
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    borderRadius: 6,
                    color: "#f87171",
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {selected.error}
                </div>
              )}

              {/* Summary display */}
              {selected?.summary && (
                <div
                  style={{
                    padding: "10px 14px",
                    marginBottom: 12,
                    background: `${ACCENT}08`,
                    border: `1px solid ${ACCENT}20`,
                    borderRadius: 6,
                    color: "#aaa",
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  <span
                    style={{
                      color: ACCENT,
                      fontWeight: 600,
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    Summary
                  </span>
                  {selected.summary}
                </div>
              )}

              {/* Trace viewer */}
              {trace && <TraceViewer trace={trace} />}
            </>
          )}
        </div>

        {/* ── Prompt box ────────────────────────────────── */}
        <div
          style={{
            padding: "12px 40px 16px",
            borderTop: "1px solid #222",
            background: "#0a0a0a",
            maxWidth: 800,
            width: "100%",
            alignSelf: "center",
          }}
        >
          {submitSuccess && (
            <div
              style={{
                marginBottom: 8,
                padding: "6px 12px",
                borderRadius: 6,
                background: `${ACCENT}15`,
                border: `1px solid ${ACCENT}30`,
                color: ACCENT,
                fontSize: 11,
              }}
            >
              Mission submitted! It will appear in the sidebar once approved.
            </div>
          )}
          {submitError && (
            <div
              style={{
                marginBottom: 8,
                padding: "6px 12px",
                borderRadius: 6,
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                color: "#f87171",
                fontSize: 11,
              }}
            >
              {submitError}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="will code for food..."
              style={{
                flex: 1,
                padding: "10px 14px",
                borderRadius: 8,
                border: `1px solid ${ACCENT}25`,
                background: "#111",
                color: "#ddd",
                fontSize: 13,
                fontFamily: "monospace",
                outline: "none",
              }}
              onFocus={(e) =>
                (e.currentTarget.style.borderColor = `${ACCENT}60`)
              }
              onBlur={(e) =>
                (e.currentTarget.style.borderColor = `${ACCENT}25`)
              }
            />
            <button
              onClick={handleSubmit}
              disabled={!prompt.trim() || submitting}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: `1px solid ${ACCENT}44`,
                background: "#000",
                color: ACCENT,
                fontSize: 16,
                cursor:
                  !prompt.trim() || submitting ? "not-allowed" : "pointer",
                opacity: !prompt.trim() || submitting ? 0.3 : 1,
                transition: "opacity 0.15s, box-shadow 0.15s",
                boxShadow:
                  !prompt.trim() || submitting ? "none" : `0 0 8px ${ACCENT}30`,
                lineHeight: 1,
              }}
              onMouseEnter={(e) => {
                if (prompt.trim() && !submitting)
                  e.currentTarget.style.boxShadow = `0 0 14px ${ACCENT}50`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow =
                  prompt.trim() && !submitting ? `0 0 8px ${ACCENT}30` : "none";
              }}
            >
              {submitting ? "\u2026" : "\u21B5"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
