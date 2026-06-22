# Handoff → Implementation Coordinator

**From:** architect/planner. **Date:** 2026-06-23. **Status:** specs complete & coherence-audited; ready to implement.

## Your job (and what NOT to do)
You are the **coordinator**. Review these specs, then **allocate sub-projects to implementation agents who code directly from the spec**. **Do NOT write an intermediate implementation plan** — the specs are the plan, already at task granularity with module names, function signatures, data shapes, and TDD test sketches. A separate impl-plan would just restate the code we're about to write = wasted tokens. Allocate spec → impl agent → code, TDD, green, commit, merge.

## The thesis (keep every agent pointed at this)
**Coach quality is bounded by preprocessing — heavy preprocessing in → good coaching out; garbage in, garbage out.** The coach (#4) is an *explainer/investigator* over a rich preprocessed bundle, not an analyzer of raw logs. Every sub-project except #4/#5 exists to make that bundle richer and *honest*. **Honesty rule (program-wide):** never fabricate; label every datum `exact` / `estimate` / `unavailable` (glossary in #1). Counts from queue commands are `produced` (upper bound), never presented as live.

## Where everything is
- **Specs (this branch `docs/aoe2-coach-specs`):** `docs/superpowers/specs/2026-06-22-aoe2-*.md` — overview + 7 sub-projects. **#1 reconstruction-core is the ANCHOR contract** every other consumes; read it first.
- **Code target:** the standalone **`aoe2coach`** package at `~/projects/aoe2coach` (branch `feat/reconstruction-core` exists, empty — reuse or branch fresh per sub-project). Pure functions over `ops: list[(clock_ms, Action, data)]`; no Django/DB/network in the package.
- **nam-website** (`~/projects/nam-website`) only: bumps the `aoe2coach` git pin (#4 wiring) + adds persistence/frontend (#4/#5). Worktree mandate applies — branch from `origin/main`.
- **Calibration data (`~/projects/aoe2coach-analysis/`):** `game.aoe2record` (game1, Vietnamese nom), `game2.aoe2record` (game2, Burgundians nom), `calibration.md` (4 resource-collected ground-truth points + age/vil/army truth), raw/denoised log dumps, `BUILD_PROGRESS.md`, program overview.

## Build order + dependency graph
```
#1 Reconstruction core  ──► everything pins it
   ├─► #7 Strategic map (geometry+render; consumes spatial+engagements; ships WITH #4)
   ├─► #6 Mistake detectors + KB (detectors over Reconstruction)
   ├─► #3 Build-order library + classifier (signals from Reconstruction)
   │      └─► #4 Coach v2 (consumes EVERY producer: #1 facts + #2 economy(opt) + #3 candidates
   │                        + #6 flagged + #7 map PNG)  ◄── the headline. Map(#7) & economy(#2)
   │                        are coach INPUT, not side-car features — that's the whole thesis.
   ├─► #2 Economy model (thin; consumes #1; needs gaia objects from #1's parser)
   └─► #5 Frontend viz (consumes #1 + #2 + #7 geometry; the deferred "last" one)
```
**Sequencing:** #1 must land in `aoe2coach` first (push → others develop against it). #3/#6/#7 are independent of each other → **parallelizable** once #1 is merged. #4 needs #3/#6/#7 outputs. #2 is independent (can run parallel to #3/#6/#7). #5 last.
**Pin loop:** each aoe2coach change → push → in nam-website bump the `aoe2coach @<rev>` pin (`uv lock --upgrade-package aoe2coach`) before its consumer runs there.

## Operating parameters (Nam authorized — critical)
- **Full autonomy incl. commit/push/PR/merge to main of BOTH repos.** `gh` is wired as git credential helper (push works). aoe2coach has **no CI/deploy** → merge freely. **nam-website merge→main AUTO-DEPLOYS to live nam685.de** (CI `workflow_run`→Deploy) → **never merge red CI; verify the live site after each nam-website deploy; batch nam-website deploys.**
- **`claude -p` works + authed LOCALLY** (`/home/namle685/.local/bin/claude` v2.1.186) — use it for #4 dev. Also on Hetzner via `ssh hetzner 'bash -lc "claude -p ..."'` (login shell; non-login PATH lacks it). **Mock claude in all unit tests; keep real coach runs to a handful** (shared with Nam's Max subscription).
- **Game version:** calibration recs are **save 68.0** (no `WORK` ops; gather signal = sparse `GATHER_POINT`/`ORDER` — this is why #2 is "thin"). Verify parser fidelity across save 64.3 vs 68.0 before #2.
- **Conventions:** ME=blue/OPP=red (maps/viz); per-TC gather points (#2); engagement-triggered maps (#7); produced-not-live labeling.

## Definition of done (per sub-project)
- aoe2coach: new pure modules + synthetic-ops tests (faithful to `mgz.fast.parse_action` shapes) + fidelity tests for newly-consumed actions; `uv run pytest -q` green; `uvx ruff check . && uvx ruff format .` clean; real-rec sanity on `game.aoe2record`/`game2.aoe2record`; commit + merge to aoe2coach main.
- nam-website: bump pin; `uv run pytest website/tests/test_aoe2.py` green (docker DB up); frontend via vitest + Playwright screenshot; PR → CI green → merge (auto-deploys) → verify site.
- Update `aoe2coach-analysis/BUILD_PROGRESS.md` as each sub-project completes.

## Already resolved (don't re-litigate)
- Feasibility verified: replay = command log (no resources/pop/kills); no postgame achievements; age timeline exact; #2 is honest-thin by Nam's decision. Specs passed a cross-document coherence audit (BLOCKING items fixed: #4 now ingests #6+#7, candidate/file contracts aligned to #3, #1 emits `spatial.opp.base_centroid` + pinned `zone` enum).

## Residual risks / watch-items (handle, don't block)
- **Auto-deploy is the only dangerous lever** — gate nam-website merges on green CI + post-deploy site check.
- **#2 may not validate** — if the collected estimate misses the band on `game.aoe2record`, it must self-suppress (per #2 spec) and ship qualitative-only; that's success, not failure.
- **#4 multimodal map read** — verify the installed `claude` actually reads the PNG; if not, degrade gracefully (facts.json still has every coordinate).
- **`first_military_building` name + vils-at-feudal-click** (#3 needs them) and **gaia objects on `ParsedRec`** (#2 needs them) are promised in #1's consumer-requirements — make sure the #1 agent actually emits them.

Specs are committed and unmerged on this branch; merging them to nam-website main will trigger a (harmless, docs-only) deploy — your call per the merge policy above.
