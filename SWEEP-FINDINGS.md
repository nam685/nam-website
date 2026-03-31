# Code Quality Sweep Findings

Consolidated audit of nam-website repo. All issues ranked by severity.

---

## CRITICAL

### C1. Duplicate migration numbers (0010) — will break `migrate`
- `website/migrations/0010_feedback.py` + `0010_listentrack.py` both depend on `0009`
- Fix: Renumber one to `0011`, chain dependency

### C2. Insecure `SECRET_KEY` default
- `config/settings.py:13` — default `"django-insecure-change-me-in-production"`
- Fix: Remove default, fail loudly on missing env var

### C3. Admin token leaked as OAuth `state` parameter
- Backend: `website/views/github.py:37-45`, `website/views/listen.py:59,97`
- Frontend: `frontend/src/app/listens/page.tsx:403`, `frontend/src/app/codes/CodesClient.tsx:449`
- Token visible in server logs, browser history, referrer headers
- Fix: Generate short-lived nonce server-side, verify in callback

### C4. CI action versions pinned to non-existent `@v6` tags — pipeline is broken
- `.github/workflows/ci.yml:13,19,41`
- Fix: Pin to `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-python@v5`, `astral-sh/setup-uv@v5`

### C5. Backend tests never run in CI
- `.github/workflows/ci.yml` — no `uv run pytest` step
- Fix: Add pytest step with DB service container

---

## HIGH

### H1. `ADMIN_SECRET` defaults to empty string
- `config/settings.py:83` — `env("ADMIN_SECRET", default="")`
- Fix: Remove default, fail at startup

### H2. `X-Forwarded-For` IP extraction trusts client-supplied header
- `website/views/auth.py:15-19`, `website/views/feedback.py:14-18`
- Rate limiter bypassable by spoofing header
- Fix: Use rightmost IP or configure trusted proxy

### H3. `uv.lock` is gitignored — non-reproducible builds
- `.gitignore:43` — `uv.lock` excluded
- Fix: Remove from .gitignore, commit lockfile

### H4. `eslint-config-next` installed but not used
- `frontend/eslint.config.mjs` — hand-rolled config, missing `next/core-web-vitals`
- Fix: Use standard Next.js ESLint setup

### H5. Hardcoded Node.js version in systemd service
- `infra/nextjs.service:11` — `/home/nam/.nvm/versions/node/v20.20.2/bin`
- Fix: Use nvm alias symlink or system Node

### H6. `drawing_upload` missing `@require_POST`
- `website/views/drawing.py:27-31`
- Fix: Add `@require_POST` above `@require_admin`

### H7. In-memory rate limits are per-process (bypassed under gunicorn)
- `website/views/github.py:19,66`, `website/views/listen.py:27,102`
- Fix: Use Redis instead of module-level variables

### H8. RSS feed XML injection
- `frontend/src/app/feed.xml/route.ts:14-21`
- `post.title` and `post.excerpt` interpolated without XML escaping
- Fix: Add XML escape helper

### H9. `github_auth` skips token validation before redirect
- `website/views/github.py:30-45` — unlike `listen_auth`
- Fix: Add token verification guard

### H10. New Redis connection per login attempt (no pooling)
- `website/views/auth.py:24` — `redis.from_url()` on every call
- Fix: Use `django-redis` cache backend with connection pooling

### H11. Duplicate localStorage access bypasses SSR-safe `store()` wrapper
- `frontend/src/app/draws/page.tsx:120`, `frontend/src/app/listens/page.tsx:369`
- Fix: Use `store()`/`storeDel()` from `lib/auth.ts`

### H12. Duplicate SVG pattern IDs
- `frontend/src/app/codes/CodesClient.tsx:84-85` — `id="grid"`, `id="diag"`
- Fix: Use scoped IDs like `codes-grid`, `codes-diag`

### H13. `getAdminToken()` silently redirects inside useCallback
- `frontend/src/app/listens/page.tsx:354-386`
- Fix: Callers should check null and handle navigation themselves

---

## MEDIUM

### M1. Two separate COUNT queries in `listen_list`
- `website/views/listen.py:35,49`
- Fix: Cache total count in Redis

### M2. `.first()` relies on implicit model ordering
- `website/views/thought.py:42-43`
- Fix: Add explicit `.order_by("-created_at")`

### M3. `GitHubContributions` hardcodes `pk=1` singleton
- `website/views/github.py:151`
- Fix: Document singleton intent or enforce in model

### M4. `force-dynamic` + `revalidate: 60` contradiction
- `frontend/src/app/todo/page.tsx:5,13`
- Fix: Remove `force-dynamic`, let ISR work

### M5. Pervasive inline `onMouseEnter`/`onMouseLeave` style mutation
- Nearly every component — `sudo/page.tsx`, `thinks/page.tsx`, `draws/page.tsx`, etc.
- Fix: Use CSS `:hover` or Tailwind `hover:` classes

### M6. `PageBackground` CSS `url()` injection pattern
- `frontend/src/components/PageBackground.tsx:44-46`
- Fix: Quote the URL inside CSS `url("...")`

### M7. Missing `collectstatic` in deploy workflow
- `.github/workflows/deploy.yml:33-35`
- Fix: Add `collectstatic --noinput`

### M8. Django version constraint `>=5.1` but codebase uses 6.x
- `pyproject.toml:7`
- Fix: Update to `django>=6.0`

### M9. `grinds/page.tsx` uses JS resize instead of CSS/ResizeObserver
- `frontend/src/app/grinds/page.tsx:361-365`
- Fix: Use CSS media queries or ResizeObserver

### M10. Unbounded drawing queryset — no pagination
- `website/views/drawing.py:13`
- Fix: Add limit or pagination

### M11. `listen_stats` fires 5 uncached DB queries
- `website/views/listen.py:213-230`
- Fix: Cache entire response in Redis (5min TTL)

### M12. Missing DB indexes
- `models/drawing.py` — `is_published`, `created_at` not indexed
- `models/feedback.py` — `ip_address`, `created_at` not indexed
- Fix: Add `db_index=True` or composite indexes

### M13. Deploy runs `migrate` without dry-run check
- `.github/workflows/deploy.yml:34`
- Fix: Add `migrate --check` in CI

### M14. No TypeScript type-check step in CI
- Fix: Add `pnpm exec tsc --noEmit`

### M15. No `.next/cache` or `uv` caching in CI
- Fix: Add `actions/cache` for `.next/cache`, enable uv cache

### M16. Frontend/backend run sequentially in single CI job
- Fix: Split into parallel jobs

### M17. Background images bypass Next.js optimization
- `frontend/src/components/PageBackground.tsx`
- Fix: Pre-optimize to WebP at build time

### M18. Drawing images missing width/height — CLS issues
- `frontend/src/app/draws/page.tsx:342-352`
- Fix: Use `next/image` with fill, or aspect-ratio placeholders

---

## LOW

### L1. No `db_index` on `Drawing.is_published`
- Already covered in M12

### L2. `feedback_create` rate limit uses DB query inconsistently
- `website/views/feedback.py:29-31`

### L3. `Suspense` without fallback in `sudo/page.tsx:298`
- Fix: Add minimal fallback

### L4. Hidden file input positioning in `draws/page.tsx:85-96`
- Fix: Use `display: none` instead

### L5. `NEXT_PUBLIC_API_URL` not in `.env.example`
- Fix: Add with comment

### L6. Production domain vars not highlighted in setup docs
- `.env.example:7`, `docs/infrastructure.md`

### L7. Dependabot auto-rebase on every main push
- `.github/workflows/dependabot-automerge.yml`

### L8. `listen_sync_status` redundant DB call
- `website/views/listen.py:252`

---

---

## FROM SECURITY AUDIT

### Already captured above:
- C2 (SECRET_KEY), C3 (OAuth token leak), H1 (ADMIN_SECRET), H2 (X-Forwarded-For), H7 (per-process rate limits), H9 (github_auth no validation)

### New findings:

### H14. Admin token in localStorage — persistent XSS risk
- `frontend/src/lib/auth.ts:7-9`, `frontend/src/app/sudo/page.tsx:61`
- 7-day TTL compounds exposure window
- Fix: Consider HttpOnly cookie, or reduce TTL to 8h with refresh

### H15. Unvalidated integer parsing on listen endpoint → 500
- `website/views/listen.py:32-33` — `int(request.GET.get("limit"))` raises ValueError
- Fix: try/except with 400 response

### M19. CSP allows `unsafe-inline` for scripts
- `infra/Caddyfile:7`
- Fix: Use SHA-256 hash of inline script instead

### M20. OAuth error param reflected to UI without sanitization
- `frontend/src/app/listens/page.tsx:391-395`
- Fix: Whitelist known error codes

### M21. Django security headers missing at app layer
- `config/settings.py` — no `SECURE_CONTENT_TYPE_NOSNIFF`, `X_FRAME_OPTIONS`
- Fix: Add to settings.py

---

## FROM CODE DUPLICATION AUDIT

### D1. CRITICAL: Accent color map duplicated in 3+ places
- `navWheel.ts` NAV_ITEMS, `layout.tsx` inline script, 5+ page files with local constants
- Fix: Export `ROUTE_ACCENTS` from navWheel.ts, derive everywhere else

### D2. CyberGrid component copy-pasted between codes and reads
- `CodesClient.tsx:70-116`, `ReadsClient.tsx:120-166` — byte-for-byte identical
- Fix: Extract to `components/CyberGrid.tsx`

### D3. `_client_ip` helper duplicated with divergent fallbacks
- `feedback.py:14-18` (falls back to `"0.0.0.0"`), `auth.py:15-19` (falls back to `""`)
- Fix: Single `get_client_ip()` in `website/utils.py`

### D4. Direct localStorage bypassing store() helpers (= H11)

### D5. Sudo redirect URL duplicated inline vs getAdminToken()
- `auth.ts:23`, `listens/page.tsx:370`
- Fix: Reuse getAdminToken() or export redirectToLogin()

### D6. Tag pill inline style duplicated 4x — .tag CSS class exists but unused
- `CodesClient.tsx`, `grinds/page.tsx` (x2), `ReadsClient.tsx`
- Fix: Use existing `.tag` CSS class with `var(--accent)`

### D7. Separator line + corner bracket inline styles duplicated 3x — .corner-* CSS exists unused
- Fix: Use existing `.corner-tr` etc. classes from globals.css

### D8. JSON body parsing try/except pattern duplicated 3x
- `thought.py`, `feedback.py`, `auth.py`
- Fix: `parse_json_body()` helper in `website/utils.py`

### D9. Date formatting utils duplicated as inline functions
- `thinks/page.tsx` (formatDate), `listens/page.tsx` (timeAgo), `CodesClient.tsx` (formatRelativeDate)
- Fix: Consolidate into `lib/date.ts`

### D10. @keyframes fadeUp + hexFloat duplicated in codes and reads
- Fix: Move to globals.css

---

## FROM TEST COVERAGE AUDIT

### Current test inventory:
- Backend: 1 test file (`website/tests/test_listen.py`) — covers listen endpoints only
- Frontend: 4 test files in `lib/__tests__/` — auth, contributions, grindsData, navWheel

### Critical gaps (ranked by risk):
1. **Auth login endpoint** — completely untested (the gate to all admin functions)
2. **Drawing upload** — file uploads entirely untested (had a real bug: commit 0e1f5a9)
3. **Thought create** — 18h cooldown + content limits untested
4. **Feedback create** — per-IP rate limiting untested
5. **SudoForm open-redirect guard** — security-relevant `from` param check untested

### Missing test infrastructure:
- No `pytest-cov` configured
- No `@testing-library/react` for component tests
- No `@vitest/coverage-v8` configured
- `timeAgo`/`formatTotal` inline in page files (not testable without extraction)

---

## FROM CI/CD AUDIT

### Already captured: C4 (action versions), C5 (no pytest), H3 (uv.lock gitignored)

### New findings:
### M22. Deploy runs `migrate` without dry-run check
- Fix: Add `migrate --check` in CI

### M23. No TypeScript type-check step (`tsc --noEmit`) in CI
- Fix: Add between lint and build

### M24. No `.next/cache` or `uv` caching in CI
- Fix: Add actions/cache and `enable-cache: true` on setup-uv

### M25. Frontend/backend in single sequential CI job
- Fix: Split into parallel jobs

### M26. Dependabot auto-rebase on every main push (noisy)

---

## FROM CLAUDE.md AUDIT

### Inaccurate:
1. ESLint claims "next/core-web-vitals" — actual: custom flat config, no Next.js rules
2. Dev port implied 3000 — actual: 3001 (`-p 3001` in package.json)
3. Ruff hook uses `--fix` (not documented)
4. Auth request body format not documented (JSON `{"secret": "..."}`)

### Missing (should add):
1. **Django app structure** — split `models/` and `views/` subdirectories (agents will create flat files otherwise)
2. **Accent color system** — must update 2 files when adding nav page
3. **`NEXT_PUBLIC_API_URL`** — controls API/API_INTERNAL constants
4. **Test conventions** — where tests go, conftest fixtures
5. **`pnpm format`** command
6. **`/ship` command** reference
7. **Environment variables** summary
8. **API endpoint reference**

---

## ALL AUDITS COMPLETE — GRAND TOTALS

| Severity | Count |
|----------|-------|
| Critical | 5 |
| High | 15 |
| Medium | 26 |
| Low | 8 |
| Duplication | 10 |
| CLAUDE.md | 12 |
| Test gaps | 5 critical paths |
