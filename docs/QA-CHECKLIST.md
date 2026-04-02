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

## Listens (admin only)

- [ ] Track list loads with pagination
- [ ] Stats dashboard shows today/week/total counts
- [ ] Top tracks chart renders
- [ ] Daily listening graph renders
- [ ] Google OAuth sync flow works
- [ ] Sync cooldown (5 min) is enforced
- [ ] Deduplication works (no duplicate tracks after re-sync)

## Reads

- [ ] Page loads (content may be placeholder/coming soon)

## Feed

- [ ] `/feed.xml` returns valid RSS XML
- [ ] Feed contains thought entries with correct titles and dates

## Plays

- [ ] Chessboard renders with starting position
- [ ] Book moves panel shows available moves (e4, d4, Nf3, c4, f4 at start)
- [ ] Clicking a book move plays it on the board
- [ ] Opponent auto-responds with a book move
- [ ] Opening name and ECO code update as moves are played
- [ ] Move history displays correctly below the board
- [ ] Reset button returns to starting position
- [ ] Takeback undoes two moves (yours + opponent's)
- [ ] Flip button switches side and resets the board
- [ ] Drag-and-drop moves work on the board
- [ ] "Out of book" message shows when deviating from known lines
- [ ] Board renders on mobile viewport

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

## Mobile

- [ ] All pages render correctly on mobile viewport (375px)
- [ ] Touch interactions work (nav, buttons, forms)
- [ ] No horizontal scroll
- [ ] Text is readable without zooming
