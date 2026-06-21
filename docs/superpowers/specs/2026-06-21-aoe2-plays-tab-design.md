# AoE2 Gameplay Tab — Design Spec

**Date:** 2026-06-21
**Status:** Approved (pending spec review)
**Topic:** New "Empires" tab in `/plays` for auto-synced AoE2 DE gameplay with pro-style analysis.

## Summary

Add a third, **public** tab ("Empires") to the existing `/plays` page showing the
website owner's Age of Empires II: Definitive Edition gameplay. New games are
pushed off the owner's PC by a local watcher script, parsed server-side from the
`.aoe2record` command log, enriched with ladder data from the relic-link API,
analyzed by the existing klaude harness (free OpenRouter model) reading a cleaned
log, and displayed as a stats header + featured game +
browsable match list with per-game deep analysis and optional highlight clips.

IGN: **nom**. The tab reuses the existing `/plays` cyan accent (`#06b6d4`) — **no
nav-wheel change** is required.

## Goals / Non-goals

**Goals**
- Auto-ingest the owner's latest games with minimal manual effort.
- Extract the metrics pro players actually look at: age-up times (uptimes),
  build order, eco tech timing, army composition, APM, approximate idle-TC.
- Generate a plain-language "what a coach would say" analysis per game.
- Show ladder context (ELO, rank, W/L) from relic-link.
- Let the owner attach highlight clips (YouTube/Twitch) to specific games.

**Non-goals**
- Full game-state simulation (exact resource/villager counts, map vision). These
  are **approximated from input cadence and labelled as estimates**, never
  presented as ground truth.
- Hosting video on the server (clips are external embeds).
- Public upload — ingestion is admin-only.
- **Team games — out of scope entirely.** Only 1v1 games are ingested/analyzed.
  Non-1v1 recs are skipped at upload time (recorded, marked `skipped`, not shown).

## Constraints / Realities

- The rich `.aoe2record` command log lives **only on the owner's local PC**. There
  is no public API to pull one's own rec files. → a PC-side watcher must push them.
- The relic-link API (`aoe-api.reliclink.com`) gives match metadata + ELO/rank by
  IGN, but **not** the rec binary → it enriches, it does not replace, the rec.
- `aoc-mgz` parses inputs, not simulated state. → metrics derived from inputs only;
  the rest approximated and flagged.
- `aoc-mgz` parsing can break on new DE patch versions. → **always store the raw
  rec file** so re-parsing after a library update is possible.

## Architecture / Data flow

```
Owner PC                       Server (Django + Celery)                    Browser
────────                       ────────────────────────                    ───────
aoe2_watcher.py  ──POST──▶  POST /api/aoe2/upload/  ──enqueue──▶  analyze_match(id):
(watch rec dir,             (auth, dedup by hash,                 1. mgz parse
 wait for write             store .aoe2record)                    2. salient timeline
 to finish)                                                       3. metrics + opening class
                                                                  4. relic-link enrich (ELO)
Celery beat (daily) ─────▶  enrich_ladder task    ◀───────────    5. klaude coach (greps salient.log)
(backfill ELO/rank          (relic-link by IGN)                   6. save
 on matches missing it)                                                │
                                                                       ▼
                                          GET /api/aoe2/matches/  ──▶  Empires tab
                                          GET /api/aoe2/matches/<id>/
```

## Backend

### Models (one file per model, per project convention)

`website/models/aoe2_match.py` — `Aoe2Match` (1v1 only — opponent stored inline,
no child player table):
- `rec_file` (FileField → media), `file_hash` (unique, sha256, dedup)
- `played_at`, `map_name`, `duration_seconds`, `game_version`
- `my_civ`, `my_color`, `my_result` (`win`/`loss`/`unknown`), `my_elo` (nullable),
  `my_rating_change` (nullable)
- `opponent_name`, `opponent_civ`, `opponent_color`, `opponent_elo` (nullable)
- `relic_match_id` (nullable), `relic_enriched_at` (nullable)
- `timeline` (JSON — salient event list), `metrics` (JSON — derived metrics)
- `coach_analysis` (text), `coach_model` (char), `analyzed_at` (nullable)
- `analysis_status` (`pending`/`parsing`/`analyzing`/`done`/`error`/`skipped`),
  `error_detail` (text)
- `featured` (bool)
- `clip_url`, `clip_title`, `clip_note`, `clip_start_seconds` (all nullable)
- `created_at`

Register in `models/__init__.py` `__all__`. (No `Aoe2MatchPlayer` table — dropped
with team-game scope.)

### Endpoints (`website/views/aoe2.py`, routes in `urls.py` under `/api/aoe2/`)

Public:
- `GET  /api/aoe2/matches/?limit=N&offset=N` — list (newest first; only
  `analysis_status=done` shown publicly), includes summary metrics + clip.
- `GET  /api/aoe2/matches/<id>/` — full detail: timeline, metrics, coach_analysis,
  players, clip.
- `GET  /api/aoe2/stats/` — aggregate header: current ELO/rank, W/L, favourite civ,
  count.

Admin (`require_admin`):
- `POST /api/aoe2/upload/` — multipart `rec` file. Dedup by hash (409/200 on dup),
  store, create `Aoe2Match(status=pending)`, enqueue `analyze_match`. **Used by both
  the watcher and the manual upload box.** A quick header parse rejects non-1v1
  games (stored `status=skipped`, not analyzed, not shown publicly).
- `GET  /api/aoe2/sync-status/` — recent matches + their `analysis_status`.
- `POST /api/aoe2/matches/<id>/clip/` — body `{url, title?, note?, start_seconds?}`.
- `POST /api/aoe2/matches/<id>/feature/` — toggle `featured` (only one featured at a time).
- `POST /api/aoe2/matches/<id>/reanalyze/` — re-run the pipeline (e.g. after mgz bump).
- `POST /api/aoe2/matches/<id>/delete/`.

### Tasks (`website/tasks.py` + Celery beat)

`analyze_match(match_id)` — the 4-stage pipeline (below). Idempotent; sets
`analysis_status` as it progresses; on exception stores `error_detail` and
`status=error` (fail loud, matching the listens sync philosophy).

`enrich_ladder()` — new beat task (daily, alongside `sync-listens-daily`). Polls
relic-link for the IGN's recent ladder state and backfills ELO/rank/rating-change
on matches missing relic data (covers races where the rec arrives before relic
has indexed the match).

### Analysis pipeline (stages)

1. **Parse & structure** — `aoc-mgz` → players, civs, map, winner, version,
   duration, and the full timestamped input stream. Identify "me" by matching IGN
   `nom`; store my + opponent civ/color/result inline on `Aoe2Match`. Reject the rec
   (`status=skipped`) if it is not a 2-player 1v1.
2. **Preprocess: noisy log → salient timeline** — discard move/right-click spam;
   keep meaningful events into `timeline`. **This stage also emits a grep-friendly
   plain-text `salient.log`** — one timestamped, tagged event per line (e.g.
   `08:32 AGE_UP feudal`, `10:15 BUILD barracks`, `12:40 TRAIN scout x3`,
   `14:02 TECH loom`) — which is the artifact the klaude coach reads with its
   grep/read tools in stage 4. Events captured:
   - age-up research → Feudal / Castle / Imperial **uptimes**
   - building placements → **build order**
   - eco techs (Loom, Wheelbarrow, Double-Bit Axe, Horse Collar, Hand Cart…) → eco timing
   - military unit trains → **army composition over time**
   - first military unit → inferred **first-attack timing**
   - villager train cadence → production consistency + **approximate idle-TC**
   - raw action count → **APM / approx. effective APM**
3. **Derived metrics + strategy classification** → `metrics`: uptimes vs.
   benchmarks, vill-production curve, eco:military ratio, idle-TC estimate, and an
   **opening classification** (Scouts / Archers / M@A→Archers / Drush / Fast Castle /
   Tower-rush / Other) from the build+tech+train fingerprint. Each estimate carries
   an `is_estimate` flag.
4. **klaude coach** — reuses the `/slops` klaude harness as a subprocess (free
   OpenRouter model, no API key on the website side; klaude owns its own LLM config).
   Analysis of an AoE2 log is not intelligence-demanding — the agent just needs to
   read/grep a clean log — so a free model with an agentic harness is sufficient.
   - **Workspace setup** (as the `klaude` user, mirroring `_execute_klaude`): create a
     per-match workspace dir under `WORKSPACE_BASE`; `sudo -u klaude tee` the
     `salient.log` (from stage 2) and `metrics.json` (from stage 3) into it.
   - **Invocation**: run klaude with a coaching prompt that tells it to `grep`/read
     `salient.log` + `metrics.json` and produce a concise 1v1 coach analysis
     (uptimes vs. benchmark, opening read, key mistakes, one improvement). The prompt
     **is** the "analyze-aoe2-game skill" — it carries the benchmark knowledge (target
     uptimes per opening, what pros scrutinize, common errors). Run
     `--auto-approve --session-dir <trace_dir>`, `cwd=workspace_dir`, timeout ~300s.
   - **Result**: read the final agent message from the ATIF trace → `coach_analysis`;
     store the trace path. `coach_model` records the klaude model used.
   - **Shared helper**: refactor the existing `_execute_klaude` in `tasks.py` into a
     reusable `run_klaude(prompt, workspace_dir, trace_dir, timeout)` so `/slops` and
     the aoe2 coach share one subprocess path instead of duplicating it.
   - **Concurrency/graceful**: shares the klaude/Celery queue with `/slops`. If klaude
     fails or times out, store metrics + empty `coach_analysis` with `status=done`
     (the metrics/timeline tab is still useful without the narrative).

### Dependencies
- Add `aoc-mgz` to `[project] dependencies` in `pyproject.toml`.
- **No `anthropic`/API-key dependency** — the coach goes through the existing klaude
  subprocess, which owns its own (free OpenRouter) model config.

### Env vars (`.env` + `.env.example`)
- `AOE2_IGN` — default `nom` (so `is_me` / relic lookup is configurable).
- klaude paths reuse the existing `tasks.py` constants (`KLAUDE_BIN`,
  `WORKSPACE_BASE`, `TRACES_BASE`). **No new LLM key in the website `.env`** — klaude's
  OpenRouter config lives with the klaude user, not the website deploy env.

## Frontend

`frontend/src/app/plays/PlaysClient.tsx` — add `"empires"` to the `Tab` union and a
third tab button (public, always visible). Render `<Aoe2Tab />`.

`frontend/src/components/Aoe2Tab.tsx` (new):
- **Stats header** — current ELO, rank, W/L, games analyzed (`GET /api/aoe2/stats/`).
- **Match list = single-selection accordion.** Each game is a collapsed summary row
  (date, civ vs civ, map, result, ELO Δ, opening tag). Clicking a row selects it and
  expands its detail in place; selecting another collapses the previous one. **Only
  one game is expanded at a time, and the video clip embed is mounted ONLY for the
  currently selected game** — collapsed rows never mount an iframe, so the page
  loads light regardless of how many games exist. Detail content: timeline (vertical
  age-up/build ladder), metric readouts with estimate badges, coach write-up, and the
  single clip embed (lazy `<iframe>`, only when this row is the selected one).
- Default selection on load: the `featured` game if set, else the newest game.
- **Admin-only** (reuse the existing `isAdmin` check in `PlaysClient`): drag-drop
  rec upload box (POSTs to `/api/aoe2/upload/`) + clip-attach form + feature toggle
  on the currently selected game.

Pure helpers (clip URL → embed URL, duration formatting, opening-tag colors) go in
`frontend/src/lib/aoe2.ts` with vitest tests in `lib/__tests__/`.

## The watcher (`scripts/aoe2_watcher.py`)

Standalone Python script the owner runs on their PC (Windows scheduled task or
startup). Behaviour:
- Watch the DE recorded-games folder (`REC_DIR`) for new `.aoe2record` files.
- Wait until a file stops growing (write complete) before uploading.
- Log in once with `ADMIN_SECRET` → token; POST each new rec to
  `SERVER_URL/api/aoe2/upload/` with the bearer token; skip on 200/409 dup.
- Config via env: `SERVER_URL`, `ADMIN_SECRET`, `REC_DIR`. Keeps a local set of
  already-uploaded hashes to avoid re-posting.
- Has a vitest-equivalent pytest (`scripts/` is in `testpaths`) for the pure bits
  (file-stable detection, hash dedup) — no network in tests.

## Build order (phased, single spec)

1. **Ingestion + extraction + display** — models, `upload`, `analyze_match` stages
   1–3, public list/detail/stats endpoints, `Aoe2Tab` (no coach, no clips). Proves
   rec parsing + metrics are correct on real games.
2. **klaude coach** — `run_klaude` refactor, stage 4 workspace + coaching prompt,
   salient.log/metrics.json hand-off, ATIF result parsing.
3. **Relic enrichment + clips + featured** — `enrich_ladder` beat task, clip/feature
   endpoints + admin UI, featured hero.

## Testing
- Backend: `website/tests/test_aoe2.py` — upload dedup, endpoint auth, metric
  extraction on a checked-in sample rec fixture, `run_klaude` subprocess mocked.
- Watcher: `scripts/test_aoe2_watcher.py` — file-stable detection + hash dedup.
- Frontend: `lib/__tests__/aoe2.test.ts` — clip-URL parsing, formatting.
- Manual: visually verify the tab with `pnpm dev` + Playwright screenshots.

## Docs (required by project conventions)
- Update `docs/README.md` with the Empires tab description.
- Add QA items to `docs/QA-CHECKLIST.md` for the tab + upload + analysis.

## Risks
- **mgz version fragility** — store raw rec; `reanalyze` endpoint to re-run.
- **Estimates vs. truth** — idle-TC, floats, vill counts are input-cadence
  estimates; UI badges them as such.
- **relic-link indexing lag / unofficial API** — enrichment is best-effort and
  retried by the beat task; the tab works without it.
- **Coach quality** — free OpenRouter model via klaude; fine for log-reading, but
  narratives may be uneven. Degrades gracefully (metrics still shown). The coaching
  prompt carries the benchmark knowledge so the model mostly reports, not reasons.
- **klaude queue contention** — the coach shares the klaude/Celery queue with
  `/slops`; once-per-game and async, so acceptable. Reuses one `run_klaude` helper.
- **Security** — upload is admin-only; no LLM key in the website env (klaude owns it).
```
