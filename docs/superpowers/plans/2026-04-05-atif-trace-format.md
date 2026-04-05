# ATIF Trace Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update nam-website to consume klaude's new ATIF v1.4 trace format instead of raw chat-message JSON.

**Architecture:** Backend (`tasks.py`) passes `--session-dir` so klaude writes ATIF directly to the trace directory — no copy step. The trace view endpoint reads the newest `*.json` in that directory. Frontend types and TraceViewer are updated to render ATIF steps instead of chat messages. The `fetchTrace` bug (fetching detail endpoint instead of trace endpoint) is fixed.

**Tech Stack:** Python/Django (backend), TypeScript/React/Next.js (frontend)

**Spec:** `docs/superpowers/specs/2026-04-05-nam-website-atif-changes.md`

**Worktree:** `.claude/worktrees/atif-trace` (branch `feat/atif-trace-format`)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `website/tasks.py` | Modify | `_execute_klaude()`: pass `--session-dir`, read ATIF metrics, return `trace_dir` |
| `website/views/slops.py` | Modify | `slops_trace()`: glob newest `*.json` instead of hardcoded `trace.json` |
| `website/tests/test_tasks.py` | Modify | Update mock return value to include `trace_dir`, add assertion for `trace_path` |
| `frontend/src/lib/api.ts` | Modify | Add `ATIFStep`, `ATIFDocument` types; update `MissionTrace` |
| `frontend/src/app/slops/components/TraceViewer.tsx` | Modify | Render ATIF `steps[]` instead of chat `messages[]` |
| `frontend/src/app/slops/page.tsx` | Modify | Fix `fetchTrace()` to call `/api/slops/<id>/trace/` |

---

### Task 1: Update `_execute_klaude()` to use ATIF format

**Files:**
- Modify: `website/tasks.py:16-74`
- Modify: `website/tests/test_tasks.py`

- [ ] **Step 1: Update the test to expect the new return shape**

The existing test mocks `_execute_klaude` return value. Add `trace_dir` to the mock and assert `mission.trace_path` is set.

In `website/tests/test_tasks.py`, update `test_sets_status_to_running_then_done`:

```python
def test_sets_status_to_running_then_done(self):
    m = Mission.objects.create(prompt="test", submitter_ip="127.0.0.1", status="approved", workspace="task-1")
    with patch("website.tasks._execute_klaude") as mock_exec:
        mock_exec.return_value = {
            "summary": "Did stuff",
            "token_count": 100,
            "tool_calls": 5,
            "error": "",
            "trace_dir": "/home/klaude/traces/task-1",
        }
        run_mission(m.id)
    m.refresh_from_db()
    assert m.status == "done"
    assert m.summary == "Did stuff"
    assert m.token_count == 100
    assert m.trace_path == "/home/klaude/traces/task-1"
    assert m.started_at is not None
    assert m.completed_at is not None
```

- [ ] **Step 2: Run the test — expect failure**

Run: `cd .claude/worktrees/atif-trace && uv run pytest website/tests/test_tasks.py::TestRunMission::test_sets_status_to_running_then_done -v`

Expected: FAIL — `trace_dir` key missing from mock return / `trace_path` not set on mission.

- [ ] **Step 3: Rewrite `_execute_klaude()` and update `run_mission()`**

Replace the entire `_execute_klaude` function in `website/tasks.py`:

```python
from pathlib import Path


def _execute_klaude(mission):
    """Run klaude CLI as the klaude user. Returns result dict."""
    workspace_dir = os.path.join(WORKSPACE_BASE, mission.workspace)
    trace_dir = os.path.join(TRACES_BASE, mission.workspace)
    os.makedirs(trace_dir, exist_ok=True)

    result = subprocess.run(
        [
            "sudo",
            "-u",
            KLAUDE_USER,
            KLAUDE_BIN,
            mission.prompt,
            "--auto-approve",
            "--session-dir",
            trace_dir,  # klaude writes ATIF here directly
        ],
        capture_output=True,
        text=True,
        timeout=600,  # 10 minute max
        cwd=workspace_dir,
    )

    # Read ATIF trace (newest .json file in trace_dir)
    atif = {}
    trace_files = sorted(Path(trace_dir).glob("*.json"), key=lambda f: f.stat().st_mtime)
    if trace_files:
        with open(trace_files[-1]) as f:
            atif = json.load(f)

    # Metrics from ATIF final_metrics
    fm = atif.get("final_metrics", {})
    token_count = fm.get("total_prompt_tokens", 0) + fm.get("total_completion_tokens", 0)
    tool_calls_count = sum(len(s.get("tool_calls", [])) for s in atif.get("steps", []) if s.get("source") == "agent")

    # Summary from last agent step with content
    summary = ""
    for step in reversed(atif.get("steps", [])):
        if step.get("source") == "agent" and step.get("message"):
            summary = step["message"][:500]
            break

    return {
        "summary": summary,
        "token_count": token_count,
        "tool_calls": tool_calls_count,
        "error": result.stderr if result.returncode != 0 else "",
        "trace_dir": trace_dir,
    }
```

Also update `run_mission()` to set `trace_path`:

```python
    try:
        result = _execute_klaude(mission)
        mission.status = "done" if not result["error"] else "failed"
        mission.summary = result["summary"]
        mission.token_count = result["token_count"]
        mission.tool_calls = result["tool_calls"]
        mission.error = result["error"]
        mission.trace_path = result["trace_dir"]
    except Exception as e:
```

- [ ] **Step 4: Run the test — expect pass**

Run: `cd .claude/worktrees/atif-trace && uv run pytest website/tests/test_tasks.py -v`

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add website/tasks.py website/tests/test_tasks.py
git commit -m "feat(slops): update _execute_klaude for ATIF v1.4 trace format

Pass --session-dir so klaude writes ATIF directly to trace dir.
Read metrics from final_metrics instead of counting manually.
Set trace_path on mission after execution."
```

---

### Task 2: Update `slops_trace()` to glob newest JSON

**Files:**
- Modify: `website/views/slops.py:155-185`

- [ ] **Step 1: Update `slops_trace()` to find newest `*.json`**

Replace the trace file lookup logic in `slops_trace()`:

```python
def slops_trace(request, mission_id):
    """GET /api/slops/<id>/trace/ — return trace file contents."""
    if request.method != "GET":
        return JsonResponse({"error": "GET required"}, status=405)

    try:
        m = Mission.objects.get(id=mission_id)
    except Mission.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    if not m.trace_path:
        return JsonResponse({"trace": None})

    # Find newest ATIF JSON in trace dir
    from pathlib import Path

    trace_files = sorted(Path(m.trace_path).glob("*.json"), key=lambda f: f.stat().st_mtime)
    if not trace_files:
        return JsonResponse({"trace": None})

    try:
        import json

        with open(trace_files[-1]) as f:
            content = json.load(f)
    except (OSError, json.JSONDecodeError):
        return JsonResponse({"error": "Failed to read trace file"}, status=500)

    return JsonResponse({"trace": content})
```

- [ ] **Step 2: Run backend tests**

Run: `cd .claude/worktrees/atif-trace && uv run pytest website/tests/ -v`

Expected: All tests PASS (no functional test for trace view endpoint currently, but no regressions).

- [ ] **Step 3: Commit**

```bash
git add website/views/slops.py
git commit -m "feat(slops): trace endpoint reads newest ATIF json via glob

Instead of hardcoded trace.json, find newest *.json in trace_path.
klaude now names files by session ID (e.g. 20260405-143000.json)."
```

---

### Task 3: Add ATIF types and update `MissionTrace` in frontend

**Files:**
- Modify: `frontend/src/lib/api.ts:225-268`

- [ ] **Step 1: Add ATIF types and update `MissionTrace`**

Replace the slops types section in `frontend/src/lib/api.ts` (starting at the `/* ── Slops` comment):

```typescript
/* ── Slops (Agent Showcase) ────────────────────────── */

export type MissionStatus =
  | "pending"
  | "approved"
  | "running"
  | "done"
  | "failed"
  | "rejected";

export interface Mission {
  id: number;
  prompt: string;
  status: MissionStatus;
  workspace: string;
  token_count: number;
  tool_calls: number;
  summary: string;
  error: string;
  created_at: string;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface MissionListResponse {
  missions: Mission[];
  total: number;
  limit: number;
  offset: number;
}

export interface MissionStats {
  total_missions: number;
  total_tokens: number;
  total_tool_calls: number;
  success_rate: number;
  pending_count: number;
}

export interface ATIFStep {
  step_id: number;
  timestamp: string;
  source: "user" | "agent" | "system";
  message: string | null;
  model_name?: string;
  tool_calls?: {
    tool_call_id: string;
    function_name: string;
    arguments: Record<string, unknown>;
  }[];
  observation?: {
    results: { tool_call_id: string; content: string }[];
  };
  metrics?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export interface ATIFDocument {
  schema_version: string;
  session_id: string;
  agent: { name: string; version: string; model_name: string };
  steps: ATIFStep[];
  final_metrics?: {
    total_prompt_tokens: number;
    total_completion_tokens: number;
    total_cached_tokens: number;
    total_cost_usd: number;
    total_steps: number;
  };
}

export interface MissionTrace {
  trace: ATIFDocument | null;
  status: MissionStatus;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd .claude/worktrees/atif-trace/frontend && pnpm build 2>&1 | head -30`

Expected: Type errors in `TraceViewer.tsx` and/or `page.tsx` (since they still reference old shape). That's fine — we fix those next.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(slops): add ATIF v1.4 types, update MissionTrace interface

ATIFStep and ATIFDocument types for klaude's new trace format.
MissionTrace.trace is now ATIFDocument | null."
```

---

### Task 4: Fix `fetchTrace()` in page.tsx to call trace endpoint

**Files:**
- Modify: `frontend/src/app/slops/page.tsx:105-120`

- [ ] **Step 1: Fix `fetchTrace` to call both detail and trace endpoints**

Replace the `fetchTrace` callback:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/slops/page.tsx
git commit -m "fix(slops): fetchTrace calls /trace/ endpoint, not detail

The old code fetched /api/slops/<id>/ (detail, no trace data).
Now fetches both detail (for status) and trace (for ATIF document)."
```

---

### Task 5: Update TraceViewer to render ATIF steps

**Files:**
- Modify: `frontend/src/app/slops/components/TraceViewer.tsx`

- [ ] **Step 1: Rewrite TraceViewer for ATIF format**

Replace the entire file:

```tsx
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
            return (
              <ToolResult
                key={step.step_id}
                content={step.message}
              />
            );
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
```

- [ ] **Step 2: Build frontend to verify no type errors**

Run: `cd .claude/worktrees/atif-trace/frontend && pnpm build 2>&1 | tail -10`

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/slops/components/TraceViewer.tsx
git commit -m "feat(slops): TraceViewer renders ATIF steps instead of chat messages

- step.source replaces msg.role (user/agent/system)
- call.function_name replaces call.function.name
- call.arguments is an object (no JSON.parse needed)
- observation.results replaces tool role messages
- step_id used as React key instead of array index"
```

---

### Task 6: Run full test suite and verify

- [ ] **Step 1: Run backend tests**

Run: `cd .claude/worktrees/atif-trace && uv run pytest -v`

Expected: All tests PASS.

- [ ] **Step 2: Run frontend build**

Run: `cd .claude/worktrees/atif-trace/frontend && pnpm build`

Expected: Build succeeds.

- [ ] **Step 3: Run frontend lint**

Run: `cd .claude/worktrees/atif-trace/frontend && pnpm lint`

Expected: No errors.
