"use client";

import { useCallback, useEffect, useState } from "react";
import type { ToolStatus, ToolSyncStatus, TrackedTool } from "@/lib/api";
import { API } from "@/lib/api";
import { timeAgo } from "@/lib/date";
import {
  TOOL_TABS,
  DEFAULT_TOOL_TAB,
  groupToolsByStatus,
  formatStarCount,
} from "@/lib/toolRadar";

const ACCENT = "#39ff14";

const TAB_LABELS: Record<ToolStatus, string> = {
  watching: "Watching",
  adopted: "Adopted",
  dropped: "Dropped",
};

export default function ToolsView({
  adminToken,
}: {
  adminToken: string | null;
}) {
  const [tools, setTools] = useState<TrackedTool[]>([]);
  const [tab, setTab] = useState<ToolStatus>(DEFAULT_TOOL_TAB);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<ToolSyncStatus | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const isAdmin = !!adminToken;

  const fetchTools = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/tools/`);
      if (!res.ok) return;
      setTools(await res.json());
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  const fetchSyncStatus = useCallback(async () => {
    if (!adminToken) return;
    try {
      const res = await fetch(`${API}/api/tools/sync-status/`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (!res.ok) return;
      setSyncStatus(await res.json());
    } catch {
      /* silent */
    }
  }, [adminToken]);

  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  const handleSync = async () => {
    if (!adminToken || syncing) return;
    setSyncing(true);
    try {
      const res = await fetch(`${API}/api/tools/sync/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        await fetchTools();
        await fetchSyncStatus();
      }
    } catch {
      /* silent */
    } finally {
      setSyncing(false);
    }
  };

  const handleUpdate = async (id: number, body: Record<string, unknown>) => {
    if (!adminToken) return;
    try {
      const res = await fetch(`${API}/api/tools/${id}/update/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) await fetchTools();
    } catch {
      /* silent */
    }
  };

  const handleDrop = (tool: TrackedTool) => {
    const reason = window.prompt(`Why drop "${tool.name}"?`, tool.notes || "");
    if (reason === null) return;
    if (!reason.trim()) {
      window.alert("A reason is required to drop a tool.");
      return;
    }
    handleUpdate(tool.id, { status: "dropped", notes: reason.trim() });
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setAddError(null);
    try {
      const res = await fetch(`${API}/api/tools/create/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ name: addName, url: addUrl, notes: addNotes }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAddError((data as { error?: string }).error ?? "Failed to add tool");
        return;
      }
      setAddName("");
      setAddUrl("");
      setAddNotes("");
      setShowAddForm(false);
      await fetchTools();
    } catch {
      setAddError("Network error");
    }
  };

  const groups = groupToolsByStatus(tools);
  const activeTools = groups[tab];

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "16px 20px 40px",
        fontFamily: "monospace",
        color: "#ccc",
      }}
    >
      <div
        style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}
      >
        {TOOL_TABS.map((s) => (
          <button
            key={s}
            onClick={() => setTab(s)}
            style={{
              padding: "6px 14px",
              borderRadius: 4,
              border: `1px solid ${tab === s ? ACCENT : "#333"}`,
              background: tab === s ? `${ACCENT}18` : "transparent",
              color: tab === s ? ACCENT : "#999",
              fontSize: 12,
              fontFamily: "monospace",
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            {TAB_LABELS[s]} ({groups[s].length})
          </button>
        ))}

        {isAdmin && (
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <button
              onClick={() => setShowAddForm((v) => !v)}
              style={{
                padding: "6px 12px",
                borderRadius: 4,
                border: `1px solid #333`,
                background: "transparent",
                color: "#999",
                fontSize: 12,
                fontFamily: "monospace",
                cursor: "pointer",
              }}
            >
              + Add tool
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              style={{
                padding: "6px 12px",
                borderRadius: 4,
                border: `1px solid ${ACCENT}60`,
                background: "transparent",
                color: ACCENT,
                fontSize: 12,
                fontFamily: "monospace",
                cursor: syncing ? "default" : "pointer",
                opacity: syncing ? 0.6 : 1,
              }}
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            {syncStatus?.last_sync && (
              <span style={{ fontSize: 10, color: "#666" }}>
                last synced {timeAgo(syncStatus.last_sync)}
                {syncStatus.error ? ` (error: ${syncStatus.error})` : ""}
              </span>
            )}
          </div>
        )}
      </div>

      {isAdmin && showAddForm && (
        <form
          onSubmit={handleAdd}
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 16,
            padding: 12,
            border: "1px solid #222",
            borderRadius: 6,
            background: "#0d0d0d",
          }}
        >
          <input
            placeholder="name"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            placeholder="url"
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            required
            style={{ ...inputStyle, minWidth: 240 }}
          />
          <input
            placeholder="notes (e.g. coworker rec)"
            value={addNotes}
            onChange={(e) => setAddNotes(e.target.value)}
            style={{ ...inputStyle, minWidth: 200 }}
          />
          <button
            type="submit"
            style={{
              padding: "6px 14px",
              borderRadius: 4,
              border: `1px solid ${ACCENT}`,
              background: `${ACCENT}18`,
              color: ACCENT,
              fontSize: 12,
              fontFamily: "monospace",
              cursor: "pointer",
            }}
          >
            Add
          </button>
          {addError && (
            <span style={{ color: "#ef4444", fontSize: 11 }}>{addError}</span>
          )}
        </form>
      )}

      {loading && <div style={{ color: "#666", fontSize: 12 }}>Loading…</div>}

      {!loading && activeTools.length === 0 && (
        <div style={{ color: "#555", fontSize: 12 }}>Nothing here yet.</div>
      )}

      {activeTools.map((tool) => (
        <ToolRow
          key={tool.id}
          tool={tool}
          isAdmin={isAdmin}
          onUpdate={handleUpdate}
          onDrop={handleDrop}
        />
      ))}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 4,
  border: "1px solid #333",
  background: "#050505",
  color: "#ccc",
  fontSize: 12,
  fontFamily: "monospace",
};

function ToolRow({
  tool,
  isAdmin,
  onUpdate,
  onDrop,
}: {
  tool: TrackedTool;
  isAdmin: boolean;
  onUpdate: (_id: number, _body: Record<string, unknown>) => void;
  onDrop: (_tool: TrackedTool) => void;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        border: "1px solid #222",
        borderRadius: 6,
        marginBottom: 8,
        background: "#0d0d0d",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <a
          href={tool.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: ACCENT,
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {tool.name}
        </a>
        {tool.category && <Badge color="#60a5fa">{tool.category}</Badge>}
        {tool.stars !== null && (
          <Badge color="#999">★ {formatStarCount(tool.stars)}</Badge>
        )}
        {tool.status === "watching" && tool.is_new && (
          <Badge color={ACCENT}>NEW</Badge>
        )}
        {tool.is_stale && <Badge color="#f59e0b">STALE — re-review?</Badge>}
      </div>

      {tool.description && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#999" }}>
          {tool.description}
        </div>
      )}
      {tool.notes && (
        <div style={{ marginTop: 4, fontSize: 11, color: "#666" }}>
          note: {tool.notes}
        </div>
      )}

      {isAdmin && (
        <div
          style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}
        >
          {tool.status !== "watching" && (
            <RowButton
              onClick={() => onUpdate(tool.id, { status: "watching" })}
            >
              Watch
            </RowButton>
          )}
          {tool.status !== "adopted" && (
            <RowButton onClick={() => onUpdate(tool.id, { status: "adopted" })}>
              Adopt
            </RowButton>
          )}
          {tool.status !== "dropped" && (
            <RowButton onClick={() => onDrop(tool)}>Drop</RowButton>
          )}
          {tool.is_stale && (
            <RowButton
              onClick={() => onUpdate(tool.id, { mark_reviewed: true })}
            >
              Still relevant
            </RowButton>
          )}
        </div>
      )}
    </div>
  );
}

function Badge({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: 4,
        background: `${color}18`,
        border: `1px solid ${color}40`,
        color,
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {children}
    </span>
  );
}

function RowButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 10px",
        borderRadius: 4,
        border: "1px solid #333",
        background: "transparent",
        color: "#999",
        fontSize: 11,
        fontFamily: "monospace",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
