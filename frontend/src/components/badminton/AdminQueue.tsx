"use client";

import { useCallback, useEffect, useState } from "react";
import { API } from "@/lib/api";
import { store } from "@/lib/auth";
import {
  analysisProgress,
  formatBytes,
  formatSubmissionDate,
  mediaUrl,
  stepLabel,
  type QueueRow,
} from "@/lib/badminton";
import { ACCENT, btn, btnPrimary, card, label, video } from "./styles";

const WORKER_ONLINE_MS = 60_000;

/** Admin-only: uploads awaiting approval, the queue, running + failed jobs. */
export default function AdminQueue({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [workerSeen, setWorkerSeen] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const token = store("adminToken");
    if (!token) return;
    const res = await fetch(`${API}/api/badminton/queue/`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setRows(data.submissions);
    setWorkerSeen(data.worker_seen_at);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(id: number, action: "approve" | "delete") {
    if (action === "delete" && !confirm("Reject and delete this upload?"))
      return;
    setBusy(id);
    setError(null);
    const res = await fetch(
      `${API}/api/badminton/submissions/${id}/${action}/`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${store("adminToken")}` },
      },
    ).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      setError(body?.error || "request failed");
    }
    await load();
    onChanged();
  }

  const online =
    !!workerSeen && now - new Date(workerSeen).getTime() < WORKER_ONLINE_MS;
  const visible = rows.filter(
    (r) => r.status !== "uploading" || r.received_bytes > 0,
  );

  return (
    <div style={{ ...card, marginBottom: "1.25rem", borderColor: "#1f2a2e" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: visible.length ? "0.75rem" : 0,
        }}
      >
        <span style={{ ...label, color: ACCENT }}>queue</span>
        <span
          style={{ fontSize: "0.68rem", color: online ? "#22c55e" : "#777" }}
        >
          <span
            style={{
              display: "inline-block",
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: online ? "#22c55e" : "#444",
              marginRight: "0.35rem",
            }}
          />
          {online
            ? "PC worker online"
            : workerSeen
              ? `PC worker last seen ${new Date(workerSeen).toLocaleString("en-GB")}`
              : "PC worker never seen — run scripts/badminton_worker.py"}
        </span>
        {!visible.length && (
          <span style={{ fontSize: "0.68rem", color: "#555" }}>
            nothing waiting
          </span>
        )}
      </div>
      {error && (
        <div
          style={{
            fontSize: "0.75rem",
            color: "#ef4444",
            marginBottom: "0.5rem",
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "grid", gap: "0.6rem" }}>
        {visible.map((r) => (
          <div
            key={r.id}
            style={{ borderTop: "1px solid #161616", paddingTop: "0.6rem" }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.5rem 0.9rem",
                alignItems: "center",
              }}
            >
              <span style={{ color: "#eee", fontSize: "0.82rem" }}>
                {r.player.name}
              </span>
              <span style={{ color: "#888", fontSize: "0.72rem" }}>
                {formatSubmissionDate(r.recorded_on)}
              </span>
              <span style={{ color: "#666", fontSize: "0.68rem" }}>
                {r.filename} · {formatBytes(r.size_bytes)}
                {r.height_m ? ` · ${Math.round(r.height_m * 100)} cm` : ""}
                {r.hand ? ` · ${r.hand}-handed` : ""} · {r.lang}
              </span>
              <StatusChip row={r} />
              <span style={{ flex: 1 }} />
              {r.video_url && (
                <button
                  style={btn}
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                >
                  {open === r.id ? "hide" : "watch"}
                </button>
              )}
              {(r.status === "pending" ||
                r.status === "failed" ||
                r.status === "running") && (
                <button
                  style={r.status === "running" ? btn : btnPrimary}
                  disabled={busy === r.id}
                  title={
                    r.status === "running" ? "re-queue a stuck job" : undefined
                  }
                  onClick={() => act(r.id, "approve")}
                >
                  {r.status === "pending"
                    ? "approve & run now"
                    : r.status === "failed"
                      ? "retry"
                      : "re-queue"}
                </button>
              )}
              <button
                style={{ ...btn, color: "#ef4444", borderColor: "#442222" }}
                disabled={busy === r.id}
                onClick={() => act(r.id, "delete")}
              >
                {r.status === "pending" ? "reject" : "delete"}
              </button>
            </div>
            {r.note && (
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "#999",
                  marginTop: "0.3rem",
                }}
              >
                “{r.note}”
              </div>
            )}
            {r.status === "failed" && r.error && (
              <pre
                style={{
                  fontSize: "0.68rem",
                  color: "#ef4444",
                  whiteSpace: "pre-wrap",
                  margin: "0.4rem 0 0",
                  maxHeight: "8rem",
                  overflow: "auto",
                }}
              >
                {r.error}
              </pre>
            )}
            {r.status === "running" && (
              <ProgressBar step={r.step} stage={r.stage} />
            )}
            {open === r.id && r.video_url && (
              <video
                src={mediaUrl(API, r.video_url)}
                controls
                muted
                playsInline
                preload="metadata"
                style={{ ...video, marginTop: "0.5rem" }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusChip({ row }: { row: QueueRow }) {
  const colors: Record<string, string> = {
    uploading: "#777",
    pending: "#f59e0b",
    approved: "#06b6d4",
    running: "#06b6d4",
    failed: "#ef4444",
  };
  const text =
    row.status === "uploading"
      ? `uploading ${Math.round((100 * row.received_bytes) / row.size_bytes)}%`
      : row.status === "approved"
        ? `queued #${row.queue_position ?? "?"}`
        : row.status;
  return (
    <span
      className="tag"
      style={{
        fontSize: "0.55rem",
        color: colors[row.status],
        borderColor: colors[row.status],
      }}
    >
      {text}
    </span>
  );
}

export function ProgressBar({
  step,
  stage,
}: {
  step: string | null;
  stage: string | null;
}) {
  const pct = Math.round(100 * analysisProgress(step, stage));
  return (
    <div style={{ marginTop: "0.4rem" }}>
      <div
        style={{
          height: "3px",
          background: "#1a1a1a",
          borderRadius: "2px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: ACCENT,
            transition: "width 0.5s",
          }}
        />
      </div>
      <div style={{ fontSize: "0.65rem", color: "#666", marginTop: "0.2rem" }}>
        {stepLabel(step)}
        {stage ? ` · ${stage}` : ""} · ~{pct}%
      </div>
    </div>
  );
}
