# AoE2 Coach — Preprocessing Vision: Feasibility Map & Design Direction

> Working notes from looking at one real rec (Ethiopians vs Vietnamese, Coastal, 46:05)
> plus Hera's build-order guide, the in-game Statistics screens, and CaptureAge's stat set.
> Goal: "coach = preprocessing + AI", reconstruct the game as richly & honestly as possible.

## 1. The hard constraint: a replay is a COMMAND LOG, not a STATE LOG

An `.aoe2record` stores *what each player clicked*, tick by tick. It does **not** store game
state (resources, population, who's alive). Op breakdown for the sample game:

| Op | Count | Meaning |
|----|------:|---------|
| ACTION | 214,102 | the command stream (what we mine) |
| SYNC / VIEWLOCK | 133k each | timing + camera (skipped) |
| CHAT | 58 | stripped (privacy) |
| **POSTGAME** | **1** | only `leaderboards` (opp rating **861**) + `world_time`. **No achievements.** |

**Confirmed:** `mgz.summary.get_postgame()` → **False**. DE MP replays do NOT embed the
end-game Statistics (resources collected, units killed, % explored). Those screens are
recomputed by the engine at playback. CaptureAge gets them by replaying through the real
engine — **we cannot, statically.** So there is no free "ground-truth totals" to anchor to.

## 2. What IS recoverable, in tiers

**Tier A — exact (deterministic from commands):**
- Building map over time — every `BUILD` has `(type, x, y, t)` → rebuild both bases, walls,
  forward/proxy buildings, expansion timing. (635 BUILDs in the sample.)
- Age-up timeline, full tech/upgrade timeline (`RESEARCH`, 64 ops).
- Production commands — what units queued, type, count, when (`DE_QUEUE`/`MAKE`, ~780 ops).
- Villager production cadence → TC idle / production gaps.
- Market trades (`BUY`/`SELL`/`TRIBUTE`), resign / game end.

**Tier B — estimable with a model (flag as estimates):**
- **Population / villager / army-composition curves** = *cumulative queued* over time. Exact for
  "what was produced," but cannot subtract **combat deaths** (never logged; only self-`DELETE`s,
  179 in sample). So it's a "produced" curve, an upper bound on live counts.
- **Economy allocation** (vils per resource) — `WORK` is the firehose (131,107 ops!). Each `WORK`
  tasks a unit onto a target object. Resolving target → resource (via header gaia: sheep/boar/
  gold/stone/berries + player buildings mill/camp) gives "N vils on wood/food/gold/stone" over
  time. Sparse (players don't re-click every vil) → drift, but real signal.
- **Resources collected** — integrate (vils-per-resource × gather-rate, adjusted for Wheelbarrow/
  Hand Cart/Double-Bit Axe/Bow Saw/mining upgrades). An ESTIMATE; **no postgame total to
  calibrate against**, so error compounds late-game. Honest as a trend, not a number.

**Tier C — NOT recoverable statically:**
- True resource stockpiles, true gather rates, live army size with deaths. Would need full
  engine simulation (no open-source DE sim). Out of scope.

## 3. The stat vocabulary (from your screenshots + CaptureAge + community)

- In-game Statistics tabs: **Military** (units killed/lost, buildings razed/lost, converted,
  largest army), **Economy** (food/wood/stone/gold collected, trade profit, tribute),
  **Technology** (age times, % map explored, research count), **Society**, **Score**, **Timeline**
  (population-% over time with age/battle/wonder markers).
- CaptureAge advanced: **K/D**, **ECO K/D**, **RES COLL**, **Vil/Mil counts**, **IDL TC / IDL VIL**,
  **WRK EFF** (worker time gathering÷lifetime), **MV/BLD/GTH ECO**, **Eco/Mil/total geAPM**
  (effective APM split eco vs mil — actions that actually task units, not screen scrolls).

Of these: age times, research count, largest *produced* army, idle TC/vil, eco/mil APM split,
build map → **Tier A/B (we can do)**. Units killed/lost, true RES COLL, % explored, conversions
→ **need the engine (we can't, exactly)** — approximate or omit.

## 4. The other fix you asked for: stop the coach guessing the build order

Today Sonnet eyeballs the log, guesses the opening, then judges timing against a benchmark it
half-remembers → wrong build + bogus timing. Hera's guide is the fix: ~25 named build orders,
each a villager-by-villager table with **explicit age targets** ("perfect Feudal landing 8:50")
and per-age eco splits.

**Progressive disclosure, NOT prompt-flooding (Nam's call).** Do not dump 25 builds into the
prompt. Instead:
1. Encode each Hera build as a structured **reference file** (sequence + age targets + eco split),
   one file per build — a retrievable library, plus pointers to the aoe2 wiki / techtree.
2. Preprocessing **pre-narrows** to 1–3 candidate builds from the reconstructed early game (vil
   tasks, first buildings/military, age timing) — cheap, deterministic, shrinks the search.
3. The coach (it's `claude -p`, a real agent with file/grep/web tools) forms a hypothesis
   ("this looks like Fast Castle into Knights") and **fact-checks on demand**: reads that build's
   reference file, looks up unit/tech specifics on the wiki. Judges actual-vs-*verified* targets.

No invented benchmarks; the coach cites the reference it actually read.

## 5. Proposed architecture: coach = preprocessing pipeline + AI

```
.aoe2record
  → parse (mgz.fast)                      [exists]
  → RECONSTRUCT (new, the heavy layer):
       • spatial: building map / forward / walls          (Tier A)
       • timeline: ages, techs, production, milestones     (Tier A)
       • eco model: vils-per-resource + collected estimate (Tier B)
       • state curves: pop/vil/army produced over time     (Tier B)
       • efficiency: TC/vil idle, eco/mil APM split         (Tier A/B)
  → PRE-NARROW build order to 1-3 candidates  (new, deterministic)
  → FACTS block (structured, honest, estimate-flagged)  (new)
  → COACH v2 (agentic): restate facts → hypothesize build → fact-check
       the candidate's reference file + wiki on demand → judge vs verified targets
```

The AI stops being the analyst and becomes the *explainer + investigator*: preprocessing hands it
honest, structured facts + 1-3 candidate builds; it confirms the build by reading the specific
reference (progressive disclosure), then narrates and advises against verified targets.

**The thesis, stated plainly:** the coach's quality is *bounded by preprocessing* — heavy
preprocessing in → good coaching out; garbage in → garbage out. The coach consumes the **full
preprocessed bundle** (reconstruction facts, build candidates, flagged mistakes, the strategic map)
and is an explainer/investigator over it, **never** an analyzer of raw logs. Every dollar of
quality is earned in the preprocessing layers, not in the prompt.

**Calibration (Nam will provide):** since end-game totals aren't in the file, Nam screenshots a
game's end-game Statistics; we check the estimator's resource/idle/army numbers against those
real totals ("estimated wood 14,200 vs actual 13,980 → good enough"). A handful of these become a
validation set so the Tier-B estimates earn trust before the coach is allowed to cite them.

## 6. This is a program, not one plan — proposed sub-projects

1. **Reconstruction core** — spatial + timeline + state curves (Tier A + produced curves).
2. **Economy model** — WORK/GATHER_POINT/ORDER→resource assignment + gather-rate integration (Tier B, flagged).
3. **Hera template library + deterministic build classifier.**
4. **Coach v2** — facts block + restate-before-judge + template-aware benchmarking.
5. *(deferred — "maybe later")* **Frontend viz** — CaptureAge-style charts on the website.
6. **Coaching knowledge base + mistake detectors** — deterministic rubric + linter-style mistake
   flagging the coach explains (ships WITH #4).
7. **Strategic map rendering** — annotated server-side PNG of the reconstruction the coach can SEE
   (ships WITH #4; #5 reuses its geometry).

Each gets its own spec → plan → implementation. The existing `2026-06-22-aoe2coach-phase2-enrich`
plan (tech upgrades, milestones, idle, forward buildings, facts block, coach v2) is essentially a
subset of #1 + #4 and can be absorbed.

## Specs (all in nam-website `docs/superpowers/specs/`, breadth-first, 2026-06-22)
1. Reconstruction core — `2026-06-22-aoe2-reconstruction-core-design.md`  ← anchor contract
2. Economy model — `2026-06-22-aoe2-economy-model-design.md`  ⚠️ feasibility-constrained on save 68.0
3. Build-order library + classifier — `2026-06-22-aoe2-buildorder-classifier-design.md`
4. Coach v2 (agentic) — `2026-06-22-aoe2-coach-v2-design.md`
5. Frontend viz — `2026-06-22-aoe2-frontend-viz-design.md`  ← the **deferred** one ("maybe later")
6. Coaching knowledge base + mistake detectors — `2026-06-22-aoe2-coaching-knowledge-base-design.md`  (ships WITH #4)
7. Strategic map rendering — `2026-06-22-aoe2-strategic-map-rendering-design.md`  (ships WITH #4)

## Resolved (Nam's calls)
- **Build knowledge = progressive disclosure**, not prompt-flooding. Reference library + agentic
  fact-check. (§4)
- **Tier-B validation = Nam-screenshotted end-game stats** as a calibration/test set. (§5)

## Open questions for Nam
- Which sub-project to spec first? (Recommend #1 reconstruction core — everything builds on it.)
- Is website visualization (#5) in scope for this round, or coach-quality only for now?
- Build-classifier division of labor: how much should preprocessing pre-narrow vs. leave to the
  agent's hypothesize-and-verify loop?
