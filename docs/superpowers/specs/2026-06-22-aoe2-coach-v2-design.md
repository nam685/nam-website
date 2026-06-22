# AoE2 Coach — Coach v2: Agentic Fact-Checking Coach (Design Spec)

**Date:** 2026-06-22
**Status:** Draft for review
**Scope:** Sub-project #4 of the "coach = preprocessing + AI" program.
**Program overview & feasibility map:** `aoe2coach-analysis/5_feasibility_and_design.md`
**Consumes the full preprocessing bundle:** #1 `Reconstruction`
(`docs/superpowers/specs/2026-06-22-aoe2-reconstruction-core-design.md`), #3 candidate builds +
reference library (`…/2026-06-22-aoe2-buildorder-classifier-design.md`), #6 flagged mistakes +
rubric (`…/2026-06-22-aoe2-coaching-knowledge-base-design.md`), and #7's strategic map
(`…/2026-06-22-aoe2-strategic-map-rendering-design.md`). The coach's quality is **bounded by the
quality of this bundle** — it explains, it does not re-analyze.

## Why

Today the coach is the *analyst*: it eyeballs a denoised log, guesses the build, and judges
against benchmarks it half-remembers (`COACH_SYSTEM`'s embedded uptime table) → wrong build,
bogus timing, invented numbers. #1 now hands it **honest structured facts** and #3 hands it
**1–3 candidate builds**. Coach v2 stops guessing and becomes an **explainer + investigator**:

1. Restate the named facts in a mandatory **WHAT HAPPENED** summary *before* any judgment.
2. **Progressive disclosure**: form a build hypothesis, then *read the specific candidate's Hera
   reference file on demand* (and, optionally, look up a unit/tech on the aoe2 wiki) — instead of
   stuffing 25 builds into the prompt.
3. Judge actual-vs-**verified** targets (from the reference it actually read) and **cite the
   source**. No invented benchmarks.

The mechanism change that makes this possible: the coach becomes an **agent with tools** in a
sandboxed per-match workspace, not a single embedded-everything `claude -p` call.

**Bounded by preprocessing (the program thesis).** Coach v2 consumes the **full preprocessing
bundle** — #1 reconstruction facts, #3 build candidates, #6 flagged mistakes, and #7's strategic
map — and is an *explainer/investigator over that bundle, never an analyzer of raw logs*. Its
output quality is therefore **capped by preprocessing quality**: heavy preprocessing in → good
coaching out; garbage in → garbage out. Every fact it states, every mistake it explains, and every
benchmark it cites originates in a preprocessing producer; the coach adds reasoning and narration,
not new analysis of the rec.

## Input contract (the full preprocessing bundle — #1, #3, #6, #7)

The coach consumes **all four preprocessing producers**; this is the bundle whose quality bounds
the coach's output. `coach()` receives, per match:

- **`reconstruction: dict`** *(#1 — facts)* — the #1 `Reconstruction` object (JSON-serializable).
  Authoritative facts: ages (arrival + click), techs (eco/military/university), production milestones
  (`first_military_building_s`, `first_siege_s`, `first_treb_s`, `first_unit_s`, plus the derived
  `first_military_unit_s`/`first_military_unit_name`), `*_produced` counts (labeled), spatial
  (base centroid for **both** me and opp, buildings, **forward** buildings, walls), efficiency
  (`tc_idle_s`, `longest_villager_gap_s`, `apm_eco`/`apm_military`), `engagements`
  (zones `own_base|center|opp_base`), `population.housed_flags`, and `meta`
  (map, duration, civs, **result**, ranked, opp_rating).
- **`candidates: list[dict]`** *(#3 — build candidates)* — 1–3 pre-narrowed builds from #3, each
  exactly #3's `Candidate` shape:
  `{build_id, name, confidence, matched_signals, missed_signals}` (no `slug`, no `reference_path`).
  `build_id` is #3's stable hyphenated id (e.g. `fast-castle-into-knights`); the per-build
  reference lives at `references/<build_id>.yaml`. #3 may also pass `is_confident` / `unknown` /
  `notes` from its `ClassificationResult`, which the agent uses to decide whether to verify between
  candidates or coach from first principles.
- **`reference_root: str`** *(#3 — reference library)* — directory containing the full Hera library
  (~25 build **YAML** files + any techtree pointers), loaded per #3 via `buildorders.load_one(build_id)`,
  so the agent can retrieve a *different* build if its hypothesis differs from the candidates.
- **`flagged: list[dict]`** *(#6 — flagged mistakes)* — #6's deterministic detector output (the
  linter-style `Flagged` rows; NOT LLM-noticed). Each carries a `mistake_id`, `severity`,
  `confidence_tier` (`exact`/`heuristic`/`needs-#2`), and the magnitude that tripped it. The coach
  **explains** these (it does not detect mistakes itself) and retrieves each one's rubric entry on
  demand via `mistakes.load_one(mistake_id)` — the same progressive-disclosure mechanism as #3's
  references.
- **`map_geometry: dict`** *(#7 — strategic map)* — drives the annotated `strategic_map.png` +
  `map_legend.md` #7 renders into the workspace (base layout, walls, forward buildings, scout
  route, army-push vectors, attacks on known buildings, engagement zones). The agent **sees** the
  PNG (multimodal Read); it is strictly additive (see graceful degradation).
- **`salient_log: str`** — kept for sequence/context (the agent reads facts for numbers, log for
  ordering). Unchanged from today.

The coach treats `reconstruction` numbers as ground truth and **never** invents benchmark targets;
targets come only from a reference file it has read. Its value is **capped by the quality of this
bundle** — it is an explainer over the four producers, not an analyzer of raw logs.

## Architecture: workspace + invocation + tools

### Per-match workspace (`workspace.py`, new)

`build_workspace(reconstruction, candidates, reference_root, salient_log, flagged, map_geometry, ops)
-> Path` materializes a throwaway temp dir (under `tempfile.mkdtemp(prefix="aoe2coach-")`), laid out
so the agent's tools have the full preprocessing bundle locally and nothing else:

```
<workspace>/
  facts.json            # json.dumps(reconstruction, indent=2) — authoritative numbers (#1)
  salient.log           # the dual mechanical log (sequence/context)
  candidates.md         # the 1-3 pre-narrowed builds (#3): build_id, name, confidence,
                        #   matched/missed signals, → references/<build_id>.yaml
  references/           # COPY of the Hera library (#3, read-only retrieval target) — YAML
    fast-castle-into-knights.yaml
    scouts-into-archers.yaml
    …                    # all ~25 builds (hyphenated build_id stems), so the agent can pick a
                        #   non-candidate if it disagrees; loaded per #3's load_one(build_id)
  mistakes.json         # NEW (#6) — the deterministic flagged-mistake list; the coach EXPLAINS
                        #   these and reads each rubric entry on demand via mistakes.load_one(id)
  rubric/               # COPY of #6's mistake-rubric library (read-only) — YAML, one per mistake_id
    idle-tc.yaml
    slow-feudal.yaml
    …
  strategic_map.png     # NEW (#7) — annotated strategic map the agent SEES (multimodal Read)
  map_legend.md         # NEW (#7) — one-paragraph legend + exact/heuristic disclaimer
  TASK.md               # the user-turn instructions (what to produce); points at the files above
```

`references/` and `rubric/` are **copied in** (not symlinked) so the agent's filesystem access
stays inside the workspace; cwd is the workspace, so Read/Grep need no `--add-dir`. #7's
`strategic_map.png` + `map_legend.md` are written by composing `build_map(reconstruction, ops, …)`
(hence `ops` in the signature). The dir is deleted in a `finally` after the run (best-effort; leave
on debug flag).

### Invocation (`run_agentic_coach`, replaces `run_claude_coach` for the v2 path)

Headless `claude -p` run with cwd = workspace, a **read-only** tool allowlist, JSON output:

```python
subprocess.run(
    [
        claude_bin, "-p", task_prompt,
        "--model", model,                       # "sonnet"
        "--output-format", "json",
        "--allowedTools", "Read", "Grep", "Glob",  # + WebFetch(domain:…) when web enabled
        "--permission-mode", PERMISSION_MODE,   # non-interactive auto-deny (see Open decisions)
        "--max-turns", str(max_turns),          # default 12 — bounds the tool loop
    ],
    cwd=str(workspace),
    capture_output=True, text=True, timeout=timeout,  # default 180s (longer than v1's 120)
)
```

- **Tools:** `Read`, `Grep`, `Glob` only — enough to read `facts.json`/`mistakes.json`, **see
  `strategic_map.png`** (multimodal Read), open the candidate's reference and a flagged mistake's
  rubric entry, grep the libraries, and retrieve a different build if it disagrees. **No** Write/Edit
  (output is the final assistant message, not a file), **no** Bash. When web is enabled, add
  `WebFetch(domain:age-of-empires-2.fandom.com)` (or the wiki host #3 standardizes on) — scoped to
  exactly one domain so the agent can verify a unit/tech stat but cannot browse the open web.
- **Headless permission behavior:** in `-p` mode, a tool not on the allowlist must be **auto-denied
  without hanging** (no TTY to prompt). The exact permission flag/mode that guarantees this is the
  one **open decision below** — we pin it during implementation by testing against the installed
  CLI; the design only requires "deny-not-hang."
- **Hermetic-ish:** the workspace must not contain a `CLAUDE.md` (it would be loaded into the system
  prompt). We additionally aim to suppress user `~/.claude` config / MCP servers so the run is
  reproducible (candidate flags `--strict-mcp-config --mcp-config '{}'`, `--settings '{}'`, and a
  bare/simple mode were reported by the CLI-docs research but vary by CLI version — verified &
  pinned at implementation, see Open decisions). None are *required* for correctness, only for
  hermeticity; the run works without them.
- **Capturing output:** parse stdout as JSON; the **final assistant text** is `data["result"]`
  (holds only the last message even after multiple tool turns). Also capture `data.get("model")`,
  and `total_cost_usd` / `num_turns` if present, for logging.

This package stays pure-ish: `aoe2coach` does the subprocess + tempdir; no Django/DB/network beyond
the `claude` subprocess (and the optional single-domain WebFetch the agent itself makes).

> **Harness note (Nam):** the repo's `claude_bin` may be `klaude` (DIY OpenRouter harness) or the
> real `claude` CLI. v2 *requires the agentic tool loop*, so it must run against a `claude_bin` that
> supports `--allowedTools` + the tool loop. If the configured binary doesn't (e.g. a klaude build
> without tools), v2 degrades to the single-shot facts-only path (below) — it does not error.

## The v2 system prompt (`COACH_SYSTEM_V2`)

Reuses #1's verified-facts framing and drops the embedded benchmark table (targets now come from
read references). Design constraints baked in: **restate before judge**, **record all named
markers**, **cite the reference you read**, **don't invent targets**, **under a word budget**.

```
You are a concise, precise Age of Empires II: Definitive Edition 1v1 coaching assistant
operating as an AGENT with file tools in this workspace.

Authoritative inputs in your cwd (the full preprocessing bundle — you EXPLAIN it, you do not
re-analyze the raw game):
  facts.json     — STRUCTURED MATCH FACTS (#1 Reconstruction). All numbers come from here.
                   *_produced counts are cumulative-queued upper bounds, NOT live counts —
                   never present them as live army/villager totals.
  salient.log    — mechanical event log; use ONLY for sequence/context, never for numbers.
  candidates.md  — 1-3 pre-narrowed build orders (#3), each with build_id, confidence, and
                   matched/missed signals → references/<build_id>.yaml.
  references/    — the build-order reference library (Hera targets), YAML, one file per
                   build_id (hyphenated, e.g. fast-castle-into-knights.yaml). Read on demand.
  mistakes.json  — DETERMINISTICALLY flagged mistakes (#6) — a linter result, already computed.
                   You EXPLAIN each flagged mistake (you do not detect mistakes yourself); read its
                   rubric entry on demand (Read rubric/<mistake_id>.yaml). Each flag carries a
                   confidence_tier: state `exact` flags as fact with the number, HEDGE `heuristic`
                   flags, and treat `needs-#2` flags as not-yet-detectable.
  strategic_map.png — an annotated strategic map (#7) of base layout, walls, forward buildings,
                   the scout's opening route, army-push directions, and where fights clustered.
  map_legend.md  — legend + the exact/heuristic disclaimer for the map.

AGE TIMINGS: judge ages by ARRIVAL time (facts.ages.*_arrival_s), not click time.

PROCESS (follow in order):
  1. Read facts.json and mistakes.json.
  2. READ strategic_map.png to see base layout, walls, forward buildings, the scout route,
     army-push directions, and engagement zones. Treat dashed/heuristic layers as approximate and
     NEVER describe unit-vs-unit combat — the map shows where forces MOVED and PUSHED, not who beat
     whom (see map_legend.md). If you cannot see the image, rely on facts.json — every coordinate
     is there; you lose the picture, not any fact.
  3. Form a build hypothesis from the early facts (first buildings, first units, age timing).
  4. READ the matching candidate's reference file (Read references/<build_id>.yaml). If none of the
     candidates fits what the facts show, Grep references/ and read the build that does — and
     say the classifier's candidates were off.
  5. For each flagged mistake, Read rubric/<mistake_id>.yaml and explain it, hedging per its
     confidence_tier (above).
  6. Judge actual-vs-target using ONLY the targets in the reference you read. If a target isn't
     in any reference and you didn't verify it, do NOT assert a number — say it's unverified.
  7. (If web is enabled) you MAY WebFetch the aoe2 wiki for a specific unit/tech stat. Cite it.

You MUST record these markers when present (record ALL — do not decide which matter): opening,
age-up ARRIVAL times, army composition, first military building, first siege, first treb,
forward buildings, eco/military tech timings, villager idle time, and HOW THE GAME ENDED
(who won + the mechanism, e.g. "opponent resigned after losing eco to archer raids").

OUTPUT — plain text, exactly two sections:

  WHAT HAPPENED
  - Opening: <tag>   (one of: scouts, archers, maa_archers, drush, fast_castle, tower_rush, unknown)
  - then 4-7 short FACTUAL bullets restating the markers above (timings, comp, outcome).
    Facts only here — no judgment.

  ANALYSIS
  - 3-4 short prose paragraphs of JUDGMENT only: uptime vs the reference target you read
    (cite it, e.g. "Hera's Fast Castle lands Feudal ~8:50; you hit 9:34 — 44s slow"),
    eco/production, the single most impactful observation, and one concrete next-game change.
    Do NOT restate raw facts here.

Cite every benchmark to the reference file or wiki page you read. Do NOT emit a standalone
"OPENING:" line — the opening is the first bullet of WHAT HAPPENED. Keep the whole report
under ~340 words. No fluff, no praise padding.
```

The `TASK.md` user turn is thin: "Coach this 1v1. Inputs are in your cwd (facts.json, mistakes.json,
strategic_map.png, map_legend.md, candidates.md, references/, rubric/). Follow the process in your
instructions and produce WHAT HAPPENED + ANALYSIS." The system prompt carries the contract;
`TASK.md` just points and triggers.

## Output contract + opening parsing

- **Return shape unchanged:** `CoachOutput(raw_text, opening_tag, model_used)`. `coach()` keeps its
  signature additively — gains `reconstruction`, `candidates`, `reference_root`, `flagged`,
  `map_geometry`, `ops` (all optional; when absent → v1 path, byte-identical for old callers; a
  missing `flagged`/`map_geometry` simply omits `mistakes.json`/the map from the workspace).
- **`raw_text`** = the agent's final message = `WHAT HAPPENED` + `ANALYSIS` (no standalone
  `OPENING:` line).
- **Opening parsing** (per phase-2 Task 7): parse the `- Opening: <tag>` bullet from the summary,
  keep the legacy `OPENING:` match for back-compat:

  ```python
  _OPENING_RE = re.compile(r"^\s*(?:-\s*)?OPENING:\s*(.+)|^\s*-\s*Opening:\s*(.+)",
                           re.MULTILINE | re.IGNORECASE)
  ```

  `entrypoint.analyze_replay` still sets `metrics["opening"]` / the returned `opening` from
  `out.opening_tag` → the UI chip is unaffected.
- `entrypoint.analyze_replay` gains a `facts_json` (the serialized `reconstruction`) additive key,
  consistent with phase-2 Task 8; existing eval columns (`coach_output`, `opening`, `metrics_json`,
  `salient_log`) are preserved.

## Graceful degradation (required by the program)

The prod wrapper owns degradation; the eval gets whatever `coach_output` results. Fallback ladder,
each step strictly weaker but still useful:

1. **Full agentic + web** — `claude` present & authed, tools work, WebFetch domain reachable.
2. **Agentic, no web** — drop `WebFetch` from the allowlist (web disabled by config, or the wiki
   domain unreachable). Reference files are local, so build-target verification still works; the
   agent just can't look up wiki unit stats. **This is the default** unless web is explicitly on.
3. **Single-shot facts-only fallback** — if the agentic run fails (claude missing/unauthed,
   non-zero exit, non-JSON output, timeout, `is_error`, empty `result`, or `claude_bin` lacks the
   tool loop): fall back to **`build_coach_prompt_v2(facts, salient_log, metrics)`** — the
   phase-2 Task-7 single `claude -p` call that embeds the facts block inline (no tools, no
   progressive disclosure). The candidate names/targets that *fit in budget* can be inlined here.
4. **Last-resort v1** — if v2 isn't wired for a caller (no `reconstruction` passed), the existing
   `build_coach_prompt` + embedded-benchmark path runs unchanged.

A `_FALLBACK` marker (e.g. `model_used` suffixed `+facts-only` / a logged `tier` field) records
which tier produced the output, so the eval and logs can tell agentic from fallback runs. The
single-shot path (3) is **kept as a maintained code path**, not dead code — it is the safety net and
also the cheaper option if agentic cost/latency proves unjustified.

## Latency / cost

- v1 is one model call (~few s). v2 is a multi-turn tool loop: read facts + mistakes → see the
  strategic map → read 1 reference + the flagged-mistake rubric entries → maybe 1 wiki fetch →
  write report ≈ **4–7 turns**. Expect a few× the latency and token cost of v1. Bound it: `--max-turns` (default 12, typical run far less), `timeout=180s`, and (if the CLI
  supports it) a per-run budget cap. The website already runs the coach **async (Celery)**, so
  added latency is off the request path.
- Progressive disclosure is the cost win vs. the naive alternative: instead of ~25 build files in
  every prompt, the agent reads **one**. Net prompt tokens per run should be *lower* than
  prompt-flooding, at the cost of extra turns.
- Eval compatibility: the elluminate eval rates a **pre-existing `coach_output`** string. v2
  changes *how* that string is produced, not the contract — `entrypoint.analyze_replay` still
  returns the same keys. The only behavioral change the eval must know about (already flagged in
  phase-2 Task 8): the output has **no standalone `OPENING:` line**; opening is the first
  `WHAT HAPPENED` bullet. The eval's v2 criteria should additionally reward: a present
  WHAT-HAPPENED summary, cited targets, and absence of invented benchmarks.

## Testing

All tests mock the subprocess — no real `claude`, no network (`aoe2coach` stays pure + offline-
testable; ruff line-length 120; PostToolUse ruff hook strips not-yet-used imports).

- **Workspace build** — `build_workspace(...)` writes `facts.json` (round-trips the reconstruction),
  `salient.log`, `candidates.md` (with hyphenated `build_id` → `references/<build_id>.yaml`),
  `mistakes.json` (round-trips `flagged`), `strategic_map.png` + `map_legend.md` (from `map_geometry`),
  copies `references/` (YAML) and `rubric/`, writes `TASK.md`; cleans up on context exit. With
  `flagged`/`map_geometry` absent, those files are simply omitted.
- **Invocation shape** — patch `subprocess.run`; assert argv contains `-p`, `--output-format json`,
  the read-only `--allowedTools` set (and that Write/Edit/Bash are absent), `cwd` == workspace.
  When web on: assert exactly one `WebFetch(domain:…)` entry and no bare `WebFetch`.
- **Prompt content** — assert `COACH_SYSTEM_V2` contains `WHAT HAPPENED`, the named-markers list,
  the "cite the reference"/"don't invent targets" rule, the **Read-the-map** clause + the
  no-unit-vs-unit-combat constraint, the **per-flag confidence_tier hedging** rule, and the
  two-section output spec; assert `TASK.md` points at `facts.json`/`mistakes.json`/`strategic_map.png`/
  `references/`.
- **Opening parses from summary** — `parse_opening("WHAT HAPPENED\n- Opening: Fast Castle\n…")`
  == `"Fast Castle"`; legacy `parse_opening("OPENING: Scouts\n…")` == `"Scouts"`.
- **Output capture** — mock JSON `{"result": "WHAT HAPPENED\n- Opening: Archers\n\nANALYSIS\nx",
  "model": "claude-sonnet-4-6"}`; assert `out.raw_text` round-trips and `out.opening_tag ==
  "Archers"`.
- **Graceful degradation** — mock non-zero exit / non-JSON / timeout / empty `result`; assert
  `coach()` falls back to the single-shot v2 path (second mocked call) and tags the tier; assert a
  no-`reconstruction` call takes the v1 path unchanged.
- **No real-rec test here** — golden-rec fidelity belongs to #1; v2 is mock-only (it has no
  deterministic output to assert against an LLM).

## What this sub-project deliberately does NOT do

- **Does not parse replays or compute facts** — that's #1 (`Reconstruction`). v2 only consumes it.
- **Does not classify the build or author the reference library** — that's #3. v2 *verifies* a
  candidate by reading its reference; it may overrule the candidates but does not build them.
- **Does not estimate resources / live curves** — #2; v2 must not present `*_produced` as live.
- **Does not detect mistakes** — #6 does, deterministically. v2 *explains* the `flagged` list and
  hedges by `confidence_tier`; it never invents a mistake of its own.
- **Does not render the strategic map** — #7 produces `strategic_map.png`/`map_geometry`. v2 *reads*
  the PNG; it must never describe unit-vs-unit combat the map cannot show.
- **Does not change the frontend** — #5. v2 keeps `metrics["opening"]` so the existing chip works.
- **Does not write files as output** — the report is the final assistant message, captured from
  `--output-format json` `result`; the agent's tools are read-only.

## Open decisions to flag (resolve at implementation against the installed CLI)

1. **Exact non-interactive permission flag.** Research (claude-code-guide) reported a
   `--permission-mode` with a non-interactive auto-deny value, plus hermeticity flags
   (`--strict-mcp-config`/`--mcp-config '{}'`, `--settings '{}'`, a bare/simple mode). These vary by
   CLI version and the repo may run `klaude` rather than `claude`. **Pin the exact flags by testing
   the installed binary** (`-p` with a non-allowlisted tool must *deny-not-hang*). The design only
   depends on that guarantee, not on a specific flag spelling.
2. **`claude_bin` capability.** Confirm the configured binary supports the tool loop +
   `--allowedTools`. If not, v2 runs the single-shot facts-only path; document the requirement.
3. **Web on/off default.** Default **off** (tier 2) for reproducibility and to avoid a flaky
   external dependency; enable WebFetch (single wiki domain) behind a config flag once the wiki
   host is standardized with #3. Confirm the exact wiki host to allowlist.
5. **Model tier — Haiku vs Sonnet vs Opus (evaluate, don't assume).** The coach is mostly
   *restate-the-facts + look-up-the-reference + explain* — not deep open-ended reasoning — so it may
   NOT need Opus. Run the same coach over the calibration games at each tier (`--model
   claude-haiku-4-5` / `claude-sonnet-4-6` / `claude-opus-4-8`) and compare: does it follow the
   workspace protocol (reads facts/map/reference, restates before judging), get the build + benchmark
   right, and stay honest (no fabricated numbers)? **Pick the cheapest tier that passes** — default
   `sonnet`, drop to `haiku` if it holds the protocol, reserve `opus` only if both fail. The Phase-1
   elluminate eval (issue #248) is the scoring harness for this comparison. `model` is already a
   `coach()` param, so this is a config/eval choice, not a code change.
6. **`references/` copy vs `--add-dir`.** Spec copies the library into the workspace for a clean
   read-only sandbox. If the library is large, switch to `--add-dir <reference_root>` (read-only)
   instead of copying — decide based on #3's library size.
5. **Cost/latency budget.** Set `--max-turns` and (if supported) a per-run USD cap; pick values
   after measuring a handful of real runs. If agentic cost isn't justified by eval-score gains over
   the single-shot facts path, the single-shot path is the maintained default.

## Relationship to the existing phase-2 plan

This **supersedes phase-2 Task 7** (single-shot facts-block coach). That Task-7 prompt
(`COACH_SYSTEM_V2`, `build_coach_prompt_v2`) is **retained as the fallback tier** (degradation step
3) — not discarded. The new work is the agentic layer on top: the per-match workspace, the
read-only tool loop, progressive disclosure of #3's references, and source-cited targets. The
opening-from-summary parsing and the dropped standalone `OPENING:` line are inherited unchanged
from Task 7.
