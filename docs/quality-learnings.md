# Quality Review Learnings

Compiled from a comprehensive review of ~120 commits (2026-03-30 to 2026-04-06).
Intended as a reference for future agents working on this codebase.

## Security

### OAuth state must never contain secrets
The Lichess OAuth flow originally embedded the admin token in the `state` parameter (`f"{nonce}:{admin_token}"`). This leaked the token to the OAuth provider's logs, the browser URL bar, and browser history. **Fix:** Use a one-time nonce stored in Redis as the `state` value. The nonce is created via `create_oauth_nonce()` in `utils.py` and verified/consumed via `verify_oauth_nonce()`. GitHub and Google OAuth flows already used this pattern correctly.

### Public APIs must not expose PII
The slops `_serialize_turn()` originally included `submitter_ip` in all responses. Public endpoints should never expose visitor IPs. **Fix:** Add an `include_ip=False` parameter to serializers; only pass `True` from admin-only endpoints.

### Validate user-controlled path components
The slops workspace name is used in `os.path.join()` to construct filesystem paths. Without validation, values like `../../etc` enable path traversal. **Fix:** Validate against a regex (`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`) before use. Apply this pattern to any user/admin input that becomes a path component.

### Pin GitHub Actions to commit SHAs
Using `@v1` or `@v6` version tags means a compromised upstream action author can push malicious code under the same tag. **Fix:** Pin to full commit SHA with a version comment: `uses: actions/checkout@de0fac2e...  # v6`.

## State Management

### Module-level variables break in multi-worker deployments
Pattern like `_last_sync: float = 0` for rate limiting is per-process — each gunicorn worker has its own copy. This was present in watches, listens, lichess, and GitHub views. **Fix:** Use Redis via Django's cache framework: `redis_cache.get(_SYNC_KEY)` / `redis_cache.set(_SYNC_KEY, now, TTL)`. Set TTL slightly longer than the cooldown to auto-expire.

### `update_or_create` can silently destroy curated state
The YouTube liked-videos sync used `update_or_create` with `defaults={"pinned": False, "visible": False}`, which reset admin curation on every re-sync. **Fix:** Use `get_or_create` for the initial insert, then update only metadata fields (title, thumbnail) on existing records, preserving `pinned` and `visible`.

## Efficiency

### N+1 queries are the most common performance issue
Found in 4 places across this review period:
- **watch_list**: Each channel triggered a separate query for pinned videos. Fix: `Prefetch("videos", queryset=..., to_attr="pinned_videos")`.
- **listen_top_albums**: Each album triggered per-album artist and thumbnail queries. Fix: Batch-fetch all albums' artists/thumbnails in two queries using `filter(album__in=album_names)`.
- **bets_list**: Each ticker triggered a separate query for snapshots. Fix: Single query with `filter(ticker_id__in=ticker_ids)`, grouped in Python.
- **slops_detail**: Missing `prefetch_related("turns")` on the single-session GET.

**Rule of thumb:** Any time you serialize related objects inside a loop, add `prefetch_related()` or `Prefetch()` to the queryset.

### Pagination must be validated
Passing `?limit=abc` to `int()` without try/except produces a 500 error. This was present in 6 endpoints. **Fix:** Use the shared `parse_pagination(request, default_limit=50, max_limit=200)` utility in `website/utils.py`. It returns `(limit, offset)` or raises `ValueError`.

## Frontend

### Always use SSR-safe localStorage wrappers
Raw `localStorage.getItem()` fails during SSR (no `window`). The project provides `store(key)` and `storeDel(key)` in `lib/auth.ts`. Always use these, even inside `useEffect` (for consistency). Found violated in the slops page.

### Check `res.ok` before `.json()` on fetch responses
If the API returns a 500, calling `.json()` on the response will try to parse an error page and silently corrupt client state. Found in 4 places in the bets page. **Fix:** `r.ok ? r.json() : Promise.reject(r.status)`.

### Don't duplicate utility functions
The slops page defined its own `timeAgo()` identical to the one in `lib/date.ts`. Pure utility functions should always live in `frontend/src/lib/` and be imported. Check for existing utilities before writing new ones.

## Testing

### Every new feature needs regression tests for the bug it fixes
The review found a 2.7:1 fix-to-feature ratio (76 fixes vs 28 features in one week). Many fixes were for issues that could have been caught by tests on the original feature. When fixing a bug, always add a test that would have caught it.

### Mock at the right level
`patch("website.views.slops.subprocess")` fails if `subprocess` is imported inside a function body rather than at module level. Use `patch("subprocess.run")` to mock at the stdlib level when the import is deferred.

### Test files for each view module
Every `website/views/<name>.py` should have a corresponding `website/tests/test_<name>.py`. The GitHub views had zero test coverage until this review. Even basic auth guard + happy path tests catch regressions.

## Patterns to Follow

| Pattern | Where | Why |
|---------|-------|-----|
| `parse_pagination()` | `website/utils.py` | Shared pagination validation |
| `create_oauth_nonce()` / `verify_oauth_nonce()` | `website/utils.py` | One-time OAuth state tokens |
| `redis_cache.get/set(_SYNC_KEY)` | All sync views | Process-safe rate limiting |
| `Prefetch(..., to_attr=...)` | Any list view with related objects | Eliminates N+1 queries |
| `include_ip=False` on serializers | Public vs admin endpoints | PII protection |
| `store(key)` not `localStorage` | Frontend | SSR safety |

## Known Remaining Items

These were identified but not fixed (low priority for a personal site):

- **`listen_import` has no file size guard** — Django's `DATA_UPLOAD_MAX_MEMORY_SIZE` mitigates, but an explicit check would be better.
- **`bets_sync` runs synchronously** — `call_command("sync_prices")` blocks the request. Could timeout with many tickers. Should be a Celery task.
- **OAuth nonce verify is not atomic** — `get` then `delete` in two Redis calls. Use `GETDEL` or a Lua script for true atomicity.
- **`listen_top_artists` loads entire table** — Needed for collab-artist splitting. Acceptable at current scale (~50k rows).
- **Frontend pages are all client components** — Pages like `/codes`, `/reads`, `/now` could be server components for smaller JS bundles.
- **No `next/image` for external thumbnails** — Raw `<img>` tags miss lazy loading and format optimization.
