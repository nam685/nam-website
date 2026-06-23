# nam685.de

A personal website and digital garden by Nam.

## What is this?

**nam685.de** is a personal website that serves as a creative hub — part portfolio, part journal, part playground. It's where Nam shares thoughts, images, code projects, music listening history, reading lists, and more.

## Sections

### Home
The landing page is a constellation: each section is a glowing dot orbiting a center, with a pill tooltip on hover. Moving the mouse sweeps an ambient background glow through the dots' rainbow of hues. At the center sits a circular profile photo of Nam — one of a small rotating set, chosen at random on each visit — whose rim and outer edge are tinted live with the same hue the cursor is pointing toward, so the portrait picks up the color of whichever section you're drifting toward.

### Yaps
A unified public feed of short-form thoughts, images, and short videos, displayed as a single-column timeline. Each post can carry text plus an optional single image **or** a single video (not both). Images are centered in the feed — large images fill the column width, small images render at natural size. Clicking an image opens a full-screen lightbox with left/right navigation between image posts and Esc to close. Videos play inline in the feed with native controls. New posts are composed inline with drag-and-drop / paste / click attachment (images or videos); video is compressed before upload (capped at 50 MB). Text drafts survive a login redirect and are restored on return. An 18-hour cooldown is enforced between posts. The `/draws` and `/thinks` URLs redirect here.

### Codes
A showcase of software projects with links to GitHub repos and live demos. Includes a live GitHub contribution graph pulled via the GitHub API.

### Grinds
A visual timeline of professional experience, education, and side projects. Each entry is tagged and linked to relevant organizations.

### Listens
A public, interactive **graph** of Nam's music, built from YouTube Music history. Tracks, artists, and albums are nodes; edges are listening affinity — collaborative-filtering similarity from Last.fm (`artist.getSimilar`/`track.getSimilar`, kept only between things already in the library) layered with Nam's own co-listen habits, plus thin structural links binding a track to its artist and album. The graph is tailored to Nam's library: liked songs, saved albums, and subscribed artists (pulled from YouTube Music) raise a node's recommendation score. Each visit reveals a **patch** — a seed node and its neighborhood — chosen with likelihood proportional to that score; the "↻ New Patch" button surfaces a fresh region. A search box jumps to any artist/track/album, and clicking a node re-centers the graph to walk outward. Node size reflects play count; liked nodes show a yellow ring and subscribed artists a dashed ring. Admin users can sync new data, import Google Takeout history, and play tracks (and artist/album top tracks) via the embedded mini music player that persists site-wide with queue management, shuffle, and repeat controls. The player supports an endless **radio** mode (∞ toggle): when enabled, it keeps the queue full by auto-playing tracks related to the current song, drawn from the listening graph.

### Reads
A curated reading list (coming soon).

### Audiobook player (admin-only)

For books with a generated audiobook, an admin-visible "LISTEN" button on the
read card opens `/reads/<slug>/listen` — a chapter-aware HTML5 audio player that
plays Gemini-narrated chunks of the book. The player persists position in
localStorage and minimizes to a floating pill on navigation. Audio files are
gated behind admin auth via short-lived signed URLs.

### Plays — Chess & AoE 2
The plays page has two top-level, game-namespaced sections reflected in the URL path: **Chess** (`/plays/chess`) and **AoE 2** (`/plays/aoe2`). The bare `/plays` redirects to `/plays/chess`, and the full-width selector at the top switches between them. (Old deep links keep working — see below.)

**Chess tab** contains the chess opening explorer powered by live data from the Lichess Opening Explorer API. Users can navigate opening lines and see move statistics (game count, win/draw/loss percentages) from both the Masters database and all rated Lichess games. Toggle between databases and filter by rating bracket. Admin users can connect their Lichess account via OAuth to play live games directly from the page using the Lichess Board API. Game modes include challenging a specific player, creating an open challenge link, or seeking a random opponent.

**AoE 2 section** (`/plays/aoe2`) showcases the owner's Age of Empires II: Definitive Edition 1v1 games. A stats header shows the current ELO, win/loss record, total games played, and top civilization. Below it the section uses a **full-width two-pane layout**: a selectable game list on the left (map, matchup, opening, result, rating change) and a tabbed detail pane on the right for the selected game. The detail pane has five tabs, each sized to fit without scrolling on desktop; switching tabs never re-fetches data. The default tab is **Coach**.

- **Coach** (default) — the headline at-a-glance view: the agentic Claude coach's verdict rendered as Markdown (agent scaffolding stripped), the strategic-map minimap, the top build-order guess, and basic stats (civs, result, ELO, Feudal/Castle/Imperial times, duration, APM).
- **Economy** — two distinct, never-conflated blocks: **worker allocation** (villager *counts* per resource, per age) and **resource balance** (resource *amounts* spent, per resource, plus qualitative "⚠ floating" flags). Both are badged `~est`; collected/bank totals and relic gold are shown as "unavailable" (never fabricated).
- **Army & Stats** — the build-order classification (matched/missed signals) at the **top**, then **one unified full-width production graph**: above the x-axis a stacked-area of villagers + army units by type (cumulative *produced* — queued upper bounds, never live counts) with a vertical legend on the right (swatch + icon + name + total); m:ss time labels in their own band below the axis; and below zero an **event icon row** plotting both unit production and upgrades/techs (eco/military/university) over time as their real icons. Feudal/Castle/Imperial age-up guide-lines span the chart. An efficiency panel rounds it out: TC idle as a pre-cap % ("idle before 200 pop, age-ups excluded"), longest villager gap, and a clear APM split ("APM N — X eco · Y military · Z other", captioned "commands per minute, by what they controlled").
- **Technology** — the event timeline (age arrivals, eco/military/university tech, production milestones) drawn with **real AoE2 DE icons** (bundled locally, same-origin; named by aoe2techtree *picture_index*), plus per-tech timing columns. Every unit/building/tech/age name in the coach's vocabulary resolves to a bundled icon (100% coverage, verified by a test); a genuinely-unknown name (e.g. a brand-new unit not yet in the coach data) falls back to a "?" chip rather than a broken image.
- **Mistakes** — the deterministic mistakes list (each with severity, confidence tier, fix, and a "learn more" deep-link).

The minimap (you = blue, opponent = red) is drawn from exact building coordinates (base centroids, walls, forward buildings ringed, engagement markers sized by aggressive-command volume — placements, not what survived). Every panel is honest about data provenance (exact = solid; estimate = `~est` badge; engine-only = "unavailable"). Matches analyzed before the v2 upgrade degrade gracefully (empty reconstruction → coach text + basics only). Chat and player names are stripped during parsing for privacy; the opponent is identified by civilization only. A share link is available via the ⋮ menu (`/plays/aoe2?game=<id>`); the legacy `/plays?game=<id>` form still works and redirects to the namespaced URL with that game selected. Games are ingested automatically: a local watcher (`scripts/aoe2_watcher.py`) detects new `.aoe2record` files and uploads them to the admin-only `/api/aoe2/upload/` endpoint; non-1v1, vs-AI, and single-player recordings are skipped and not shown.

#### Build-order library (`/plays/aoe2/builds`)
A public, shareable reference library of eleven Age of Empires II build orders adapted from Hera's strategy guide, served from the `aoe2coach` package data (no auth). The **index** (`/plays/aoe2/builds`) groups the builds by family (Scouts, Archers, Men-at-Arms, Drush, Knights, Fast Castle, Drush → Fast Castle, Trash); each is a card with its name and one-line summary. Each **learn page** (`/plays/aoe2/builds/<id>`) shows the build's recommended civs, summary, and source (Hera guide + page), a **phase-laned timeline graphic** (Dark Age → Feudal → Castle → Imperial, with the Feudal/Castle/Imperial age targets labelled) where each step's building/unit/tech is rendered with the real bundled AoE2 DE icon (mapped from the step's task text; monogram glyph fallback for unmapped), the ordered step list (phase, villager count, task), and the "what's next" transitions. The Coach tab's top build-order guess links straight into the matching learn page, so "you played archers → learn the build" is one click.

### Watches
A curated YouTube taste showcase with a two-column layout: a sticky hero video player on the left and a randomized channel grid on the right. Channels are differentiated by visual weight (glow, border) based on their tier — "never miss", "regular rotation", or "worth checking out". Clicking a channel card expands an inline block showing the channel avatar, description, pinned standout videos, and a link to YouTube. Clicking a pinned video loads it in the hero player. Content is synced from YouTube subscriptions and liked videos, then hand-curated by the admin (hidden by default, promoted to tiers manually). Admin features include tier management, YouTube sync, and stats backfill.

### Bets
Mini Bloomberg — tracks stocks (VWCE), gold, Bitcoin, EU bond yields with daily price snapshots, sparkline charts, and expandable detail views. Admin can add/remove tickers and trigger manual price syncs.

**Backtester:** the bets page now includes an interactive backtest sandbox. Visitors pick an asset, a strategy (Buy & Hold, Moving-Average Crossover, Dollar-Cost Averaging, MACD, Bollinger Bands, RSI, Time-Series Momentum), and parameters, then see an equity curve and performance metrics scored against a buy-and-hold benchmark. No real trades are made — it replays historical prices only.

**Paper trading:** the site owner can start "pretend money" runs from `/sudo` — a strategy + asset + starting cash. A daily job (piggybacked on the price sync) advances each active run, recording simulated trades. The public bets page shows each run's live equity curve, current position, and performance. No real money is ever involved.

### Slops

Agent showcase page for klaude, a DIY Claude Code harness powered by open-source LLMs. Visitors submit prompts which go into a pending queue. The admin approves turns, and klaude executes them in a sandboxed environment. Sessions support multi-turn conversations via klaude's `-c` resume feature. Full agent traces (tool calls, reasoning, file changes) are recorded and displayed publicly.

- Three-panel layout mirroring claude.ai (session sidebar, trace viewer, prompt box)
- Multi-turn sessions: submit follow-up prompts to continue existing sessions
- File attachments: visitors may attach text/PDF/image/Office files (≤5 MB each, ≤10 MB per turn)
- Admin: approve/reject pending turns, view live traces, preview text attachments
- Rate limiting: 1 submission/hr per IP + 10/hr global cap
- File downloads: klaude can share files with the user by writing to a per-turn `downloads/` directory; files appear as clickable chips below its message (5 files max, 5 MB each, 10 MB total per turn)
- Security: separate Linux user, scoped GitHub access, network restrictions

## Feedback

Visitors can submit anonymous feedback via the floating button on any page. Feedback is rate-limited to 1 message per hour per IP.

## Tech

Built with Django (backend API) and Next.js (frontend), deployed to a Hetzner VPS with Caddy as the reverse proxy. See [CLAUDE.md](/CLAUDE.md) for the full technical stack.
