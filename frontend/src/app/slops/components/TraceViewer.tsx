"use client";

import { useState } from "react";
import { type ATIFStep, type MissionTrace } from "@/lib/api";

const ACCENT = "#39ff14";

/* ── ToolCallBlock ────────────────────────────────────── */

function ToolCallBlock({
  call,
}: {
  call: NonNullable<ATIFStep["tool_calls"]>[number];
}) {
  const [expanded, setExpanded] = useState(false);

  const args = call.arguments;
  const keyArg =
    (args.path as string) ||
    (args.command as string) ||
    (args.file_path as string) ||
    (args.pattern as string) ||
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
          {call.function_name}
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
          {JSON.stringify(args, null, 2)}
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

/* ── TraceViewer ──────────────────────────────────────── */

export default function TraceViewer({ trace }: { trace: MissionTrace }) {
  const steps: ATIFStep[] = trace.trace?.steps ?? [];

  if (steps.length === 0) {
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
        {trace.status === "running" || trace.status === "approved"
          ? "Waiting for trace data\u2026"
          : trace.status === "pending"
            ? "Mission awaiting approval"
            : "No trace data available"}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "16px 0",
      }}
    >
      {steps.map((step) => {
        /* User messages — right-aligned bubble */
        if (step.source === "user") {
          return (
            <div
              key={step.step_id}
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
                {step.message ?? ""}
              </div>
            </div>
          );
        }

        /* System steps (tool results / observations) */
        if (step.source === "system") {
          const results = step.observation?.results ?? [];
          if (results.length > 0) {
            return (
              <div key={step.step_id}>
                {results.map((r) => (
                  <ToolResult
                    key={r.tool_call_id}
                    content={r.content || "(empty result)"}
                  />
                ))}
              </div>
            );
          }
          if (step.message) {
            return <ToolResult key={step.step_id} content={step.message} />;
          }
          return null;
        }

        /* Agent steps — left-aligned with tool calls */
        if (step.source === "agent") {
          return (
            <div key={step.step_id} style={{ maxWidth: "90%" }}>
              {step.message && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: "12px 12px 12px 2px",
                    background: "#1a1a1a",
                    border: "1px solid #333",
                    color: "#ccc",
                    fontSize: 13,
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    marginBottom:
                      step.tool_calls && step.tool_calls.length > 0 ? 8 : 0,
                  }}
                >
                  {step.message}
                </div>
              )}
              {step.tool_calls?.map((tc) => (
                <ToolCallBlock key={tc.tool_call_id} call={tc} />
              ))}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
