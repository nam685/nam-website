# QA Checklist

Manual testing checklist for quality audits. Run through this when reviewing the site or after major changes.

**Important:** When adding a new page or feature, add corresponding QA items to this checklist.

---

## Global

- [ ] All pages load without console errors
- [ ] Accent color matches each page (no flash of wrong color on first load)
- [ ] Nav wheel spins smoothly on desktop and mobile
- [ ] Mobile nav opens/closes correctly
- [ ] Page background images load (no broken images or grey backgrounds)
- [ ] Feedback button appears on all public pages
- [ ] Feedback submission works (rate limit: 1/hr/IP)
- [ ] Site works over HTTPS (Caddy auto-TLS)
- [ ] `/api/health/` returns 200

## Home

- [ ] Landing orbit renders: center profile photo + section dots, no console errors (no hydration warning)
- [ ] Profile photo is circular, served from `/media/profile/profile-N.webp`, and varies between reloads (random per load)
- [ ] Photo rim + edge tint track the mouse, matching the ambient glow hue (e.g. red near `yaps`, cyan near `plays`)
- [ ] Photo sized ~75% of the center→dot distance; layout holds on mobile (orbit goes 85vw)

## Auth (/sudo)

- [ ] Login form appears at `/sudo`
- [ ] Correct secret grants token and redirects to previous page
- [ ] Wrong secret shows error
- [ ] Token persists across page reloads (localStorage)
- [ ] Protected pages redirect to `/sudo` when not logged in
- [ ] Token expires after 7 days

## Yaps

- [ ] Feed loads as a single-column timeline and paginates
- [ ] "Load more" fetches the next page
- [ ] Admin compose card is visible when logged in
- [ ] Admin can submit a text-only post (succeeds)
- [ ] Admin can submit an image-only post (succeeds)
- [ ] Admin can submit a post with both text and image (succeeds)
- [ ] Admin can submit a video-only post (succeeds) and it plays inline with controls
- [ ] Admin can submit a post with text + video (succeeds)
- [ ] Submitting both an image and a video together is rejected
- [ ] Oversized video (>50 MB) or non-mp4/webm file is rejected
- [ ] 18-hour cooldown is enforced — rapid reposts are blocked
- [ ] Content length limit (2000 chars) is enforced
- [ ] Image/video attach works via click-to-browse (and image via drag-and-drop / paste)
- [ ] Large image fills the column width; small image renders at natural size (not stretched)
- [ ] Clicking an image opens the full-screen lightbox
- [ ] Lightbox: ← / → navigate only between image posts (text-only posts skipped)
- [ ] Lightbox: Esc closes the lightbox
- [ ] Lightbox: admin delete button removes the post and closes the lightbox
- [ ] Typed text in the compose box survives a redirect to `/sudo` to log in and is restored on return
- [ ] Visiting `/draws` and `/thinks` 301-redirect to `/yaps`

## Codes

- [ ] Project cards render with tags and links
- [ ] GitHub contribution graph loads (green squares)
- [ ] "Refresh" button syncs contributions (admin only)
- [ ] GitHub OAuth flow works end-to-end

## Grinds

- [ ] Timeline renders with alternating left/right cards (desktop)
- [ ] Mobile layout stacks cards vertically
- [ ] Tags display correctly
- [ ] External links work

## Listens

### Public (no auth)
- [ ] `/listens` loads showing an interactive force-directed graph of nodes and edges
- [ ] A stat strip shows total plays + today, plus "walking near · <seed>"
- [ ] "↻ NEW PATCH" loads a different neighborhood (seed changes)
- [ ] Search box returns matches; selecting a result re-seeds the graph to that region
- [ ] Search with an empty query shows no dropdown
- [ ] Clicking a node opens the detail card (thumbnail, title, subtitle/type, play count)
- [ ] "⊙ CENTER" on the card re-centers the graph on that node
- [ ] Node size scales with play count
- [ ] Liked nodes render a yellow ring; subscribed artists render a dashed accent ring
- [ ] Similarity edges are solid accent; structural/co-listen edges are faint/dashed
- [ ] Legend strip renders at the bottom
- [ ] No "▶ PLAY", SYNC, or AUTH controls visible when logged out

### Admin
- [ ] Sync button appears and triggers sync
- [ ] Sync cooldown (5 min) is enforced
- [ ] Google Takeout import works via POST /api/listens/import/
- [ ] Sync also pulls liked tracks (synced_liked count in response)
- [ ] Deduplication works (no duplicate tracks after re-sync)
- [ ] Sync rebuilds the graph (nodes/edges refresh after new tracks land)
- [ ] `python manage.py build_music_graph` rebuilds the graph from the CLI
- [ ] "▶ PLAY" appears on a selected node's card (track plays; artist/album plays its top track)
- [ ] AUTH button toggles re-auth form with textarea for pasting browser headers
- [ ] Re-auth saves headers and validates YTMusic init before writing
- [ ] Daily automated sync runs via Celery Beat (also rebuilds the graph)
- [ ] Clicking play opens the mini player
- [ ] Mini player: play/pause, next/prev, shuffle, repeat, seek
- [ ] Mini player persists when navigating to other pages (/watches, /yaps, etc.)
- [ ] Mini player minimize/close work
- [ ] Listens: the ∞ (radio) toggle in the player turns orange when enabled
- [ ] Listens: with radio on, playing a single track keeps auto-playing related tracks (queue never ends)
- [ ] Listens: with radio off, playback stops at the end of the queue
- [ ] Listens: radio state survives a page reload (persisted in session)
- [ ] `/listens` shuffle button: pressing it repeatedly surfaces visibly different clusters (not the same few hub tracks every time).

### Responsive
- [ ] Mobile: stats bar compact, single-column layouts, player becomes bottom bar
- [ ] Tablet: two-column grids, floating player
- [ ] Desktop: full magazine layout, floating player

## Watches

### Layout
- [ ] Two-column layout renders correctly on desktop (50/50 split, hero sticky)
- [ ] Two-column layout works on tablet (3-col grid)
- [ ] Mobile layout stacks hero on top, 2-col grid below

### Hero player
- [ ] Hero loads recommended video on page load
- [ ] Click recommended video thumbnail → YouTube embed plays
- [ ] Admin: sync button and staging link visible in hero panel

### Channel grid
- [ ] Channel cards show randomized order on page refresh
- [ ] Channel cards respond to hover (border glow, background tint, scale)
- [ ] Click channel card → expanded block appears below row with proper grid reflow
- [ ] Expanded card shows avatar, name, description, pinned videos, YouTube link
- [ ] Click pinned video in expanded card → loads in hero player
- [ ] Clicking expanded channel card again collapses it
- [ ] Mobile: video click scrolls to hero and plays

### Admin
- [ ] Admin: tier selector in expanded card changes tier
- [ ] Admin: "connect youtube" button visible when logged in and not connected
- [ ] Admin: sync rate limiting shows cooldown
- [ ] Admin: staging link navigates to /watches/staging
- [ ] Staging: hidden channels shown with tier promote buttons
- [ ] Staging: hidden videos shown with pin and delete buttons
- [ ] Staging: promoting a channel removes it from staging
- [ ] Staging: pinning a video removes it from staging
- [ ] Staging: requires auth (redirects to /sudo if not logged in)

## Reads

- [ ] Page loads (content may be placeholder/coming soon)

## Feed

- [ ] `/feed.xml` returns valid RSS XML
- [ ] Feed contains thought entries with correct titles and dates

## Plays — Chess tab (Lichess)

- [ ] Explorer tab loads with starting position and Chessground board
- [ ] Making moves on the board fetches explorer data from Lichess
- [ ] Masters/Lichess database toggle works
- [ ] Rating filter buttons appear for Lichess database
- [ ] Move statistics show game count + win/draw/loss bar
- [ ] Reset, Takeback, Flip buttons work
- [ ] Move history displays correctly
- [ ] Fallback to offline book when explorer API is unreachable
- [ ] Play tab only visible when admin is logged in
- [ ] "Connect Lichess" button initiates OAuth flow
- [ ] After connecting, status shows "Connected as {username}"
- [ ] Game creation panel: challenge, open challenge, seek modes
- [ ] Time control presets and custom time input work
- [ ] Live game: board streams moves, clocks update
- [ ] Game actions: abort, resign, offer draw
- [ ] Game end: result displayed, "New Game" returns to creator
- [ ] Mobile: board and panels stack vertically

## Plays — AoE 2 tab

- [ ] `/plays` redirects to `/plays/chess`; the full-width "Chess" / "AoE 2" selector spans the content width and clicking each navigates to `/plays/chess` and `/plays/aoe2` respectively (URL path reflects the active game).
- [ ] The game selector sits flush under the top nav (no large gap above it).
- [ ] AoE 2 section: stats header shows current ELO, W/L record, total games, and top civilization.
- [ ] Full-width two-pane layout: a selectable game list on the left, a tabbed detail pane on the right, spanning the full page (no narrow max-width column).
- [ ] Featured game (or `?game=`, or newest) is selected by default; selecting another game swaps the detail pane.
- [ ] Every analyzed game in the list shows a colored opening tag (Scouts / Archers / Fast Castle / …) — never a blank/missing badge, even for haiku-coached games where the LLM omitted the `- Opening:` line (it falls back to the deterministic classifier). Backfill older blank tags with `uv run python manage.py aoe2_backfill_openings`.
- [ ] The detail pane opens on the **Coach** tab by default.
- [ ] Switching detail tabs (Coach / Economy / Army & Stats / Mistakes) does NOT re-fetch or reload data. There is **no** separate Technology tab — its tech timeline now lives in the Army & Stats graph's below-axis lanes.
- [ ] In the Army & Stats graph: each tech/unit icon matches its name (e.g. Horse Collar shows a collar, Knight shows a knight) — no wrong art; every known name shows a real icon (no monogram fallback for coach-vocabulary names), and a genuinely-unknown name shows a "?" chip (never a broken image or a bare dot).
- [ ] **Army & Stats** tab leads with the build-order guess, then ONE unified full-width production graph (stacked areas above the axis, m:ss time labels in their own band below, below-zero tech-research icon LANES — eco / military / university stacked, not all on one row — age-up guide-lines + age icons spanning the chart, vertical legend on the right), then the APM/efficiency panel. The old "produced strip" text is gone; **Mistakes** is its own separate tab.
- [ ] On desktop each tab's content fits without the detail pane scrolling.
- [ ] Opponent is shown by civilization only — no player names visible anywhere in the UI.
- [ ] No chat text appears anywhere in the UI or in raw API responses (`/api/aoe2/` and `/api/aoe2/<id>/`).
- [ ] Visiting `/plays/aoe2?game=<id>` (and the legacy `/plays?game=<id>`, which redirects) deep-links to the AoE 2 section with that game selected.
- [ ] ⋮ menu copies a share link (`/plays/aoe2?game=<id>`) to the clipboard.
- [ ] Admin: file upload box is visible; uploading a valid `.aoe2record` processes and shows the game.
- [ ] Non-admin: upload box is not visible.
- [ ] Uploading a non-1v1 recording (team game, single-player, vs-AI) results in a "skipped" response and no new game appears publicly.

### AoE 2 tab — detail tabs (aoe2coach v2)

- [ ] **Coach** tab shows: the coach verdict rendered as Markdown (headings, bold, lists — no raw `#`/`**` or agent scaffolding), the top build-order guess with a confidence %, the strategic-map minimap, and a basics grid (result, matchup, map, length, Feudal/Castle/Imperial, APM, ELO).
- [ ] The minimap (you = blue, opponent = red) shows building dots, walls, forward buildings ringed, engagement markers, and base centroids; footnote reads "shows where things were *built*, not what survived".
- [ ] **Economy** tab shows TWO clearly separated blocks with their units labeled: "Worker allocation — villager COUNTS per resource" (per-age stacked bars) and "Resource balance — resource AMOUNTS spent" (per-resource spend bars). Counts and amounts are never conflated.
- [ ] Economy: floating flags render (e.g. "⚠ floating wood (+49%)") when present; collected totals and relic gold show "unavailable"; both blocks carry a `~est` badge.
- [ ] **Army & Stats** production graph labels the areas as "produced" cumulative (never "live"); the unit legend on the right shows swatch + real icon + name + total; the below-zero icon row mixes unit-production and tech/upgrade icons at their times; build-order candidates (at the top of the tab) show matched (✓) / missed (✗) signal chips.
- [ ] The Army & Stats graph's below-axis tech timeline shows age-arrival guide-lines and tech-research markers in separate stacked lanes (eco / military / university), each marker using a real AoE2 DE icon (100% coverage for coach-vocabulary names), with a "?" chip for genuinely-unknown names.
- [ ] APM split reads "APM N — X eco · Y military · Z other" with the caption "commands per minute, by what they controlled" (not the old cryptic "eco N mil N other").
- [ ] The chess|AoE 2 selector stays full width when **Chess** is selected (the chess *content* below it stays in the reading column); the AoE 2 tab's base font reads a notch larger than before.
- [ ] Efficiency: TC idle is shown as a **pre-cap %** labeled "idle before 200 pop, age-ups excluded" (not an absolute mm:ss).
- [ ] Mistakes list shows severity + confidence-tier badge + "Fix" + learn-more deep-link; a game with none shows "No mistakes detected" (never an invented one).
- [ ] A match analyzed before the v2 upgrade (no reconstruction) still renders cleanly — coach text + basics, no broken/empty panels, no console errors.
- [ ] Raw `/api/aoe2/<id>/` response includes `reconstruction` (with `efficiency.precap_window_s`), `map_geometry`, `classifier`, `mistakes`, `economy` (with `worker_allocation` + `resource_balance`), `map_images`, and `coach_tier`; still no player names or chat anywhere.

### AoE 2 — build-order library (`/plays/aoe2/builds`)

- [ ] `/plays/aoe2/builds` loads without auth and lists all eleven builds grouped by family (Scouts, Archers, Men-at-Arms, Drush, Knights, Fast Castle, Drush → Fast Castle, Trash); each card shows name + family + one-line summary and links to its learn page.
- [ ] A build learn page (e.g. `/plays/aoe2/builds/archers-1-range`) shows the name, family badge, recommended civs, summary, and source (Hera guide + page).
- [ ] The learn page's phase-laned timeline graphic renders Dark Age → Feudal → Castle (→ Imperial) lanes; Feudal/Castle/Imperial lanes show the age target (arrival time / vils at click); each step renders a real AoE2 DE icon where its task maps to one, with a clean monogram glyph fallback otherwise.
- [ ] The ordered step list (phase, villager count, task) and the "what's next" transitions both render.
- [ ] An unknown build id (e.g. `/plays/aoe2/builds/not-a-real-build`) returns a 404 page, and `GET /api/aoe2/builds/not-a-real-build/` returns HTTP 404 (not 500).
- [ ] On the Coach tab, the top build-order guess is a link that navigates to `/plays/aoe2/builds/<build_id>` for the matching learn page.
- [ ] The build-library pages use the cyan `/plays` accent and the plays page background (no accent flash on uncached load).

## Performance

- [ ] Pages load within 3 seconds on first visit
- [ ] No N+1 queries visible in Django debug toolbar
- [ ] Images use lazy loading
- [ ] No layout shift on page load (CLS)

## Security

- [ ] Admin endpoints return 401 without token
- [ ] Login rate limiting works (15 attempts / 15 min)
- [ ] Feedback rate limiting works (1/hr/IP)
- [ ] No secrets exposed in page source or network tab
- [ ] CORS headers are correct (not wildcard)
- [ ] CSP header is present

## Bets (Market Dashboard)

- [ ] `/bets` loads and shows ticker cards with prices and sparklines
- [ ] Clicking a card expands it with a larger chart and period toggles
- [ ] Period toggles (1W/1M/3M/1Y/ALL) update the chart
- [ ] Pressing Escape or clicking expanded card collapses it
- [ ] Admin: "+ Add Ticker" opens search input
- [ ] Typing "vwce" shows stock results from Alpha Vantage
- [ ] Typing "bitcoin" shows crypto results from CoinGecko
- [ ] Clicking a search result adds the ticker immediately
- [ ] Already-tracked tickers are excluded from search results
- [ ] Search shows "No results" for gibberish input
- [ ] Admin: "×" delete button removes ticker
- [ ] Admin: "↻ Refresh" triggers sync and updates prices
- [ ] Non-admin: admin controls are hidden
- [ ] Mobile: cards stack single column, expanded card full width
- [ ] Empty state shows message when no tickers exist

### Bets — Backtester
- [ ] `/bets` shows the "Backtest sandbox" section below the ticker grid
- [ ] Selecting a ticker + strategy + params and clicking "Run backtest" renders an equity curve
- [ ] The strategy line and the dashed buy & hold line both render
- [ ] Buy (green) and sell (red) markers appear on the curve for trading strategies
- [ ] Metrics table shows return / CAGR / drawdown / Sharpe / trades / win rate vs. buy & hold
- [ ] An asset with too little history shows a clear "not enough history" message, not a crash
- [ ] Spamming "Run" eventually returns a rate-limit message (HTTP 429)

### Bets — Paper trading
- [ ] Public `/bets` shows the "Paper trading" section when accounts exist
- [ ] Each account card shows current value, total return %, and in-position/cash status
- [ ] "Show chart" expands a live equity curve with trade markers
- [ ] As admin (`/sudo`), "Start paper run" creates a new account that appears immediately
- [ ] As admin, "Stop" marks the account stopped (history retained); "Delete" removes it
- [ ] Non-admins cannot create/stop/delete (API returns 401)
- [ ] Running `sync_prices` advances active accounts (new snapshot per new day, no duplicates)

### Slops (/slops)
- [ ] Page loads with hero section and neon green accent
- [ ] Prompt box accepts input, submits new session, shows rate limit error on second submit
- [ ] Session appears in sidebar after submit (shows first turn prompt, status badge)
- [ ] Selecting a session shows its trace and summary bar
- [ ] Submit follow-up: when viewing session, submit sends session_id, creates new turn
- [ ] Active turn blocks submit: input disabled with "Waiting for current turn to complete"
- [ ] Admin: approve turn via three-dot menu, turn status changes, session status updates
- [ ] Admin: reject turn, session reverts to latest non-rejected turn status
- [ ] Completed session shows full ATIF trace with collapsible tool calls
- [ ] Running session shows live polling (5s interval)
- [ ] Multi-turn session: sidebar shows turn count, aggregate tokens
- [ ] Rate limiting: per-IP (1/hr) + global (10/hr) both enforced
- [ ] Nav wheel includes slops entry
- [ ] Mobile layout works (sidebar collapses)
- [ ] Stats endpoint returns total_sessions, total_turns, success_rate
- [ ] Submit without files — session appears, turn pending.
- [ ] Submit with one `.txt` attachment — chip visible before send, attachment listed on turn after send.
- [ ] Submit with 5 files including a `.pdf` — all land, PDF shown as non-previewable.
- [ ] Try to submit a 6 MB file — blocked client-side before network, error banner shows.
- [ ] Try to attach `evil.exe` — blocked client-side.
- [ ] Admin: expand a text attachment preview — content loads in-place.
- [ ] Admin: expand a text attachment >64 KB — content truncated with footer.
- [ ] Admin: reject a session with attachments — session updates; SSH to server and confirm `ls /home/klaude/workspace/klaude-playground/uploads/<id>/` is gone.
- [ ] Admin: delete a session with attachments — session dir gone.

### Slops downloads
- [ ] Submit a prompt instructing klaude to write a small markdown file to `downloads/<session>/<turn>/hello.md`. Approve. After the turn completes, a clickable chip appears below klaude's final message; clicking downloads the bytes.
- [ ] Submit a prompt instructing klaude to write 6 files. Only 5 chips appear.
- [ ] Submit a prompt instructing klaude to write a file > 5 MB. The chip shows "(too large)" with no link.
- [ ] Delete a session with downloads. Confirm `/home/klaude/workspace/<ws>/downloads/<id>/` is gone.

## Mobile

- [ ] All pages render correctly on mobile viewport (375px)
- [ ] Touch interactions work (nav, buttons, forms)
- [ ] No horizontal scroll
- [ ] Text is readable without zooming

## Reads — Audiobook (admin)

- [ ] Logged out: `/reads` page does NOT show LISTEN buttons.
- [ ] Logged out: visiting `/reads/ddia/listen` directly redirects to `/sudo`.
- [ ] Logged in: LISTEN button appears on the DDIA card.
- [ ] Click LISTEN: chapter list renders; first chapter active.
- [ ] Click chapter → audio jumps to its first chunk.
- [ ] Play → audio plays; progress bar updates within chunk.
- [ ] At chunk end → next chunk autoplays gaplessly.
- [ ] Adjust speed → playback rate changes immediately.
- [ ] Skip -15s → seeks back 15s, crossing chunk boundary if needed.
- [ ] Skip +30s → seeks forward 30s, crossing chunk boundary if needed.
- [ ] Minimize → pill appears bottom-right; tap pill plays/pauses.
- [ ] Navigate to `/listens`, start music → audiobook pauses (mutual exclusion).
- [ ] Navigate back to `/reads/ddia/listen` → state restored.
- [ ] Reload page mid-playback → position restored (paused); play button resumes from saved offset.
- [ ] curl `/media/audiobooks/ddia/00000.mp3` without token → 403.
- [ ] curl `/api/audiobooks/ddia/audio/0/?t=<expired>` → 403.
