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

## Auth (/sudo)

- [ ] Login form appears at `/sudo`
- [ ] Correct secret grants token and redirects to previous page
- [ ] Wrong secret shows error
- [ ] Token persists across page reloads (localStorage)
- [ ] Protected pages redirect to `/sudo` when not logged in
- [ ] Token expires after 7 days

## Thinks

- [ ] Thought list loads and paginates
- [ ] "Load more" fetches next page
- [ ] Admin can create a new thought
- [ ] 18-hour cooldown is enforced between thoughts
- [ ] Content length limit (2000 chars) is enforced

## Draws

- [ ] Gallery loads with pencil and camera categories
- [ ] Category filter (tabs) works
- [ ] Admin can upload an image (JPEG, PNG, GIF, WEBP)
- [ ] 10MB file size limit is enforced
- [ ] Admin can delete a drawing
- [ ] Images display correctly (no broken URLs)

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
- [ ] `/listens` loads with hero panel (recommended track, top this month, stats, sparkline)
- [ ] Hero shows "RECOMMENDED" label with rediscovery track (not "LATEST")
- [ ] Top This Month carousel constrained to max 6 cards with square thumbnails
- [ ] History feed shows 20 items initially, two-column grid desktop, single column mobile
- [ ] "Load More" fetches next 20 items
- [ ] Tab navigation works: History / Tracks / Artists / Albums
- [ ] `/listens/tracks` shows ranked track list with play counts, artist names truncated
- [ ] `/listens/artists` shows artist cards — collab artists credited independently
- [ ] `/listens/artists` — no view count strings in artist names (e.g., "89M views")
- [ ] `/listens/albums` shows only albums with 2+ tracks, square cover art
- [ ] All text truncated with ellipsis (no overflow)
- [ ] Content area has semi-transparent background (background visible through)
- [ ] Feedback button at bottom-left (not bottom-right)
- [ ] No play buttons or sync button visible when logged out

### Admin
- [ ] Sync button appears and triggers sync
- [ ] Sync cooldown (5 min) is enforced
- [ ] Google Takeout import works via POST /api/listens/import/
- [ ] Deduplication works (no duplicate tracks after re-sync)
- [ ] Play buttons appear on tracks, artist cards, album cards
- [ ] Clicking play opens the mini player
- [ ] Mini player: play/pause, next/prev, shuffle, repeat, seek
- [ ] Mini player persists when navigating to other pages (/watches, /thinks, etc.)
- [ ] Mini player minimize/close work
- [ ] Playing a list (top this month, artist, album) builds correct queue

### Responsive
- [ ] Mobile: stats bar compact, single-column layouts, player becomes bottom bar
- [ ] Tablet: two-column grids, floating player
- [ ] Desktop: full magazine layout, floating player

## Watches

- [ ] Page loads and shows glow grid of channels (if any exist)
- [ ] Channels are sorted by tier (never_miss first, then regular, then check_out)
- [ ] Tier visual intensity differs (glow, border, opacity, avatar size)
- [ ] Clicking a channel expands it in-place showing pinned videos
- [ ] Clicking again collapses the expanded card
- [ ] Video thumbnails link to YouTube in a new tab
- [ ] Channel avatars link to YouTube channel in a new tab
- [ ] "Show more" button appears when total > page size
- [ ] Show more loads additional channels without duplicates
- [ ] Mobile: grid collapses to fewer columns, expanded cards span full width
- [ ] Admin: "connect youtube" button visible when logged in and not connected
- [ ] Admin: "sync" button visible when connected
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

## Plays — Lichess Integration

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

## Mobile

- [ ] All pages render correctly on mobile viewport (375px)
- [ ] Touch interactions work (nav, buttons, forms)
- [ ] No horizontal scroll
- [ ] Text is readable without zooming
