# nam685.de

A personal website and digital garden by Nam.

## What is this?

**nam685.de** is a personal website that serves as a creative hub — part portfolio, part journal, part playground. It's where Nam shares thoughts, images, code projects, music listening history, reading lists, and more.

## Sections

### Home
The landing page is a constellation: each section is a glowing dot orbiting a center, with a pill tooltip on hover. Moving the mouse sweeps an ambient background glow through the dots' rainbow of hues. At the center sits a circular profile photo of Nam — one of a small rotating set, chosen at random on each visit — whose rim and outer edge are tinted live with the same hue the cursor is pointing toward, so the portrait picks up the color of whichever section you're drifting toward.

### Thinks
A unified public feed of short-form thoughts, images, and short videos, displayed as a single-column timeline. Each post can carry text plus an optional single image **or** a single video (not both). Images are centered in the feed — large images fill the column width, small images render at natural size. Clicking an image opens a full-screen lightbox with left/right navigation between image posts and Esc to close. Videos play inline in the feed with native controls. New posts are composed inline with drag-and-drop / paste / click attachment (images or videos); video is compressed before upload (capped at 50 MB). Text drafts survive a login redirect and are restored on return. An 18-hour cooldown is enforced between posts. The `/draws` URL redirects here.

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

### Plays — Chess Explorer & Live Games
The plays page features a chess opening explorer powered by live data from the Lichess Opening Explorer API. Users can navigate opening lines and see move statistics (game count, win/draw/loss percentages) from both the Masters database and all rated Lichess games. Toggle between databases and filter by rating bracket.

Admin users can connect their Lichess account via OAuth to play live games directly from the page using the Lichess Board API. Game modes include challenging a specific player, creating an open challenge link, or seeking a random opponent.

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
