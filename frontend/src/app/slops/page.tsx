"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Session,
  type SessionListResponse,
  type SessionTrace,
  type TurnStatus,
  API,
} from "@/lib/api";
import HeroSection from "./components/HeroSection";
import MatrixBg from "./components/MatrixBg";
import TraceViewer from "./components/TraceViewer";

const ACCENT = "#39ff14";

/* ── Status badge colors ──────────────────────────────── */

const STATUS_COLORS: Record<TurnStatus, string> = {
  pending: "#f59e0b",
  approved: "#60a5fa",
  running: "#39ff14",
  done: "#4ade80",
  failed: "#ef4444",
  rejected: "#666",
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status as TurnStatus] || "#666";
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
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [trace, setTrace] = useState<SessionTrace | null>(null);
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
  const tracePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const prevStepCountRef = useRef(0);

  useEffect(() => {
    setAdminToken(localStorage.getItem("adminToken"));
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/slops/?limit=50`);
      if (!res.ok) return;
      const data: SessionListResponse = await res.json();
      setSessions(data.sessions || []);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const fetchTrace = useCallback(async (id: number, silent = false) => {
    if (!silent) setTraceLoading(true);
    try {
      const res = await fetch(`${API}/api/slops/${id}/trace/`);
      if (!res.ok) {
        if (!silent) setTrace(null);
        return;
      }
      const data: SessionTrace = await res.json();
      setTrace(data);
    } catch {
      if (!silent) setTrace(null);
    } finally {
      if (!silent) setTraceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId !== null) {
      fetchTrace(selectedId);
    } else {
      setTrace(null);
    }
  }, [selectedId, fetchTrace]);

  /* ── Poll session list while anything is active ──────── */

  useEffect(() => {
    const hasActive = sessions.some(
      (s) =>
        s.status === "running" ||
        s.status === "approved" ||
        s.status === "pending",
    );

    if (hasActive) {
      pollRef.current = setInterval(fetchSessions, 5000);
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [sessions, fetchSessions]);

  /* ── Stream trace while running, final fetch on complete ── */

  const selectedStatus = sessions.find((s) => s.id === selectedId)?.status;

  useEffect(() => {
    if (tracePollRef.current) {
      clearTimeout(tracePollRef.current);
      tracePollRef.current = null;
    }

    if (selectedId === null) return;

    // Final fetch when session completes (silent to avoid loading flash / scroll reset)
    if (selectedStatus === "done" || selectedStatus === "failed") {
      fetchTrace(selectedId, true);
      return;
    }

    // Adaptive polling while running/approved
    if (selectedStatus !== "running" && selectedStatus !== "approved") return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API}/api/slops/${selectedId}/trace/`);
        if (cancelled || !res.ok) return;
        const data: SessionTrace = await res.json();
        if (cancelled) return;
        setTrace(data);
        // Adaptive interval: back off as trace grows
        const stepCount =
          (data.trace as { step_count?: number })?.step_count ?? 0;
        const interval =
          stepCount < 20 ? 3000 : stepCount < 50 ? 6000 : 10000;
        tracePollRef.current = setTimeout(poll, interval);
      } catch {
        // Retry after base interval on error
        if (!cancelled) tracePollRef.current = setTimeout(poll, 5000);
      }
    };
    poll();

    return () => {
      cancelled = true;
      if (tracePollRef.current) {
        clearTimeout(tracePollRef.current);
        tracePollRef.current = null;
      }
    };
  }, [selectedId, selectedStatus, fetchTrace]);

  /* ── Auto-scroll when new trace steps arrive during running ── */

  useEffect(() => {
    const stepCount =
      (trace?.trace as { step_count?: number })?.step_count ?? 0;
    if (
      stepCount > prevStepCountRef.current &&
      (selectedStatus === "running" || selectedStatus === "approved")
    ) {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
    prevStepCountRef.current = stepCount;
  }, [trace, selectedStatus]);

  const selectSession = (id: number) => {
    const next = id === selectedId ? null : id;
    setSelectedId(next);
    if (next === null) setTrace(null);
    setSidebarOpen(false);
    setMenuOpen(false);
  };

  const doAction = async (turnId: number, action: "approve" | "reject" | "cancel") => {
    if (!adminToken) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API}/api/slops/turns/${turnId}/${action}/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        await fetchSessions();
        if (selectedId !== null) await fetchTrace(selectedId);
      }
    } catch {
      /* silent */
    } finally {
      setActionLoading(false);
    }
  };

  const doDelete = async (sessionId: number) => {
    if (!adminToken) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API}/api/slops/${sessionId}/delete/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        if (selectedId === sessionId) {
          setSelectedId(null);
          setTrace(null);
        }
        await fetchSessions();
      }
    } catch {
      /* silent */
    } finally {
      setActionLoading(false);
      setMenuOpen(false);
    }
  };

  const handleSubmit = async () => {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);
    try {
      const body: { prompt: string; session_id?: number } = {
        prompt: prompt.trim(),
      };
      if (selectedId !== null) {
        body.session_id = selectedId;
      }

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (adminToken) headers["Authorization"] = `Bearer ${adminToken}`;

      const res = await fetch(`${API}/api/slops/submit/`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        setSubmitError("Rate limited. Try again later.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSubmitError(
          (data as { error?: string }).error || "Submission failed",
        );
        return;
      }
      const created: Session = await res.json();
      setPrompt("");
      setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 3000);
      setSelectedId(created.id);
      await fetchSessions();
    } catch {
      setSubmitError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const latestTurn = selected?.turns[selected.turns.length - 1] ?? null;
  const pendingTurn = selected?.turns.find((t) => t.status === "pending") ?? null;
  const activeTurn = selected?.turns.find(
    (t) => t.status === "running" || t.status === "approved",
  ) ?? null;
  const hasActiveTurn = !!pendingTurn || !!activeTurn;

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
            Sessions
          </div>
        ) : (
          <>
            <a
              href="https://github.com/nam685/klaude-playground"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "block",
                padding: "12px 12px 10px",
                fontSize: 12,
                color: ACCENT,
                textDecoration: "none",
                borderBottom: `1px solid ${ACCENT}20`,
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = `${ACCENT}08`)
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              <span style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 2 }}>
                Workspace
              </span>
              nam685/klaude-playground
            </a>

            <div
              style={{
                padding: "12px 12px 8px",
                fontSize: 11,
                color: "#666",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Sessions
            </div>

            {sessions.length === 0 && (
              <div
                style={{ padding: "20px 12px", color: "#555", fontSize: 12 }}
              >
                No sessions yet. Submit the first one!
              </div>
            )}

            {sessions.map((s) => {
              const firstTurn = s.turns[0];
              const promptText = firstTurn?.prompt ?? "(empty)";
              const totalTokens = s.turns.reduce((sum, t) => sum + t.token_count, 0);
              const totalToolCalls = s.turns.reduce((sum, t) => sum + t.tool_calls, 0);
              return (
                <button
                  key={s.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectSession(s.id);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "10px 12px",
                    background:
                      s.id === selectedId ? `${ACCENT}10` : "transparent",
                    border: "none",
                    borderLeft:
                      s.id === selectedId
                        ? `2px solid ${ACCENT}`
                        : "2px solid transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (s.id !== selectedId)
                      e.currentTarget.style.background = `${ACCENT}08`;
                  }}
                  onMouseLeave={(e) => {
                    if (s.id !== selectedId)
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
                      {promptText.length > 40
                        ? promptText.slice(0, 40) + "\u2026"
                        : promptText}
                    </span>
                    <StatusBadge status={s.status} />
                  </div>
                  <div style={{ color: "#555", fontSize: 10 }}>
                    {timeAgo(s.created_at)}
                    {s.turns.length > 1 && (
                      <span style={{ marginLeft: 8 }}>
                        {s.turns.length} turns
                      </span>
                    )}
                    {totalTokens > 0 && (
                      <span style={{ marginLeft: 8 }}>
                        {totalTokens.toLocaleString()} tokens
                      </span>
                    )}
                    {totalToolCalls > 0 && (
                      <span style={{ marginLeft: 8 }}>
                        {totalToolCalls} tool calls
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </>
        )}
      </aside>

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
        <HeroSection compact={selectedId !== null} />

        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0 20px",
          }}
        >
          {selectedId === null
            ? null
            : traceLoading
              ? (
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
                )
              : (
                  <>
                    {selected && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "12px 20px",
                          marginLeft: -20,
                          marginRight: -20,
                          borderBottom: "1px solid #222",
                          marginBottom: 8,
                          flexWrap: "wrap",
                          position: "sticky",
                          top: 0,
                          zIndex: 10,
                          background: "#0a0a0a",
                        }}
                      >
                        <StatusBadge status={selected.status} />
                        <span style={{ color: "#999", fontSize: 12, flex: 1 }}>
                          {selected.turns[0]?.prompt ?? ""}
                        </span>
                        {selected.turns.reduce((s, t) => s + t.token_count, 0) > 0 && (
                          <span style={{ color: "#555", fontSize: 11 }}>
                            {selected.turns.reduce((s, t) => s + t.token_count, 0).toLocaleString()} tokens
                          </span>
                        )}

                        {!!adminToken && selected && (
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
                                    if (!pendingTurn) return;
                                    setMenuOpen(false);
                                    doAction(pendingTurn.id, "approve");
                                  }}
                                  disabled={actionLoading || !pendingTurn}
                                  style={{
                                    display: "block",
                                    width: "100%",
                                    padding: "8px 12px",
                                    border: "none",
                                    background: "transparent",
                                    color: pendingTurn ? ACCENT : "#444",
                                    fontSize: 12,
                                    fontFamily: "monospace",
                                    cursor: !pendingTurn || actionLoading ? "not-allowed" : "pointer",
                                    textAlign: "left",
                                    opacity: pendingTurn ? 1 : 0.5,
                                  }}
                                  onMouseEnter={(e) => {
                                    if (pendingTurn) e.currentTarget.style.background = `${ACCENT}15`;
                                  }}
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.background = "transparent")
                                  }
                                >
                                  {actionLoading && pendingTurn ? "\u2026" : "Approve"}
                                </button>
                                <button
                                  onClick={() => {
                                    if (!pendingTurn) return;
                                    setMenuOpen(false);
                                    doAction(pendingTurn.id, "reject");
                                  }}
                                  disabled={actionLoading || !pendingTurn}
                                  style={{
                                    display: "block",
                                    width: "100%",
                                    padding: "8px 12px",
                                    border: "none",
                                    borderTop: "1px solid #222",
                                    background: "transparent",
                                    color: pendingTurn ? "#ef4444" : "#444",
                                    fontSize: 12,
                                    fontFamily: "monospace",
                                    cursor: !pendingTurn || actionLoading ? "not-allowed" : "pointer",
                                    textAlign: "left",
                                    opacity: pendingTurn ? 1 : 0.5,
                                  }}
                                  onMouseEnter={(e) => {
                                    if (pendingTurn) e.currentTarget.style.background = "rgba(239,68,68,0.1)";
                                  }}
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.background = "transparent")
                                  }
                                >
                                  {actionLoading && pendingTurn ? "\u2026" : "Reject"}
                                </button>
                                <button
                                  onClick={() => {
                                    if (!activeTurn) return;
                                    setMenuOpen(false);
                                    doAction(activeTurn.id, "cancel");
                                  }}
                                  disabled={actionLoading || !activeTurn}
                                  style={{
                                    display: "block",
                                    width: "100%",
                                    padding: "8px 12px",
                                    border: "none",
                                    borderTop: "1px solid #222",
                                    background: "transparent",
                                    color: activeTurn ? "#f59e0b" : "#444",
                                    fontSize: 12,
                                    fontFamily: "monospace",
                                    cursor: !activeTurn || actionLoading ? "not-allowed" : "pointer",
                                    textAlign: "left",
                                    opacity: activeTurn ? 1 : 0.5,
                                  }}
                                  onMouseEnter={(e) => {
                                    if (activeTurn) e.currentTarget.style.background = "rgba(245,158,11,0.1)";
                                  }}
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.background = "transparent")
                                  }
                                >
                                  {actionLoading && activeTurn ? "\u2026" : "Cancel"}
                                </button>
                                <button
                                  onClick={() => doDelete(selected.id)}
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
                                  {actionLoading ? "\u2026" : "Delete session"}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {trace && (
                      <TraceViewer
                        trace={trace}
                        status={selected?.status ?? "pending"}
                        error={latestTurn?.error || ""}
                      />
                    )}
                  </>
                )}
        </div>

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
              Submitted! It will appear once approved.
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
          {hasActiveTurn && (
            <div
              style={{
                marginBottom: 8,
                padding: "6px 12px",
                borderRadius: 6,
                background: `${ACCENT}08`,
                border: `1px solid ${ACCENT}20`,
                color: "#888",
                fontSize: 11,
              }}
            >
              Waiting for current turn to complete...
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
              placeholder={
                selectedId !== null
                  ? "continue this session..."
                  : "will code for food..."
              }
              disabled={!!hasActiveTurn}
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
                opacity: hasActiveTurn ? 0.4 : 1,
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
              disabled={!prompt.trim() || submitting || !!hasActiveTurn}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: `1px solid ${ACCENT}44`,
                background: "#000",
                color: ACCENT,
                fontSize: 16,
                cursor:
                  !prompt.trim() || submitting || hasActiveTurn
                    ? "not-allowed"
                    : "pointer",
                opacity: !prompt.trim() || submitting || hasActiveTurn ? 0.3 : 1,
                transition: "opacity 0.15s, box-shadow 0.15s",
                boxShadow:
                  !prompt.trim() || submitting || hasActiveTurn
                    ? "none"
                    : `0 0 8px ${ACCENT}30`,
                lineHeight: 1,
              }}
              onMouseEnter={(e) => {
                if (prompt.trim() && !submitting && !hasActiveTurn)
                  e.currentTarget.style.boxShadow = `0 0 14px ${ACCENT}50`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow =
                  prompt.trim() && !submitting && !hasActiveTurn
                    ? `0 0 8px ${ACCENT}30`
                    : "none";
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
