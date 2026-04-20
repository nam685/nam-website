"use client";

import { useState } from "react";
import { type SessionTrace, type Turn, type Download, API } from "@/lib/api";
import { formatSize } from "@/lib/slopsLimits";

const ACCENT = "#39ff14";

/* ── Types for trace messages ─────────────────────────── */

interface ToolCallFunction {
  name: string;
  arguments: string;
}

interface ToolCall {
  id: string;
  function: ToolCallFunction;
}

interface TraceMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/* ── ToolCallBlock ────────────────────────────────────── */

function ToolCallBlock({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  let parsedArgs: Record<string, unknown> = {};
  try {
    parsedArgs = JSON.parse(call.function.arguments);
  } catch {
    /* keep empty */
  }

  const keyArg =
    (parsedArgs.path as string) ||
    (parsedArgs.command as string) ||
    (parsedArgs.file_path as string) ||
    (parsedArgs.pattern as string) ||
    null;

  return (
    <div
      style={{
        margin: "6px 0",
        border: `1px solid ${ACCENT}25`,
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "8px 12px",
          background: `${ACCENT}08`,
          border: "none",
          cursor: "pointer",
          color: "#ccc",
          fontSize: 12,
          fontFamily: "monospace",
          textAlign: "left",
        }}
      >
        <span style={{ color: "#666", fontSize: 10 }}>
          {expanded ? "\u25BC" : "\u25B6"}
        </span>
        <span style={{ color: ACCENT, fontWeight: 600 }}>
          {call.function.name}
        </span>
        {keyArg && (
          <span
            style={{
              color: "#888",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {keyArg.length > 60 ? keyArg.slice(0, 60) + "\u2026" : keyArg}
          </span>
        )}
      </button>

      {expanded && (
        <pre
          style={{
            margin: 0,
            padding: "10px 12px",
            background: "#0a0a0a",
            color: "#aaa",
            fontSize: 11,
            fontFamily: "monospace",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {JSON.stringify(parsedArgs, null, 2)}
        </pre>
      )}
    </div>
  );
}

/* ── ToolResult ───────────────────────────────────────── */

function ToolResult({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > 200;
  const display =
    isLong && !expanded ? content.slice(0, 200) + "\u2026" : content;

  return (
    <div
      style={{
        margin: "4px 0 8px 16px",
        paddingLeft: 12,
        borderLeft: `2px solid ${ACCENT}30`,
      }}
    >
      <pre
        style={{
          margin: 0,
          color: "#777",
          fontSize: 11,
          fontFamily: "monospace",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {display}
      </pre>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: 4,
            background: "none",
            border: "none",
            color: ACCENT,
            fontSize: 11,
            fontFamily: "monospace",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {expanded ? "show less" : "show more"}
        </button>
      )}
    </div>
  );
}

/* ── DownloadChips ────────────────────────────────────── */

function DownloadChips({ downloads }: { downloads: Download[] }) {
  if (downloads.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 8,
      }}
    >
      {downloads.map((d) =>
        d.oversize ? (
          <span
            key={d.id}
            style={{
              padding: "4px 8px",
              border: `1px solid #333`,
              borderRadius: 4,
              background: "#111",
              color: "#666",
              fontSize: 11,
              fontFamily: "monospace",
            }}
          >
            {d.filename} · {formatSize(d.size)} · (too large)
          </span>
        ) : (
          <a
            key={d.id}
            href={`${API}/api/slops/downloads/${d.id}/`}
            download
            style={{
              padding: "4px 8px",
              border: `1px solid ${ACCENT}40`,
              borderRadius: 4,
              background: `${ACCENT}10`,
              color: "#ddd",
              fontSize: 11,
              fontFamily: "monospace",
              textDecoration: "none",
            }}
          >
            {d.filename} · {formatSize(d.size)} · ⬇
          </a>
        ),
      )}
    </div>
  );
}

/* ── TraceViewer ──────────────────────────────────────── */

export default function TraceViewer({
  trace,
  status,
  error,
  turns = [],
}: {
  trace: SessionTrace;
  status: string;
  error?: string;
  turns?: Turn[];
}) {
  const messages: TraceMessage[] =
    (trace.trace as { messages?: TraceMessage[] })?.messages ?? [];

  // Turn boundaries: each user message = start of a new turn. The Nth user
  // message corresponds to turns[N] (ordered chronologically, same as backend).
  const lastAssistantOfTurn = new Map<number, number>(); // message_index -> turn_index
  const userMessageToTurn = new Map<number, number>(); // message_index -> turn_index
  {
    let turnIdx = -1;
    let lastAssistantIdxInTurn = -1;
    messages.forEach((m, i) => {
      if (m.role === "user") {
        if (turnIdx >= 0 && lastAssistantIdxInTurn >= 0) {
          lastAssistantOfTurn.set(lastAssistantIdxInTurn, turnIdx);
        }
        turnIdx += 1;
        lastAssistantIdxInTurn = -1;
        userMessageToTurn.set(i, turnIdx);
      } else if (m.role === "assistant" && m.content) {
        lastAssistantIdxInTurn = i;
      }
    });
    if (turnIdx >= 0 && lastAssistantIdxInTurn >= 0) {
      lastAssistantOfTurn.set(lastAssistantIdxInTurn, turnIdx);
    }
  }

  if (messages.length === 0) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          color: "#555",
          fontFamily: "monospace",
          fontSize: 12,
        }}
      >
        {status === "running" || status === "approved"
          ? "Waiting for trace data\u2026"
          : status === "pending"
            ? "Awaiting approval"
            : "No trace data available"}
      </div>
    );
  }

  const isDone = status === "done" || status === "failed";
  const lastAssistantIdx = isDone
    ? messages.reduce((acc, m, i) => (m.role === "assistant" && m.content ? i : acc), -1)
    : -1;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "16px 0",
      }}
    >
      {messages.map((msg, i) => {
        /* Skip system messages */
        if (msg.role === "system") return null;

        /* Tool result messages */
        if (msg.role === "tool") {
          return (
            <ToolResult key={i} content={msg.content ?? "(empty result)"} />
          );
        }

        /* User messages — right-aligned bubble. Render the raw turn prompt
           (not msg.content) so the LLM-side wrapper prefixes
           ([downloads — …], [attachments — read these first]) stay out of
           the UI. Fall back to msg.content if no matching turn. */
        if (msg.role === "user") {
          const turnIdx = userMessageToTurn.get(i);
          const rawPrompt =
            turnIdx !== undefined ? turns[turnIdx]?.prompt : undefined;
          const displayContent =
            rawPrompt ??
            (typeof msg.content === "string"
              ? msg.content
              : JSON.stringify(msg.content));
          return (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <div
                style={{
                  maxWidth: "80%",
                  padding: "10px 14px",
                  borderRadius: "12px 12px 2px 12px",
                  background: `${ACCENT}15`,
                  border: `1px solid ${ACCENT}30`,
                  color: "#ddd",
                  fontSize: 13,
                  fontFamily: "monospace",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {displayContent}
              </div>
            </div>
          );
        }

        /* Assistant messages — left-aligned with tool calls */
        if (msg.role === "assistant") {
          const isFinal = i === lastAssistantIdx;
          const turnForChips = lastAssistantOfTurn.get(i);
          const chipsDownloads =
            turnForChips !== undefined ? (turns[turnForChips]?.downloads ?? []) : [];
          return (
            <div key={i} style={{ maxWidth: "90%" }}>
              {msg.content && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: "12px 12px 12px 2px",
                    background: `${ACCENT}08`,
                    border: `1px solid ${ACCENT}20`,
                    boxShadow: isFinal ? `0 0 12px ${ACCENT}15` : "none",
                    color: "#ccc",
                    fontSize: 13,
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    marginBottom:
                      msg.tool_calls && msg.tool_calls.length > 0 ? 8 : 0,
                  }}
                >
                  {msg.content}
                </div>
              )}
              {msg.tool_calls?.map((tc) => (
                <ToolCallBlock key={tc.id} call={tc} />
              ))}
              {chipsDownloads.length > 0 && <DownloadChips downloads={chipsDownloads} />}
            </div>
          );
        }

        return null;
      })}
      {(status === "running" || status === "approved") && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 0",
            color: "#666",
            fontSize: 11,
            fontFamily: "monospace",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: ACCENT,
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
          <style>{`@keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }`}</style>
          working{messages.length > 0 ? ` \u2014 ${messages.length} messages` : "\u2026"}
        </div>
      )}
      {error && (
        <div
          style={{
            padding: "10px 14px",
            marginTop: 12,
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 6,
            color: "#f87171",
            fontSize: 12,
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
