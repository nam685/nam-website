"use client";

import { useState } from "react";
import type { Turn } from "@/lib/api";
import { API } from "@/lib/api";
import { formatSize } from "@/lib/slopsLimits";

const ACCENT = "#39ff14";

export default function AttachmentList({
  turns,
  isAdmin,
  adminToken,
}: {
  turns: Turn[];
  isAdmin: boolean;
  adminToken: string | null;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      {turns
        .filter((t) => (t.attachments ?? []).length > 0)
        .map((t) => (
          <div
            key={t.id}
            style={{
              padding: "8px 12px",
              border: "1px solid #222",
              borderRadius: 6,
              marginBottom: 8,
              background: "#0d0d0d",
            }}
          >
            <div
              style={{
                color: "#666",
                fontSize: 10,
                marginBottom: 6,
                textTransform: "uppercase",
              }}
            >
              Turn {t.id} attachments
            </div>
            {(t.attachments ?? []).map((a) => (
              <AttachmentRow
                key={a.id}
                attachment={a}
                isAdmin={isAdmin}
                adminToken={adminToken}
              />
            ))}
          </div>
        ))}
    </div>
  );
}

function AttachmentRow({
  attachment,
  isAdmin,
  adminToken,
}: {
  attachment: { id: number; filename: string; size: number; previewable: boolean };
  isAdmin: boolean;
  adminToken: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPreview = isAdmin && attachment.previewable;

  const toggle = async () => {
    if (!canPreview) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (preview !== null) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/api/slops/attachments/${attachment.id}/preview/`,
        {
          headers: { Authorization: `Bearer ${adminToken}` },
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Failed to load preview");
        return;
      }
      const data = await res.json();
      setPreview(data.content);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontSize: 12 }}>
      <div
        onClick={toggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 0",
          cursor: canPreview ? "pointer" : "default",
          color: "#ccc",
        }}
      >
        <span
          style={{
            color: canPreview ? ACCENT : "#666",
            fontFamily: "monospace",
          }}
        >
          {canPreview ? (expanded ? "▾" : "▸") : "·"}
        </span>
        <span>{attachment.filename}</span>
        <span style={{ color: "#666" }}>({formatSize(attachment.size)})</span>
      </div>
      {expanded && canPreview && (
        <pre
          style={{
            marginTop: 4,
            padding: "8px 10px",
            maxHeight: 300,
            overflow: "auto",
            background: "#050505",
            border: "1px solid #222",
            borderRadius: 4,
            color: "#ccc",
            fontSize: 11,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {loading ? "Loading…" : error ? error : preview}
        </pre>
      )}
    </div>
  );
}
