# Lichess Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live Lichess gameplay (admin-only) and upgrade the opening explorer to use live data from `explorer.lichess.org`, replacing the static database.

**Architecture:** Django handles Lichess OAuth2 (PKCE, no client secret) and stores the token. The frontend streams Board API directly from the browser for live games, and fetches the Opening Explorer API (public, no auth) for move statistics. Chessground + chessops replace react-chessboard + chess.js as the board/logic libraries.

**Tech Stack:** Django 6.0, chessground (vanilla JS board), chessops (chess logic/FEN), Lichess Board API (ND-JSON streaming), Lichess Opening Explorer API

---

## File Map

### Backend (new files)
| File | Purpose |
|---|---|
| `website/models/lichess.py` | `LichessToken` model — single-row table for stored Lichess OAuth token |
| `website/views/lichess.py` | OAuth auth/callback, token retrieval, connection status endpoints |
| `website/tests/test_lichess.py` | Tests for all 4 endpoints |

### Backend (modified files)
| File | Change |
|---|---|
| `website/models/__init__.py` | Add `LichessToken` import + `__all__` entry |
| `website/views/__init__.py` | Add lichess view imports + `__all__` entries |
| `website/urls.py` | Add 4 `/api/lichess/` routes |

### Frontend (new files)
| File | Purpose |
|---|---|
| `frontend/src/components/ChessgroundBoard.tsx` | React wrapper for vanilla Chessground |
| `frontend/src/components/ChessgroundBoard.css` | Dark theme overrides for Chessground |
| `frontend/src/components/OpeningExplorer.tsx` | Live explorer panel with stats bars + database toggle |
| `frontend/src/components/LichessGame.tsx` | Live game — board, clocks, controls, streaming |
| `frontend/src/components/LichessGameCreator.tsx` | Game creation panel — challenge/seek/open |
| `frontend/src/lib/lichessApi.ts` | ND-JSON stream parser, Board API helpers, Explorer API helpers |
| `frontend/src/lib/__tests__/lichessApi.test.ts` | Tests for stream parsing + explorer helpers |

### Frontend (modified files)
| File | Change |
|---|---|
| `frontend/package.json` | Remove `react-chessboard` + `chess.js`, add `chessground` + `chessops` |
| `frontend/src/app/plays/PlaysClient.tsx` | Tab bar (Explorer/Play), admin detection, mode switching |
| `frontend/src/lib/api.ts` | Add `LichessStatus` interface |
| `frontend/src/lib/chessOpenings.ts` | Kept as-is (offline fallback) |

### Documentation
| File | Change |
|---|---|
| `docs/README.md` | Add Lichess integration to plays page description |
| `docs/QA-CHECKLIST.md` | Add plays/Lichess QA items |

---

## Task 1: LichessToken Model

**Files:**
- Create: `website/models/lichess.py`
- Modify: `website/models/__init__.py`
- Test: `website/tests/test_lichess.py` (started here, expanded in Task 2)

- [ ] **Step 1: Write the model test**

Create `website/tests/test_lichess.py`:

```python
import pytest
from django.utils import timezone

from website.models import LichessToken


@pytest.mark.django_db
class TestLichessToken:
    def test_create_token(self):
        token = LichessToken.objects.create(
            access_token="lip_test123",
            lichess_username="testuser",
            expires_at=timezone.now() + timezone.timedelta(days=365),
        )
        assert token.access_token == "lip_test123"
        assert token.lichess_username == "testuser"
        assert str(token) == "Lichess: testuser"

    def test_upsert_replaces_existing(self):
        LichessToken.objects.create(
            access_token="old_token",
            lichess_username="olduser",
            expires_at=timezone.now() + timezone.timedelta(days=365),
        )
        # Delete all, then create new (single-row upsert pattern)
        LichessToken.objects.all().delete()
        LichessToken.objects.create(
            access_token="new_token",
            lichess_username="newuser",
            expires_at=timezone.now() + timezone.timedelta(days=365),
        )
        assert LichessToken.objects.count() == 1
        assert LichessToken.objects.first().lichess_username == "newuser"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_lichess.py -v`
Expected: `ImportError: cannot import name 'LichessToken'`

- [ ] **Step 3: Create the model**

Create `website/models/lichess.py`:

```python
from django.db import models


class LichessToken(models.Model):
    """Stored Lichess OAuth token. Single-row table — only one admin account."""

    access_token = models.CharField(max_length=256)
    lichess_username = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    def __str__(self):
        return f"Lichess: {self.lichess_username}"
```

- [ ] **Step 4: Register in models/__init__.py**

Add to `website/models/__init__.py`:

```python
from .lichess import LichessToken
```

Add `"LichessToken"` to the `__all__` list.

- [ ] **Step 5: Create and apply migration**

Run:
```bash
cd /home/namle685/projects/nam-website/.claude/worktrees/lichess-integration
uv run python manage.py makemigrations website
uv run python manage.py migrate
```

Expected: Migration created and applied successfully.

- [ ] **Step 6: Run test to verify it passes**

Run: `uv run pytest website/tests/test_lichess.py -v`
Expected: 2 tests PASS

- [ ] **Step 7: Commit**

```bash
git add website/models/lichess.py website/models/__init__.py website/tests/test_lichess.py website/migrations/
git commit -m "feat(lichess): add LichessToken model"
```

---

## Task 2: Lichess OAuth Views

**Files:**
- Create: `website/views/lichess.py`
- Modify: `website/views/__init__.py`
- Modify: `website/urls.py`
- Modify: `website/tests/test_lichess.py`

- [ ] **Step 1: Write failing tests for all 4 endpoints**

Append to `website/tests/test_lichess.py`:

```python
from unittest.mock import MagicMock, patch

from website.views import lichess as lichess_views


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    lichess_views._last_sync = 0
    yield
    lichess_views._last_sync = 0


# ── Auth guard ──────────────────────────────────────


@pytest.mark.django_db
class TestLichessAuthGuard:
    def test_auth_requires_admin_token(self, client):
        resp = client.get("/api/lichess/auth/")
        assert resp.status_code == 401

    def test_auth_rejects_bad_token(self, client):
        resp = client.get("/api/lichess/auth/?token=bad")
        assert resp.status_code == 401

    def test_token_requires_auth(self, client):
        resp = client.get("/api/lichess/token/")
        assert resp.status_code == 401


# ── Auth endpoint ────────────────────────────────────


@pytest.mark.django_db
class TestLichessAuth:
    def test_redirects_to_lichess(self, client, admin_token):
        resp = client.get(f"/api/lichess/auth/?token={admin_token}")
        assert resp.status_code == 302
        location = resp["Location"]
        assert "lichess.org/oauth" in location
        assert "nam685.de" in location
        assert "board:play" in location
        assert "code_challenge=" in location


# ── Callback endpoint ────────────────────────────────


@pytest.mark.django_db
class TestLichessCallback:
    def test_callback_missing_code(self, client):
        resp = client.get("/api/lichess/callback/")
        assert resp.status_code == 400

    def test_callback_bad_state(self, client):
        resp = client.get("/api/lichess/callback/?code=test&state=bad:bad")
        assert resp.status_code == 401

    @patch("website.views.lichess.urllib.request.urlopen")
    def test_callback_exchanges_token(self, mock_urlopen, client, admin_token):
        # Store a verifier in cache for our nonce
        from django.core.cache import cache

        cache.set("lichess_pkce_nonce123", "test_verifier_string", 600)

        # Mock token exchange
        token_resp = MagicMock()
        token_resp.read.return_value = b'{"access_token":"lip_abc","expires_in":31536000}'
        token_resp.__enter__ = lambda s: s
        token_resp.__exit__ = MagicMock(return_value=False)

        # Mock account fetch
        account_resp = MagicMock()
        account_resp.read.return_value = b'{"username":"nam685"}'
        account_resp.__enter__ = lambda s: s
        account_resp.__exit__ = MagicMock(return_value=False)

        mock_urlopen.side_effect = [token_resp, account_resp]

        resp = client.get(f"/api/lichess/callback/?code=authcode&state=nonce123:{admin_token}")
        assert resp.status_code == 302
        assert resp["Location"] == "/plays"
        assert LichessToken.objects.count() == 1
        assert LichessToken.objects.first().lichess_username == "nam685"

    @patch("website.views.lichess.urllib.request.urlopen")
    def test_callback_rate_limited(self, mock_urlopen, client, admin_token):
        from django.core.cache import cache

        cache.set("lichess_pkce_nonce1", "verifier1", 600)

        token_resp = MagicMock()
        token_resp.read.return_value = b'{"access_token":"lip_abc","expires_in":31536000}'
        token_resp.__enter__ = lambda s: s
        token_resp.__exit__ = MagicMock(return_value=False)

        account_resp = MagicMock()
        account_resp.read.return_value = b'{"username":"nam685"}'
        account_resp.__enter__ = lambda s: s
        account_resp.__exit__ = MagicMock(return_value=False)

        mock_urlopen.side_effect = [token_resp, account_resp]
        client.get(f"/api/lichess/callback/?code=code1&state=nonce1:{admin_token}")

        # Second attempt should be rate limited
        cache.set("lichess_pkce_nonce2", "verifier2", 600)
        resp = client.get(f"/api/lichess/callback/?code=code2&state=nonce2:{admin_token}")
        assert resp.status_code == 302
        assert "error=" in resp["Location"]


# ── Token endpoint ───────────────────────────────────


@pytest.mark.django_db
class TestLichessTokenEndpoint:
    def test_no_token_stored(self, client, auth_headers):
        data = client.get("/api/lichess/token/", **auth_headers).json()
        assert data == {"error": "Not connected"}

    def test_returns_token(self, client, auth_headers):
        LichessToken.objects.create(
            access_token="lip_test",
            lichess_username="nam685",
            expires_at=timezone.now() + timezone.timedelta(days=365),
        )
        data = client.get("/api/lichess/token/", **auth_headers).json()
        assert data["access_token"] == "lip_test"
        assert data["username"] == "nam685"


# ── Status endpoint ──────────────────────────────────


@pytest.mark.django_db
class TestLichessStatus:
    def test_not_connected(self, client):
        data = client.get("/api/lichess/status/").json()
        assert data == {"connected": False, "username": None}

    def test_connected(self, client):
        LichessToken.objects.create(
            access_token="lip_test",
            lichess_username="nam685",
            expires_at=timezone.now() + timezone.timedelta(days=365),
        )
        data = client.get("/api/lichess/status/").json()
        assert data == {"connected": True, "username": "nam685"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_lichess.py -v`
Expected: Import errors / 404s — views don't exist yet.

- [ ] **Step 3: Create the views**

Create `website/views/lichess.py`:

```python
import base64
import hashlib
import json
import logging
import os
import secrets
import time
import urllib.parse
import urllib.request

from django.core.cache import cache as redis_cache
from django.http import HttpResponseRedirect, JsonResponse
from django.utils import timezone

from ..auth import require_admin, verify_token
from ..models import LichessToken

logger = logging.getLogger(__name__)

CLIENT_ID = "nam685.de"
LICHESS_AUTHORIZE_URL = "https://lichess.org/oauth"
LICHESS_TOKEN_URL = "https://lichess.org/api/token"
LICHESS_ACCOUNT_URL = "https://lichess.org/api/account"
SCOPES = "board:play challenge:write challenge:read"

# Rate limit: 1 OAuth flow per 5 minutes
_last_sync: float = 0
SYNC_COOLDOWN = 300


def lichess_auth(request):
    """Redirect to Lichess OAuth. Requires admin token as ?token= param."""
    admin_token = request.GET.get("token", "")
    if not admin_token or not verify_token(admin_token):
        return JsonResponse({"error": "Unauthorized"}, status=401)

    # PKCE: generate verifier + S256 challenge
    code_verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(code_verifier.encode()).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()

    # Store verifier in Redis cache, keyed by a random nonce
    nonce = secrets.token_urlsafe(16)
    redis_cache.set(f"lichess_pkce_{nonce}", code_verifier, 600)  # 10 min TTL

    # Build redirect URI
    scheme = "https" if request.is_secure() else "http"
    host = request.get_host()
    redirect_uri = f"{scheme}://{host}/api/lichess/callback/"

    params = urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": CLIENT_ID,
            "redirect_uri": redirect_uri,
            "code_challenge_method": "S256",
            "code_challenge": code_challenge,
            "scope": SCOPES,
            "state": f"{nonce}:{admin_token}",
        }
    )
    return HttpResponseRedirect(f"{LICHESS_AUTHORIZE_URL}?{params}")


def lichess_callback(request):
    """Lichess OAuth callback: exchange code for token, fetch account, store."""
    global _last_sync

    error = request.GET.get("error", "")
    if error:
        return HttpResponseRedirect(f"/plays?error={urllib.parse.quote(error)}")

    code = request.GET.get("code", "")
    state = request.GET.get("state", "")
    if not code:
        return JsonResponse({"error": "Missing code"}, status=400)

    # Parse state: "nonce:adminToken"
    if ":" not in state:
        return JsonResponse({"error": "Unauthorized"}, status=401)
    nonce, admin_token = state.split(":", 1)
    if not verify_token(admin_token):
        return JsonResponse({"error": "Unauthorized"}, status=401)

    # Rate limit
    now = time.time()
    if now - _last_sync < SYNC_COOLDOWN:
        remaining = int(SYNC_COOLDOWN - (now - _last_sync))
        return HttpResponseRedirect(f"/plays?error={urllib.parse.quote(f'Rate limited. Try again in {remaining}s')}")

    # Retrieve PKCE verifier from cache
    code_verifier = redis_cache.get(f"lichess_pkce_{nonce}")
    if not code_verifier:
        return JsonResponse({"error": "PKCE verifier expired or invalid"}, status=400)
    redis_cache.delete(f"lichess_pkce_{nonce}")

    # Build redirect URI (must match auth request exactly)
    scheme = "https" if request.is_secure() else "http"
    host = request.get_host()
    redirect_uri = f"{scheme}://{host}/api/lichess/callback/"

    # Exchange code + verifier for access token
    token_data = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": code_verifier,
            "redirect_uri": redirect_uri,
            "client_id": CLIENT_ID,
        }
    ).encode()

    token_req = urllib.request.Request(
        LICHESS_TOKEN_URL,
        data=token_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    try:
        with urllib.request.urlopen(token_req, timeout=10) as resp:
            token_resp = json.loads(resp.read())
    except Exception:
        logger.exception("Failed to exchange Lichess OAuth code")
        return HttpResponseRedirect(f"/plays?error={urllib.parse.quote('Failed to exchange OAuth code')}")

    access_token = token_resp.get("access_token")
    expires_in = token_resp.get("expires_in", 31536000)  # default ~1 year
    if not access_token:
        return HttpResponseRedirect(f"/plays?error={urllib.parse.quote('No access token received')}")

    # Fetch Lichess account for username
    account_req = urllib.request.Request(
        LICHESS_ACCOUNT_URL,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    try:
        with urllib.request.urlopen(account_req, timeout=10) as resp:
            account = json.loads(resp.read())
    except Exception:
        logger.exception("Failed to fetch Lichess account")
        return HttpResponseRedirect(f"/plays?error={urllib.parse.quote('Failed to fetch account info')}")

    username = account.get("username", "unknown")

    # Upsert: delete all existing, create new
    LichessToken.objects.all().delete()
    LichessToken.objects.create(
        access_token=access_token,
        lichess_username=username,
        expires_at=timezone.now() + timezone.timedelta(seconds=expires_in),
    )

    _last_sync = now
    return HttpResponseRedirect("/plays")


@require_admin
def lichess_token(request):
    """Return the stored Lichess access token (admin only)."""
    token = LichessToken.objects.first()
    if not token:
        return JsonResponse({"error": "Not connected"}, status=404)
    return JsonResponse(
        {
            "access_token": token.access_token,
            "username": token.lichess_username,
            "expires_at": token.expires_at.isoformat(),
        }
    )


def lichess_status(request):
    """Public endpoint: return whether a Lichess account is connected."""
    token = LichessToken.objects.first()
    if token:
        return JsonResponse({"connected": True, "username": token.lichess_username})
    return JsonResponse({"connected": False, "username": None})
```

- [ ] **Step 4: Register views in views/__init__.py**

Add to `website/views/__init__.py`:

```python
from .lichess import lichess_auth, lichess_callback, lichess_status, lichess_token
```

Add all 4 to `__all__`.

- [ ] **Step 5: Add URL routes**

Add to `website/urls.py`:

```python
    path("lichess/auth/", views.lichess_auth),
    path("lichess/callback/", views.lichess_callback),
    path("lichess/token/", views.lichess_token),
    path("lichess/status/", views.lichess_status),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_lichess.py -v`
Expected: All tests PASS

- [ ] **Step 7: Run full backend test suite**

Run: `uv run pytest -v`
Expected: All existing tests still pass

- [ ] **Step 8: Commit**

```bash
git add website/views/lichess.py website/views/__init__.py website/urls.py website/tests/test_lichess.py
git commit -m "feat(lichess): add OAuth PKCE views + token/status endpoints"
```

---

## Task 3: Install Chessground + chessops, Remove Old Libraries

**Files:**
- Modify: `frontend/package.json` (via pnpm commands)

- [ ] **Step 1: Remove old chess libraries**

```bash
cd /home/namle685/projects/nam-website/.claude/worktrees/lichess-integration/frontend
pnpm remove react-chessboard chess.js
```

- [ ] **Step 2: Install new chess libraries**

```bash
pnpm add chessground chessops
```

- [ ] **Step 3: Verify installation**

```bash
pnpm ls chessground chessops
```

Expected: Both packages listed with versions.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml
git commit -m "chore: swap react-chessboard/chess.js for chessground/chessops"
```

---

## Task 4: ChessgroundBoard React Wrapper

**Files:**
- Create: `frontend/src/components/ChessgroundBoard.css`
- Create: `frontend/src/components/ChessgroundBoard.tsx`

- [ ] **Step 1: Create Chessground CSS overrides**

Create `frontend/src/components/ChessgroundBoard.css`:

```css
/*
 * Chessground dark theme overrides for nam685.de
 * Import AFTER chessground/assets/chessground.base.css
 */

.cg-wrap {
  --cg-dark: #164e63;
  --cg-light: #1e293b;
}

/* Board square colors */
cg-board square.dark {
  background-color: #164e63;
}
cg-board square.light {
  background-color: #1e293b;
}

/* Last move highlight */
cg-board square.last-move {
  background-color: rgba(6, 182, 212, 0.2);
}

/* Selected square */
cg-board square.selected {
  background-color: rgba(6, 182, 212, 0.35);
}

/* Move destination dots */
cg-board square.move-dest {
  background: radial-gradient(rgba(6, 182, 212, 0.4) 22%, transparent 22%);
}
cg-board square.move-dest.oc {
  background: radial-gradient(transparent 0%, transparent 80%, rgba(6, 182, 212, 0.3) 80%);
}

/* Check highlight */
cg-board square.check {
  background: radial-gradient(
    ellipse at center,
    rgba(255, 0, 0, 0.6) 0%,
    rgba(255, 0, 0, 0.3) 40%,
    transparent 70%
  );
}

/* Promotion dialog */
cg-board square.premove-dest {
  background-color: rgba(6, 182, 212, 0.15);
}

/* Coordinates */
.cg-wrap coords {
  color: #555;
  font-family: var(--font-headline);
  font-size: 0.6rem;
  text-transform: lowercase;
}
```

- [ ] **Step 2: Create ChessgroundBoard component**

Create `frontend/src/components/ChessgroundBoard.tsx`:

```tsx
"use client";

import { useRef, useEffect, useCallback } from "react";
import { Chessground } from "chessground";
import type { Api as CgApi } from "chessground/api";
import type { Config } from "chessground/config";
import type { Key, Color } from "chessground/types";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import "./ChessgroundBoard.css";

export interface ChessgroundBoardProps {
  fen: string;
  orientation: Color;
  turnColor: Color;
  onMove?: (orig: Key, dest: Key) => void;
  movable?: {
    free: boolean;
    dests?: Map<Key, Key[]>;
    color?: Color | "both";
  };
  lastMove?: [Key, Key];
  check?: Key | boolean;
  premovable?: boolean;
  viewOnly?: boolean;
}

export default function ChessgroundBoard({
  fen,
  orientation,
  turnColor,
  onMove,
  movable,
  lastMove,
  check,
  premovable = false,
  viewOnly = false,
}: ChessgroundBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const cgRef = useRef<CgApi | null>(null);

  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  // Create Chessground on mount
  useEffect(() => {
    if (!boardRef.current) return;

    const config: Config = {
      fen,
      orientation,
      turnColor,
      coordinates: true,
      movable: {
        free: movable?.free ?? false,
        color: movable?.color ?? turnColor,
        dests: movable?.dests,
        showDests: true,
      },
      lastMove: lastMove ? [lastMove[0], lastMove[1]] : undefined,
      check: check ?? false,
      premovable: { enabled: premovable },
      viewOnly,
      animation: { enabled: true, duration: 150 },
      events: {
        move: (orig: Key, dest: Key) => {
          onMoveRef.current?.(orig, dest);
        },
      },
    };

    const cg = Chessground(boardRef.current, config);
    cgRef.current = cg;

    return () => {
      cg.destroy();
      cgRef.current = null;
    };
    // Only run on mount — updates handled by the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update Chessground on prop changes
  useEffect(() => {
    if (!cgRef.current) return;
    cgRef.current.set({
      fen,
      orientation,
      turnColor,
      movable: {
        free: movable?.free ?? false,
        color: movable?.color ?? turnColor,
        dests: movable?.dests,
        showDests: true,
      },
      lastMove: lastMove ? [lastMove[0], lastMove[1]] : undefined,
      check: check ?? false,
      premovable: { enabled: premovable },
      viewOnly,
    });
  }, [fen, orientation, turnColor, movable, lastMove, check, premovable, viewOnly]);

  return (
    <div
      ref={boardRef}
      style={{
        width: "min(400px, 90vw)",
        aspectRatio: "1",
        border: "1px solid color-mix(in srgb, #06b6d4 30%, #1a1a1a)",
        borderRadius: "4px",
      }}
    />
  );
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd /home/namle685/projects/nam-website/.claude/worktrees/lichess-integration/frontend
pnpm build 2>&1 | head -20
```

Note: Build may warn about unused ChessgroundBoard — that's fine, it'll be used in the next tasks.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ChessgroundBoard.tsx frontend/src/components/ChessgroundBoard.css
git commit -m "feat(lichess): add ChessgroundBoard React wrapper with dark theme"
```

---

## Task 5: Lichess API Helpers + Frontend Types

**Files:**
- Create: `frontend/src/lib/lichessApi.ts`
- Create: `frontend/src/lib/__tests__/lichessApi.test.ts`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Write tests for stream parsing and explorer helpers**

Create `frontend/src/lib/__tests__/lichessApi.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { parseNdJsonStream, buildExplorerUrl } from "../lichessApi";

describe("parseNdJsonStream", () => {
  it("parses newline-delimited JSON events", async () => {
    const events: unknown[] = [];
    const lines = '{"type":"gameFull","id":"abc"}\n{"type":"gameState","moves":"e2e4"}\n';
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(lines));
        controller.close();
      },
    });

    await parseNdJsonStream(stream, (event) => events.push(event));

    expect(events).toEqual([
      { type: "gameFull", id: "abc" },
      { type: "gameState", moves: "e2e4" },
    ]);
  });

  it("handles chunked data across read boundaries", async () => {
    const events: unknown[] = [];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"game'));
        controller.enqueue(encoder.encode('Full"}\n'));
        controller.close();
      },
    });

    await parseNdJsonStream(stream, (event) => events.push(event));

    expect(events).toEqual([{ type: "gameFull" }]);
  });

  it("skips empty lines (keepalive)", async () => {
    const events: unknown[] = [];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('\n\n{"type":"gameState"}\n\n'));
        controller.close();
      },
    });

    await parseNdJsonStream(stream, (event) => events.push(event));

    expect(events).toEqual([{ type: "gameState" }]);
  });
});

describe("buildExplorerUrl", () => {
  it("builds masters URL", () => {
    const url = buildExplorerUrl("masters", "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
    expect(url).toContain("explorer.lichess.org/masters");
    expect(url).toContain("fen=");
  });

  it("builds lichess URL with rating filter", () => {
    const url = buildExplorerUrl(
      "lichess",
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      { ratings: [2000, 2200] },
    );
    expect(url).toContain("explorer.lichess.org/lichess");
    expect(url).toContain("ratings=2000%2C2200");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && pnpm test -- --run src/lib/__tests__/lichessApi.test.ts`
Expected: Cannot find module `../lichessApi`

- [ ] **Step 3: Create lichessApi.ts**

Create `frontend/src/lib/lichessApi.ts`:

```typescript
/**
 * Lichess API helpers: ND-JSON stream parsing, Board API, Opening Explorer.
 */

/* ── ND-JSON Stream Parser ─────────────────────────── */

export async function parseNdJsonStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (line.trim()) {
        onEvent(JSON.parse(line));
      }
    }
  }
  // Flush remaining buffer
  if (buffer.trim()) {
    onEvent(JSON.parse(buffer));
  }
}

/* ── Board API ─────────────────────────────────────── */

const LICHESS = "https://lichess.org";

export function lichessHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, Accept: "application/x-ndjson" };
}

/** Stream account events (gameStart, gameFinish, challenge) */
export function streamEvents(token: string): Promise<Response> {
  return fetch(`${LICHESS}/api/stream/event`, {
    headers: lichessHeaders(token),
  });
}

/** Stream a board game */
export function streamBoardGame(token: string, gameId: string): Promise<Response> {
  return fetch(`${LICHESS}/api/board/game/stream/${gameId}`, {
    headers: lichessHeaders(token),
  });
}

/** Send a move (UCI notation, e.g. "e2e4") */
export function sendMove(token: string, gameId: string, uci: string): Promise<Response> {
  return fetch(`${LICHESS}/api/board/game/${gameId}/move/${uci}`, {
    method: "POST",
    headers: lichessHeaders(token),
  });
}

/** Resign a game */
export function resignGame(token: string, gameId: string): Promise<Response> {
  return fetch(`${LICHESS}/api/board/game/${gameId}/resign`, {
    method: "POST",
    headers: lichessHeaders(token),
  });
}

/** Offer or accept a draw */
export function offerDraw(token: string, gameId: string, accept: "yes" | "no"): Promise<Response> {
  return fetch(`${LICHESS}/api/board/game/${gameId}/draw/${accept}`, {
    method: "POST",
    headers: lichessHeaders(token),
  });
}

/** Abort a game (only if < 2 moves played) */
export function abortGame(token: string, gameId: string): Promise<Response> {
  return fetch(`${LICHESS}/api/board/game/${gameId}/abort`, {
    method: "POST",
    headers: lichessHeaders(token),
  });
}

/** Challenge a specific player */
export function challengePlayer(
  token: string,
  username: string,
  opts: { clock?: { limit: number; increment: number }; color?: "white" | "black" | "random"; rated?: boolean },
): Promise<Response> {
  const body: Record<string, string> = {};
  if (opts.clock) {
    body["clock.limit"] = String(opts.clock.limit);
    body["clock.increment"] = String(opts.clock.increment);
  }
  if (opts.color) body.color = opts.color;
  if (opts.rated !== undefined) body.rated = String(opts.rated);

  return fetch(`${LICHESS}/api/challenge/${username}`, {
    method: "POST",
    headers: { ...lichessHeaders(token), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

/** Create an open challenge (returns a URL others can join) */
export function createOpenChallenge(
  token: string,
  opts: { clock?: { limit: number; increment: number }; rated?: boolean },
): Promise<Response> {
  const body: Record<string, string> = {};
  if (opts.clock) {
    body["clock.limit"] = String(opts.clock.limit);
    body["clock.increment"] = String(opts.clock.increment);
  }
  if (opts.rated !== undefined) body.rated = String(opts.rated);

  return fetch(`${LICHESS}/api/challenge/open`, {
    method: "POST",
    headers: { ...lichessHeaders(token), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

/** Seek a random opponent */
export function seekOpponent(
  token: string,
  opts: { time: number; increment: number; rated?: boolean },
): Promise<Response> {
  const body: Record<string, string> = {
    time: String(opts.time / 60), // Lichess expects minutes
    increment: String(opts.increment),
  };
  if (opts.rated !== undefined) body.rated = String(opts.rated);

  return fetch(`${LICHESS}/api/board/seek`, {
    method: "POST",
    headers: { ...lichessHeaders(token), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

/* ── Opening Explorer ──────────────────────────────── */

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating: number;
}

export interface ExplorerResponse {
  opening: { eco: string; name: string } | null;
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  topGames?: { id: string; white: { name: string; rating: number }; black: { name: string; rating: number } }[];
}

export type ExplorerDb = "masters" | "lichess";

export function buildExplorerUrl(
  db: ExplorerDb,
  fen: string,
  opts?: { ratings?: number[]; speeds?: string[] },
): string {
  const base = `https://explorer.lichess.org/${db}`;
  const params = new URLSearchParams({ fen });
  if (opts?.ratings?.length) params.set("ratings", opts.ratings.join(","));
  if (opts?.speeds?.length) params.set("speeds", opts.speeds.join(","));
  return `${base}?${params}`;
}

/** Session cache to avoid re-fetching the same position */
const explorerCache = new Map<string, ExplorerResponse>();

export async function fetchExplorer(
  db: ExplorerDb,
  fen: string,
  opts?: { ratings?: number[]; speeds?: string[] },
): Promise<ExplorerResponse | null> {
  const url = buildExplorerUrl(db, fen, opts);
  const cached = explorerCache.get(url);
  if (cached) return cached;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data: ExplorerResponse = await resp.json();
    explorerCache.set(url, data);
    return data;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Add LichessStatus type to api.ts**

Add to `frontend/src/lib/api.ts`:

```typescript
export interface LichessStatus {
  connected: boolean;
  username: string | null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && pnpm test -- --run src/lib/__tests__/lichessApi.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/lichessApi.ts frontend/src/lib/__tests__/lichessApi.test.ts frontend/src/lib/api.ts
git commit -m "feat(lichess): add Lichess API helpers + Opening Explorer client"
```

---

## Task 6: Opening Explorer Component

**Files:**
- Create: `frontend/src/components/OpeningExplorer.tsx`

This replaces the book-moves panel from ChessTrainer with live data from `explorer.lichess.org`. Uses chessops for legal move generation and ChessgroundBoard for the board.

- [ ] **Step 1: Create OpeningExplorer component**

Create `frontend/src/components/OpeningExplorer.tsx`:

```tsx
"use client";

import { useState, useCallback, useEffect } from "react";
import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { chessgroundDests } from "chessops/compat";
import type { Key } from "chessground/types";
import ChessgroundBoard from "./ChessgroundBoard";
import { fetchExplorer, type ExplorerResponse, type ExplorerDb } from "@/lib/lichessApi";
import { lookupPosition } from "@/lib/chessOpenings";

const ACCENT = "#06b6d4";
const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

interface HistoryEntry {
  san: string;
  uci: string;
  fen: string;
}

export default function OpeningExplorer() {
  const [position, setPosition] = useState<Chess>(Chess.default());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [explorerDb, setExplorerDb] = useState<ExplorerDb>("masters");
  const [explorerData, setExplorerData] = useState<ExplorerResponse | null>(null);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [ratingFilter, setRatingFilter] = useState<number[]>([]);

  const fen = makeFen(position.toSetup());
  const turnColor = position.turn === "white" ? "white" : "black";
  const lastMove = history.length > 0 ? (history[history.length - 1].uci.match(/.{2}/g) as [Key, Key]) : undefined;
  const isCheck = position.isCheck();
  const dests = chessgroundDests(position);

  // Fallback opening info from static database
  const sanHistory = history.map((h) => h.san);
  const fallbackLookup = lookupPosition(sanHistory);

  // Fetch explorer data when position changes
  useEffect(() => {
    setExplorerLoading(true);
    const opts = explorerDb === "lichess" && ratingFilter.length > 0 ? { ratings: ratingFilter } : undefined;
    fetchExplorer(explorerDb, fen, opts).then((data) => {
      setExplorerData(data);
      setExplorerLoading(false);
    });
  }, [fen, explorerDb, ratingFilter]);

  const makeMove = useCallback(
    (orig: Key, dest: Key) => {
      const uci = `${orig}${dest}`;
      const move = parseUci(uci);
      if (!move) return;

      const pos = position.clone();
      const san = makeSan(pos, move);
      pos.play(move);

      setPosition(pos);
      setHistory((h) => [...h, { san, uci, fen: makeFen(pos.toSetup()) }]);
    },
    [position],
  );

  const playExplorerMove = useCallback(
    (uci: string) => {
      const move = parseUci(uci);
      if (!move) return;

      const pos = position.clone();
      const san = makeSan(pos, move);
      pos.play(move);

      setPosition(pos);
      setHistory((h) => [...h, { san, uci, fen: makeFen(pos.toSetup()) }]);
    },
    [position],
  );

  function reset() {
    setPosition(Chess.default());
    setHistory([]);
  }

  function takeback() {
    if (history.length === 0) return;
    const newHistory = history.slice(0, -1);
    // Rebuild position from scratch
    const pos = Chess.default();
    for (const entry of newHistory) {
      const move = parseUci(entry.uci);
      if (move) pos.play(move);
    }
    setPosition(pos);
    setHistory(newHistory);
  }

  // Opening name: prefer explorer data, fall back to static db
  const openingName = explorerData?.opening?.name ?? fallbackLookup.opening?.name ?? "Starting Position";
  const openingEco = explorerData?.opening?.eco ?? fallbackLookup.opening?.eco ?? "---";
  const moves = explorerData?.moves ?? [];
  const totalGames = explorerData ? explorerData.white + explorerData.draws + explorerData.black : 0;

  return (
    <div
      style={{
        display: "flex",
        gap: "2rem",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "flex-start",
      }}
    >
      {/* Board + controls */}
      <div style={{ flexShrink: 0 }}>
        <ChessgroundBoard
          fen={fen}
          orientation={orientation}
          turnColor={turnColor}
          onMove={makeMove}
          movable={{ free: false, dests, color: "both" }}
          lastMove={lastMove}
          check={isCheck}
        />

        {/* Controls */}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
          <button onClick={reset} style={btnStyle}>
            Reset
          </button>
          <button onClick={takeback} style={btnStyle} disabled={history.length === 0}>
            Takeback
          </button>
          <button onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))} style={btnStyle}>
            Flip
          </button>
        </div>

        {/* Move history */}
        {history.length > 0 && (
          <div
            style={{
              marginTop: "0.75rem",
              padding: "0.5rem 0.75rem",
              background: "#131313",
              border: "1px solid #1a1a1a",
              borderRadius: "4px",
              fontSize: "0.8rem",
              color: "#aaa",
              fontFamily: "var(--font-headline)",
              letterSpacing: "0.02em",
              lineHeight: 1.8,
            }}
          >
            {history.map((h, i) =>
              i % 2 === 0 ? (
                <span key={i}>
                  <span style={{ color: "#555" }}>{Math.floor(i / 2) + 1}.</span> {h.san}{" "}
                </span>
              ) : (
                <span key={i}>{h.san} </span>
              ),
            )}
          </div>
        )}
      </div>

      {/* Explorer panel */}
      <div style={{ flex: "1 1 280px", minWidth: "280px", maxWidth: "400px" }}>
        {/* Opening name */}
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "#131313",
            border: `1px solid color-mix(in srgb, ${ACCENT} 25%, #1a1a1a)`,
            borderRadius: "4px",
            marginBottom: "1rem",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.65rem",
              color: ACCENT,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: "0.25rem",
            }}
          >
            {openingEco}
          </div>
          <div style={{ fontFamily: "var(--font-headline)", fontSize: "0.95rem", fontWeight: 600 }}>
            {openingName}
          </div>
          {totalGames > 0 && (
            <div style={{ fontSize: "0.7rem", color: "#555", marginTop: "0.25rem" }}>
              {totalGames.toLocaleString()} games
            </div>
          )}
        </div>

        {/* Database toggle */}
        <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.75rem" }}>
          {(["masters", "lichess"] as const).map((db) => (
            <button
              key={db}
              onClick={() => setExplorerDb(db)}
              style={{
                ...btnStyle,
                background: explorerDb === db ? ACCENT : "#131313",
                color: explorerDb === db ? "#0e0e0e" : ACCENT,
                fontWeight: explorerDb === db ? 700 : 400,
              }}
            >
              {db === "masters" ? "Masters" : "Lichess"}
            </button>
          ))}
        </div>

        {/* Rating filter (Lichess DB only) */}
        {explorerDb === "lichess" && (
          <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            {[1600, 1800, 2000, 2200, 2500].map((r) => (
              <button
                key={r}
                onClick={() =>
                  setRatingFilter((f) => (f.includes(r) ? f.filter((x) => x !== r) : [...f, r]))
                }
                style={{
                  ...btnStyle,
                  fontSize: "0.6rem",
                  padding: "0.25rem 0.5rem",
                  background: ratingFilter.includes(r) ? "rgba(6,182,212,0.15)" : "#131313",
                  borderColor: ratingFilter.includes(r)
                    ? "rgba(6,182,212,0.4)"
                    : "#1a1a1a",
                }}
              >
                {r}+
              </button>
            ))}
          </div>
        )}

        {/* Explorer moves header */}
        <div
          style={{
            fontFamily: "var(--font-headline)",
            fontSize: "0.65rem",
            color: "#555",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: "0.5rem",
          }}
        >
          {explorerLoading ? "Loading..." : `Moves (${moves.length})`}
        </div>

        {/* Explorer move rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {moves.map((m) => {
            const total = m.white + m.draws + m.black;
            const wp = total > 0 ? (m.white / total) * 100 : 0;
            const dp = total > 0 ? (m.draws / total) * 100 : 0;
            const bp = total > 0 ? (m.black / total) * 100 : 0;

            return (
              <button
                key={m.uci}
                onClick={() => playExplorerMove(m.uci)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.45rem 0.75rem",
                  background: "#131313",
                  border: "1px solid #1a1a1a",
                  borderRadius: "3px",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                  color: "#e5e2e1",
                  fontFamily: "var(--font-headline)",
                  fontSize: "0.85rem",
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = `color-mix(in srgb, ${ACCENT} 50%, #1a1a1a)`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#1a1a1a";
                }}
              >
                {/* Move name */}
                <span style={{ fontWeight: 700, minWidth: "3rem" }}>{m.san}</span>
                {/* Game count */}
                <span style={{ fontSize: "0.65rem", color: "#777", minWidth: "4rem" }}>
                  {total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total}
                </span>
                {/* Win/draw/loss bar */}
                <div
                  style={{
                    flex: 1,
                    height: "6px",
                    borderRadius: "3px",
                    overflow: "hidden",
                    display: "flex",
                    background: "#1a1a1a",
                  }}
                >
                  <div style={{ width: `${wp}%`, background: "#e5e2e1" }} />
                  <div style={{ width: `${dp}%`, background: "#555" }} />
                  <div style={{ width: `${bp}%`, background: "#2a2a2a" }} />
                </div>
              </button>
            );
          })}
        </div>

        {/* Fallback: show static book moves if explorer has no data */}
        {moves.length === 0 && !explorerLoading && fallbackLookup.bookMoves.length > 0 && (
          <>
            <div
              style={{
                fontFamily: "var(--font-headline)",
                fontSize: "0.6rem",
                color: "#444",
                marginTop: "0.75rem",
                marginBottom: "0.25rem",
              }}
            >
              Offline book ({fallbackLookup.bookMoves.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              {fallbackLookup.bookMoves.map((san) => (
                <button
                  key={san}
                  onClick={() => {
                    /* Would need SAN→UCI conversion — skip for offline fallback.
                       Users can just click the board. */
                  }}
                  style={{
                    ...btnStyle,
                    width: "100%",
                    textAlign: "left",
                    fontWeight: 700,
                    fontSize: "0.85rem",
                  }}
                >
                  {san}
                </button>
              ))}
            </div>
          </>
        )}

        {moves.length === 0 && !explorerLoading && fallbackLookup.bookMoves.length === 0 && (
          <p style={{ fontSize: "0.8rem", color: "#555", fontStyle: "italic" }}>
            {history.length === 0 ? "Make a move to begin." : "No data for this position."}
          </p>
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.7rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
  padding: "0.4rem 0.8rem",
  background: "#131313",
  color: ACCENT,
  border: `1px solid color-mix(in srgb, ${ACCENT} 30%, #1a1a1a)`,
  borderRadius: "3px",
  cursor: "pointer",
  transition: "background 0.15s, border-color 0.15s",
};
```

**Note:** The chessops API has been verified: `Chess.default()` (starting position), `parseUci` from `chessops/util`, `makeSan` from `chessops/san`, `makeFen` from `chessops/fen`, `chessgroundDests` from `chessops/compat`, `.clone()`, `.play(move)` (mutating), `.isCheck()` → boolean. If any type errors occur at build time, consult the installed chessops source.

- [ ] **Step 2: Verify the component compiles**

```bash
cd /home/namle685/projects/nam-website/.claude/worktrees/lichess-integration/frontend
pnpm build 2>&1 | tail -20
```

Fix any type errors from chessops API differences. The key functions to verify:
- `Chess.default()` — creates starting position
- `chessgroundDests(pos)` — returns `Map<Key, Key[]>` for legal moves
- `parseUci(uci)` — parses a UCI string into a Move
- `makeSan(pos, move)` — gets SAN notation for a move
- `makeFen(pos.toSetup())` — converts position to FEN string
- `pos.clone()` — clones the position
- `pos.play(move)` — applies a move (mutating)
- `pos.isCheck()` — returns boolean

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/OpeningExplorer.tsx
git commit -m "feat(lichess): add live Opening Explorer with Masters/Lichess toggle"
```

---

## Task 7: Live Game Component

**Files:**
- Create: `frontend/src/components/LichessGame.tsx`

This component handles streaming a live Board API game: board display, clocks, move sending, and game actions.

- [ ] **Step 1: Create LichessGame component**

Create `frontend/src/components/LichessGame.tsx`:

```tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { chessgroundDests } from "chessops/compat";
import type { Key, Color } from "chessground/types";
import ChessgroundBoard from "./ChessgroundBoard";
import {
  parseNdJsonStream,
  streamBoardGame,
  sendMove,
  resignGame,
  abortGame,
  offerDraw,
} from "@/lib/lichessApi";

const ACCENT = "#06b6d4";

interface Player {
  name: string;
  rating: number;
}

interface GameState {
  moves: string; // space-separated UCI
  wtime: number;
  btime: number;
  winc: number;
  binc: number;
  status: string;
  winner?: string;
  wdraw?: boolean;
  bdraw?: boolean;
}

interface Props {
  token: string;
  gameId: string;
  myColor: Color;
  onGameEnd: () => void;
}

export default function LichessGame({ token, gameId, myColor, onGameEnd }: Props) {
  const [position, setPosition] = useState<Chess>(Chess.default());
  const [moveList, setMoveList] = useState<string[]>([]);
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [whitePlayer, setWhitePlayer] = useState<Player | null>(null);
  const [blackPlayer, setBlackPlayer] = useState<Player | null>(null);
  const [wtime, setWtime] = useState(0);
  const [btime, setBtime] = useState(0);
  const [status, setStatus] = useState("Connecting...");
  const [gameOver, setGameOver] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const turnColor = position.turn === "white" ? "white" : "black";
  const isMyTurn = turnColor === myColor;
  const fen = makeFen(position.toSetup());
  const dests = isMyTurn ? chessgroundDests(position) : new Map();
  const isCheck = position.isCheck();

  // Apply a moves string (space-separated UCI) to build current position
  const applyMoves = useCallback((movesStr: string) => {
    const ucis = movesStr.trim() ? movesStr.trim().split(" ") : [];
    const pos = Chess.default();
    const moves: string[] = [];
    let last: [Key, Key] | undefined;

    for (const uci of ucis) {
      const move = parseUci(uci);
      if (move) {
        pos.play(move);
        moves.push(uci);
        last = [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key];
      }
    }

    setPosition(pos);
    setMoveList(moves);
    setLastMove(last);
  }, []);

  // Stream the game
  useEffect(() => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    (async () => {
      try {
        const resp = await streamBoardGame(token, gameId);
        if (!resp.body) return;

        await parseNdJsonStream(resp.body, (event: Record<string, unknown>) => {
          if (event.type === "gameFull") {
            // Initial full game state
            const wp = event.white as Record<string, unknown> | undefined;
            const bp = event.black as Record<string, unknown> | undefined;
            if (wp) setWhitePlayer({ name: (wp.name ?? wp.id ?? "?") as string, rating: (wp.rating ?? 0) as number });
            if (bp) setBlackPlayer({ name: (bp.name ?? bp.id ?? "?") as string, rating: (bp.rating ?? 0) as number });

            const state = event.state as GameState;
            applyMoves(state.moves);
            setWtime(state.wtime);
            setBtime(state.btime);
            updateStatus(state);
          } else if (event.type === "gameState") {
            const state = event as unknown as GameState;
            applyMoves(state.moves);
            setWtime(state.wtime);
            setBtime(state.btime);
            updateStatus(state);
          }
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          setStatus("Connection lost");
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [token, gameId, applyMoves]);

  function updateStatus(state: GameState) {
    if (state.status === "started" || state.status === "created") {
      setStatus("");
      setGameOver(false);
    } else {
      const result =
        state.winner === myColor ? "You won!" : state.winner ? "You lost." : "Draw.";
      setStatus(`Game over — ${result} (${state.status})`);
      setGameOver(true);
    }
  }

  async function handleMove(orig: Key, dest: Key) {
    const uci = `${orig}${dest}`;
    // Optimistically apply
    applyMoves([...moveList, uci].join(" "));
    // Send to Lichess
    const resp = await sendMove(token, gameId, uci);
    if (!resp.ok) {
      // Revert on failure — stream will send correct state
      applyMoves(moveList.join(" "));
    }
  }

  function formatTime(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  const topPlayer = myColor === "white" ? blackPlayer : whitePlayer;
  const bottomPlayer = myColor === "white" ? whitePlayer : blackPlayer;
  const topTime = myColor === "white" ? btime : wtime;
  const bottomTime = myColor === "white" ? wtime : btime;

  return (
    <div
      style={{
        display: "flex",
        gap: "2rem",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "flex-start",
      }}
    >
      {/* Board + clocks */}
      <div style={{ flexShrink: 0 }}>
        {/* Top player + clock */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <span style={{ fontFamily: "var(--font-headline)", fontSize: "0.8rem", color: "#aaa" }}>
            {topPlayer ? `${topPlayer.name} (${topPlayer.rating})` : "Opponent"}
          </span>
          <span
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.9rem",
              fontWeight: 700,
              color: turnColor !== myColor ? ACCENT : "#555",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatTime(topTime)}
          </span>
        </div>

        <ChessgroundBoard
          fen={fen}
          orientation={myColor}
          turnColor={turnColor}
          onMove={handleMove}
          movable={{ free: false, dests, color: isMyTurn ? myColor : undefined }}
          lastMove={lastMove}
          check={isCheck}
          premovable={true}
          viewOnly={gameOver}
        />

        {/* Bottom player + clock */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.5rem" }}>
          <span style={{ fontFamily: "var(--font-headline)", fontSize: "0.8rem", color: "#aaa" }}>
            {bottomPlayer ? `${bottomPlayer.name} (${bottomPlayer.rating})` : "You"}
          </span>
          <span
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.9rem",
              fontWeight: 700,
              color: turnColor === myColor ? ACCENT : "#555",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatTime(bottomTime)}
          </span>
        </div>

        {/* Status */}
        {status && (
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.8rem",
              color: ACCENT,
              fontFamily: "var(--font-headline)",
            }}
          >
            {status}
          </p>
        )}
      </div>

      {/* Game actions panel */}
      <div style={{ flex: "1 1 200px", minWidth: "200px", maxWidth: "280px" }}>
        {!gameOver && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {moveList.length < 2 && (
              <button onClick={() => abortGame(token, gameId)} style={btnStyle}>
                Abort
              </button>
            )}
            <button onClick={() => resignGame(token, gameId)} style={btnStyle}>
              Resign
            </button>
            <button onClick={() => offerDraw(token, gameId, "yes")} style={btnStyle}>
              Offer Draw
            </button>
          </div>
        )}

        {gameOver && (
          <button onClick={onGameEnd} style={{ ...btnStyle, background: ACCENT, color: "#0e0e0e", fontWeight: 700 }}>
            New Game
          </button>
        )}

        {/* Move history */}
        {moveList.length > 0 && (
          <div
            style={{
              marginTop: "1rem",
              padding: "0.5rem 0.75rem",
              background: "#131313",
              border: "1px solid #1a1a1a",
              borderRadius: "4px",
              fontSize: "0.75rem",
              color: "#aaa",
              fontFamily: "var(--font-headline)",
              lineHeight: 1.8,
              maxHeight: "200px",
              overflowY: "auto",
            }}
          >
            {moveList.map((uci, i) =>
              i % 2 === 0 ? (
                <span key={i}>
                  <span style={{ color: "#555" }}>{Math.floor(i / 2) + 1}.</span> {uci}{" "}
                </span>
              ) : (
                <span key={i}>{uci} </span>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.7rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "0.5rem 1rem",
  background: "#131313",
  color: ACCENT,
  border: `1px solid color-mix(in srgb, ${ACCENT} 30%, #1a1a1a)`,
  borderRadius: "3px",
  cursor: "pointer",
  transition: "background 0.15s",
  width: "100%",
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /home/namle685/projects/nam-website/.claude/worktrees/lichess-integration/frontend
pnpm build 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/LichessGame.tsx
git commit -m "feat(lichess): add live game component with Board API streaming"
```

---

## Task 8: Game Creation Panel

**Files:**
- Create: `frontend/src/components/LichessGameCreator.tsx`

- [ ] **Step 1: Create LichessGameCreator component**

Create `frontend/src/components/LichessGameCreator.tsx`:

```tsx
"use client";

import { useState } from "react";
import {
  challengePlayer,
  createOpenChallenge,
  seekOpponent,
  parseNdJsonStream,
  streamEvents,
} from "@/lib/lichessApi";

const ACCENT = "#06b6d4";

type GameMode = "challenge" | "open" | "seek";

const TIME_PRESETS = [
  { label: "10+0", limit: 600, increment: 0 },
  { label: "15+10", limit: 900, increment: 10 },
  { label: "30+0", limit: 1800, increment: 0 },
];

interface Props {
  token: string;
  onGameStart: (gameId: string, myColor: "white" | "black") => void;
}

export default function LichessGameCreator({ token, onGameStart }: Props) {
  const [mode, setMode] = useState<GameMode>("challenge");
  const [username, setUsername] = useState("");
  const [timePreset, setTimePreset] = useState(0);
  const [customLimit, setCustomLimit] = useState(600);
  const [customIncrement, setCustomIncrement] = useState(0);
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [color, setColor] = useState<"white" | "black" | "random">("random");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openChallengeUrl, setOpenChallengeUrl] = useState("");

  const clock = useCustomTime
    ? { limit: customLimit, increment: customIncrement }
    : { limit: TIME_PRESETS[timePreset].limit, increment: TIME_PRESETS[timePreset].increment };

  async function waitForGameStart(): Promise<void> {
    const resp = await streamEvents(token);
    if (!resp.body) return;

    return new Promise((resolve) => {
      parseNdJsonStream(resp.body!, (event: Record<string, unknown>) => {
        if (event.type === "gameStart") {
          const game = event.game as Record<string, unknown>;
          const gameId = game.gameId ?? game.id;
          const myColor = (game.color ?? "white") as "white" | "black";
          onGameStart(gameId as string, myColor);
          resolve();
        }
      });
    });
  }

  async function handleCreate() {
    setLoading(true);
    setError("");
    setOpenChallengeUrl("");

    try {
      if (mode === "challenge") {
        if (!username.trim()) {
          setError("Enter a username");
          setLoading(false);
          return;
        }
        const resp = await challengePlayer(token, username.trim(), { clock, color, rated: false });
        if (!resp.ok) {
          const body = await resp.json().catch(() => null);
          setError(body?.error ?? `Failed (${resp.status})`);
          setLoading(false);
          return;
        }
        await waitForGameStart();
      } else if (mode === "open") {
        const resp = await createOpenChallenge(token, { clock, rated: false });
        if (!resp.ok) {
          setError("Failed to create open challenge");
          setLoading(false);
          return;
        }
        const data = await resp.json();
        setOpenChallengeUrl(data.challenge?.url ?? data.url ?? "");
        await waitForGameStart();
      } else {
        seekOpponent(token, { time: clock.limit, increment: clock.increment, rated: false });
        await waitForGameStart();
      }
    } catch {
      setError("Connection failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        maxWidth: "400px",
        margin: "0 auto",
        padding: "1.5rem",
        background: "#131313",
        border: `1px solid color-mix(in srgb, ${ACCENT} 20%, #1a1a1a)`,
        borderRadius: "4px",
      }}
    >
      {/* Mode tabs */}
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "1.25rem" }}>
        {(
          [
            ["challenge", "Challenge"],
            ["open", "Open"],
            ["seek", "Find"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              ...tabStyle,
              borderColor: mode === m ? ACCENT : "transparent",
              color: mode === m ? ACCENT : "#555",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Challenge-specific: username */}
      {mode === "challenge" && (
        <div style={{ marginBottom: "1rem" }}>
          <label style={labelStyle}>Opponent username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="lichess username"
            style={inputStyle}
          />
        </div>
      )}

      {/* Time control */}
      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Time control</label>
        <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.5rem" }}>
          {TIME_PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => {
                setTimePreset(i);
                setUseCustomTime(false);
              }}
              style={{
                ...tabStyle,
                borderColor: !useCustomTime && timePreset === i ? ACCENT : "#1a1a1a",
                color: !useCustomTime && timePreset === i ? ACCENT : "#777",
              }}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setUseCustomTime(true)}
            style={{
              ...tabStyle,
              borderColor: useCustomTime ? ACCENT : "#1a1a1a",
              color: useCustomTime ? ACCENT : "#777",
            }}
          >
            Custom
          </button>
        </div>
        {useCustomTime && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <div>
              <label style={{ ...labelStyle, fontSize: "0.55rem" }}>Minutes</label>
              <input
                type="number"
                min={1}
                max={180}
                value={customLimit / 60}
                onChange={(e) => setCustomLimit(Number(e.target.value) * 60)}
                style={{ ...inputStyle, width: "4rem" }}
              />
            </div>
            <div>
              <label style={{ ...labelStyle, fontSize: "0.55rem" }}>Increment (s)</label>
              <input
                type="number"
                min={0}
                max={60}
                value={customIncrement}
                onChange={(e) => setCustomIncrement(Number(e.target.value))}
                style={{ ...inputStyle, width: "4rem" }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Color (for challenge mode) */}
      {mode === "challenge" && (
        <div style={{ marginBottom: "1rem" }}>
          <label style={labelStyle}>Play as</label>
          <div style={{ display: "flex", gap: "0.25rem" }}>
            {(["random", "white", "black"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  ...tabStyle,
                  borderColor: color === c ? ACCENT : "#1a1a1a",
                  color: color === c ? ACCENT : "#777",
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Create button */}
      <button
        onClick={handleCreate}
        disabled={loading}
        style={{
          ...tabStyle,
          width: "100%",
          padding: "0.6rem",
          background: loading ? "#1a1a1a" : ACCENT,
          color: loading ? "#555" : "#0e0e0e",
          fontWeight: 700,
          borderColor: ACCENT,
          cursor: loading ? "wait" : "pointer",
        }}
      >
        {loading ? "Waiting for opponent..." : "Create Game"}
      </button>

      {/* Open challenge URL */}
      {openChallengeUrl && (
        <div
          style={{
            marginTop: "0.75rem",
            padding: "0.5rem",
            background: "#0e0e0e",
            borderRadius: "3px",
            fontSize: "0.7rem",
            color: "#aaa",
            wordBreak: "break-all",
          }}
        >
          Share this link:{" "}
          <a href={openChallengeUrl} target="_blank" rel="noopener noreferrer" style={{ color: ACCENT }}>
            {openChallengeUrl}
          </a>
        </div>
      )}

      {/* Error */}
      {error && (
        <p style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#ef4444" }}>{error}</p>
      )}
    </div>
  );
}

const tabStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.65rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "0.4rem 0.75rem",
  background: "transparent",
  border: "1px solid transparent",
  borderBottom: "2px solid transparent",
  borderRadius: "3px",
  cursor: "pointer",
  transition: "color 0.15s, border-color 0.15s",
};

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.6rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "#555",
  display: "block",
  marginBottom: "0.3rem",
};

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.85rem",
  padding: "0.4rem 0.6rem",
  background: "#0e0e0e",
  color: "#e5e2e1",
  border: "1px solid #1a1a1a",
  borderRadius: "3px",
  outline: "none",
  width: "100%",
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /home/namle685/projects/nam-website/.claude/worktrees/lichess-integration/frontend
pnpm build 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/LichessGameCreator.tsx
git commit -m "feat(lichess): add game creation panel with challenge/open/seek modes"
```

---

## Task 9: Plays Page — Tab Layout + Integration

**Files:**
- Modify: `frontend/src/app/plays/PlaysClient.tsx`
- Delete (effectively replaced): reference to old `ChessTrainer` component

This task rewires PlaysClient to have Explorer and Play tabs, loads the new components, and detects admin status.

- [ ] **Step 1: Rewrite PlaysClient.tsx**

Replace the contents of `frontend/src/app/plays/PlaysClient.tsx` with:

```tsx
"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { API } from "@/lib/api";
import type { LichessStatus } from "@/lib/api";
import { store } from "@/lib/auth";

const OpeningExplorer = dynamic(() => import("@/components/OpeningExplorer"), { ssr: false });
const LichessGame = dynamic(() => import("@/components/LichessGame"), { ssr: false });
const LichessGameCreator = dynamic(() => import("@/components/LichessGameCreator"), { ssr: false });

const ACCENT = "#06b6d4";

type Tab = "explorer" | "play";

export default function PlaysClient() {
  const [tab, setTab] = useState<Tab>("explorer");
  const [isAdmin, setIsAdmin] = useState(false);
  const [lichessStatus, setLichessStatus] = useState<LichessStatus | null>(null);
  const [lichessToken, setLichessToken] = useState<string | null>(null);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [myColor, setMyColor] = useState<"white" | "black">("white");

  // Check admin status
  useEffect(() => {
    const token = store("adminToken");
    if (!token) return;

    fetch(`${API}/api/auth/check/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (r.ok) setIsAdmin(true);
      })
      .catch(() => {});
  }, []);

  // Fetch Lichess connection status
  useEffect(() => {
    fetch(`${API}/api/lichess/status/`)
      .then((r) => r.json())
      .then((data: LichessStatus) => setLichessStatus(data))
      .catch(() => {});
  }, []);

  // Fetch Lichess token when admin switches to Play tab
  useEffect(() => {
    if (!isAdmin || tab !== "play") return;
    const adminToken = store("adminToken");
    if (!adminToken) return;

    fetch(`${API}/api/lichess/token/`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
      .then((r) => {
        if (r.ok) return r.json();
        return null;
      })
      .then((data) => {
        if (data?.access_token) setLichessToken(data.access_token);
      })
      .catch(() => {});
  }, [isAdmin, tab]);

  function handleConnect() {
    const adminToken = store("adminToken");
    if (adminToken) {
      window.location.href = `${API}/api/lichess/auth/?token=${adminToken}`;
    }
  }

  function handleGameStart(gameId: string, color: "white" | "black") {
    setActiveGameId(gameId);
    setMyColor(color);
  }

  function handleGameEnd() {
    setActiveGameId(null);
  }

  return (
    <div className="page" style={{ maxWidth: "72rem", position: "relative", zIndex: 1 }}>
      <h1>Plays</h1>
      <p>Explore chess openings with live data, or play a game on Lichess.</p>

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: "0.25rem",
          marginTop: "1rem",
          marginBottom: "1.5rem",
          borderBottom: "1px solid #1a1a1a",
        }}
      >
        <button
          onClick={() => setTab("explorer")}
          style={{
            ...tabBtnStyle,
            borderBottomColor: tab === "explorer" ? ACCENT : "transparent",
            color: tab === "explorer" ? ACCENT : "#555",
          }}
        >
          Explorer
        </button>
        {isAdmin && (
          <button
            onClick={() => setTab("play")}
            style={{
              ...tabBtnStyle,
              borderBottomColor: tab === "play" ? ACCENT : "transparent",
              color: tab === "play" ? ACCENT : "#555",
            }}
          >
            Play
            {lichessStatus?.connected && (
              <span
                style={{
                  display: "inline-block",
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "#22c55e",
                  marginLeft: "0.4rem",
                }}
              />
            )}
          </button>
        )}
      </div>

      {/* Explorer tab */}
      {tab === "explorer" && <OpeningExplorer />}

      {/* Play tab */}
      {tab === "play" && isAdmin && (
        <>
          {/* Lichess connection status */}
          <div style={{ marginBottom: "1.5rem" }}>
            {lichessStatus?.connected ? (
              <span style={{ fontSize: "0.75rem", color: "#aaa", fontFamily: "var(--font-headline)" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "#22c55e",
                    marginRight: "0.4rem",
                  }}
                />
                Connected as{" "}
                <span style={{ color: ACCENT }}>{lichessStatus.username}</span>
              </span>
            ) : (
              <button onClick={handleConnect} style={connectBtnStyle}>
                Connect Lichess
              </button>
            )}
          </div>

          {/* Game area */}
          {lichessToken ? (
            activeGameId ? (
              <LichessGame
                token={lichessToken}
                gameId={activeGameId}
                myColor={myColor}
                onGameEnd={handleGameEnd}
              />
            ) : (
              <LichessGameCreator token={lichessToken} onGameStart={handleGameStart} />
            )
          ) : (
            !lichessStatus?.connected && (
              <p style={{ fontSize: "0.8rem", color: "#555", fontStyle: "italic" }}>
                Connect your Lichess account to play games.
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}

const tabBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.7rem",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  padding: "0.5rem 1rem",
  background: "transparent",
  border: "none",
  borderBottom: "2px solid transparent",
  cursor: "pointer",
  transition: "color 0.15s, border-color 0.15s",
};

const connectBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.7rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "0.4rem 0.8rem",
  background: "#06b6d4",
  color: "#0e0e0e",
  border: "none",
  borderRadius: "3px",
  cursor: "pointer",
  fontWeight: 700,
};
```

- [ ] **Step 2: Delete the old ChessTrainer component**

The `ChessTrainer.tsx` component is no longer imported. Delete it:

```bash
rm frontend/src/components/ChessTrainer.tsx
```

- [ ] **Step 3: Verify the build**

```bash
cd /home/namle685/projects/nam-website/.claude/worktrees/lichess-integration/frontend
pnpm build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/plays/PlaysClient.tsx
git rm frontend/src/components/ChessTrainer.tsx
git commit -m "feat(lichess): plays page with Explorer/Play tabs, wire up all components"
```

---

## Task 10: Visual Verification

Use Playwright screenshots to verify the UI looks correct before pushing.

- [ ] **Step 1: Start dev servers**

```bash
cd /home/namle685/projects/nam-website/.claude/worktrees/lichess-integration
docker compose up -d
uv run python manage.py migrate
```

Start backend and frontend dev servers (may already be running).

- [ ] **Step 2: Take screenshots of the /plays page**

Navigate to `http://localhost:3001/plays` with Playwright and take a screenshot:
- Explorer tab with starting position (board + explorer panel)
- After making a move (e.g., e2e4) — should show explorer data

- [ ] **Step 3: Fix any visual issues**

Compare screenshots to the design spec. Fix styling issues (board sizing, panel layout, colors).

- [ ] **Step 4: Commit any fixes**

```bash
git add -u
git commit -m "fix: visual polish for plays page"
```

---

## Task 11: Backend + Frontend Tests

- [ ] **Step 1: Run all backend tests**

```bash
cd /home/namle685/projects/nam-website/.claude/worktrees/lichess-integration
uv run pytest -v
```

Expected: All tests pass.

- [ ] **Step 2: Run all frontend tests**

```bash
cd /home/namle685/projects/nam-website/.claude/worktrees/lichess-integration/frontend
pnpm test -- --run
```

Expected: All tests pass.

- [ ] **Step 3: Run linters**

```bash
cd /home/namle685/projects/nam-website/.claude/worktrees/lichess-integration
uvx ruff check . && uvx ruff format --check .
cd frontend && pnpm lint
```

Expected: No lint errors.

---

## Task 12: Documentation

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/QA-CHECKLIST.md`

- [ ] **Step 1: Update docs/README.md**

Add a section under the `/plays` page description:

```markdown
### Plays — Chess Explorer & Live Games
The plays page features a chess opening explorer powered by live data from the Lichess Opening Explorer API. Users can navigate opening lines and see move statistics (game count, win/draw/loss percentages) from both the Masters database and all rated Lichess games. Toggle between databases and filter by rating bracket.

Admin users can connect their Lichess account via OAuth to play live games directly from the page using the Lichess Board API. Game modes include challenging a specific player, creating an open challenge link, or seeking a random opponent.
```

- [ ] **Step 2: Add QA items to docs/QA-CHECKLIST.md**

```markdown
### Plays Page — Lichess Integration
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
```

- [ ] **Step 3: Commit**

```bash
git add docs/README.md docs/QA-CHECKLIST.md
git commit -m "docs: add Lichess integration to README and QA checklist"
```

---

## Task 13: Final Verification + Ship

- [ ] **Step 1: Run full test suite one final time**

```bash
cd /home/namle685/projects/nam-website/.claude/worktrees/lichess-integration
uv run pytest -v
cd frontend && pnpm test -- --run && pnpm build
```

- [ ] **Step 2: Ship**

Run `/ship` to push, poll CI, and open a PR.
