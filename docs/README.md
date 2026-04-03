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
A curated "taste map" of YouTube channels and standout videos. Channels are organized into three tiers — "never miss", "regular rotation", and "worth checking out" — displayed as a glow grid where visual intensity reflects how much Nam cares about each channel. Click a channel to see pinned standout videos. Content is synced from YouTube subscriptions and liked videos, then hand-curated by the admin (hidden by default, promoted to tiers manually).

### Bets
Mini Bloomberg — tracks stocks (VWCE), gold, Bitcoin, EU bond yields with daily price snapshots, sparkline charts, and expandable detail views. Admin can add/remove tickers and trigger manual price syncs.

## Feedback

Visitors can submit anonymous feedback via the floating button on any page. Feedback is rate-limited to 1 message per hour per IP.

## Tech

Built with Django (backend API) and Next.js (frontend), deployed to a Hetzner VPS with Caddy as the reverse proxy. See [CLAUDE.md](/CLAUDE.md) for the full technical stack.
