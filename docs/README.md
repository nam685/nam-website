# nam685.de

A personal website and digital garden by Nam.

## What is this?

**nam685.de** is a personal website that serves as a creative hub — part portfolio, part journal, part playground. It's where Nam shares thoughts, drawings, code projects, music listening history, reading lists, and more.

## Sections

### Thinks
A public micro-journal. Short-form thoughts posted with an 18-hour cooldown between entries. No edits, no deletes — raw, unfiltered thinking.

### Draws
A gallery of hand-drawn sketches (pencil) and photographs (camera). Images are uploaded and organized by category with captions.

### Codes
A showcase of software projects with links to GitHub repos and live demos. Includes a live GitHub contribution graph pulled via the GitHub API.

### Grinds
A visual timeline of professional experience, education, and side projects. Each entry is tagged and linked to relevant organizations.

### Listens
A public music listening dashboard that syncs with YouTube Music. Features a magazine-style layout with a hero panel showing a recommended rediscovery track, top tracks this month, listening stats, and a 30-day activity sparkline. Four sub-pages: chronological history feed, top tracks ranked by play count, top artists with collab-aware crediting, and top albums (2+ tracks). Admin users can sync new data, import Google Takeout history, and play tracks via an embedded mini music player that persists site-wide with queue management, shuffle, and repeat controls.

### Reads
A curated reading list (coming soon).

### Plays — Chess Explorer & Live Games
The plays page features a chess opening explorer powered by live data from the Lichess Opening Explorer API. Users can navigate opening lines and see move statistics (game count, win/draw/loss percentages) from both the Masters database and all rated Lichess games. Toggle between databases and filter by rating bracket.

Admin users can connect their Lichess account via OAuth to play live games directly from the page using the Lichess Board API. Game modes include challenging a specific player, creating an open challenge link, or seeking a random opponent.

### Watches
A curated YouTube taste showcase with a two-column layout: a sticky hero video player on the left and a randomized channel grid on the right. Channels are differentiated by visual weight (glow, border) based on their tier — "never miss", "regular rotation", or "worth checking out". Clicking a channel card expands an inline block showing the channel avatar, description, pinned standout videos, and a link to YouTube. Clicking a pinned video loads it in the hero player. Content is synced from YouTube subscriptions and liked videos, then hand-curated by the admin (hidden by default, promoted to tiers manually). Admin features include tier management, YouTube sync, and stats backfill.

### Bets
Mini Bloomberg — tracks stocks (VWCE), gold, Bitcoin, EU bond yields with daily price snapshots, sparkline charts, and expandable detail views. Admin can add/remove tickers and trigger manual price syncs.

### Slops

Agent showcase page for klaude, a DIY Claude Code harness powered by open-source LLMs. Visitors submit prompts which go into a pending queue. The admin approves turns, and klaude executes them in a sandboxed environment. Sessions support multi-turn conversations via klaude's `-c` resume feature. Full agent traces (tool calls, reasoning, file changes) are recorded and displayed publicly.

- Three-panel layout mirroring claude.ai (session sidebar, trace viewer, prompt box)
- Multi-turn sessions: submit follow-up prompts to continue existing sessions
- Admin: approve/reject pending turns, view live traces
- Rate limiting: 1 submission/hr per IP + 10/hr global cap
- File downloads: klaude can share files with the user by writing to a per-turn `downloads/` directory; files appear as clickable chips below its message (5 files max, 5 MB each, 10 MB total per turn)
- Security: separate Linux user, scoped GitHub access, network restrictions

## Feedback

Visitors can submit anonymous feedback via the floating button on any page. Feedback is rate-limited to 1 message per hour per IP.

## Tech

Built with Django (backend API) and Next.js (frontend), deployed to a Hetzner VPS with Caddy as the reverse proxy. See [CLAUDE.md](/CLAUDE.md) for the full technical stack.
