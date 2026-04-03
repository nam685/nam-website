# Lichess Integration Design

Integrate Lichess into the `/plays` page: live gameplay via Board API (admin only) and a live opening explorer replacing the static database (public).

## Architecture: Hybrid (Backend OAuth, Frontend Streaming)

Django handles OAuth2 (PKCE) and stores the Lichess token. The frontend fetches the token via an admin-only endpoint and streams Board API directly from the browser. Opening Explorer calls go direct to `explorer.lichess.org` (public, no auth).

## 1. OAuth & Token Management

### Model: `LichessToken`

Single-row table (only one admin account).

| Field | Type | Notes |
|---|---|---|
| `access_token` | CharField(256) | Long-lived (~1 year) |
| `lichess_username` | CharField(64) | Fetched from `/api/account` after token exchange |
| `created_at` | DateTimeField(auto_now_add) | |
| `expires_at` | DateTimeField | `created_at + expires_in` from token response |

### OAuth Flow (PKCE, no client secret)

Lichess supports unregistered public clients. No app registration needed.

- `client_id`: `nam685.de`
- Scopes: `board:play challenge:write challenge:read`
- PKCE method: S256 only

**Views:**

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/lichess/auth/?token={adminToken}` | admin | Generate PKCE verifier/challenge, store verifier in Django session, redirect to `lichess.org/oauth` |
| `GET /api/lichess/callback/?code=...&state=...` | via state param | Exchange code + verifier for token, fetch `/api/account` for username, upsert `LichessToken`, redirect to `/plays` |
| `GET /api/lichess/token/` | admin | Return stored access token (frontend needs it for Board API) |
| `GET /api/lichess/status/` | public | Return `{ connected: bool, username: str|null }` (no token exposed) |

**PKCE flow:**
1. Admin clicks "Connect Lichess" -> hits `/api/lichess/auth/`
2. Backend generates `code_verifier` (random 64 chars), computes `code_challenge = BASE64URL(SHA256(verifier))`
3. Stores verifier in `request.session["lichess_code_verifier"]`
4. Redirects to `https://lichess.org/oauth?response_type=code&client_id=nam685.de&redirect_uri=.../api/lichess/callback/&code_challenge_method=S256&code_challenge=...&scope=board:play+challenge:write+challenge:read&state={adminToken}`
5. After user authorizes, Lichess redirects to callback with `code`
6. Backend POSTs to `https://lichess.org/api/token` with `grant_type=authorization_code&code=...&code_verifier=...&redirect_uri=...&client_id=nam685.de`
7. Response: `{ access_token, expires_in }`. Backend fetches `GET https://lichess.org/api/account` with Bearer token to get username.
8. Upserts `LichessToken` row, redirects to `/plays`

## 2. Live Gameplay (Board API)

All Board API interaction happens **in the browser** using the token fetched from `/api/lichess/token/`.

### Game Lifecycle

1. **Create game** — one of:
   - Challenge a player: `POST https://lichess.org/api/challenge/{username}` (time control, color, rated)
   - Open challenge: `POST https://lichess.org/api/challenge/open` (returns join URL)
   - Seek (matchmaking): `POST https://lichess.org/api/board/seek` (matched with random player)
2. **Wait for game start** — stream `GET https://lichess.org/api/stream/event` for `gameStart` event
3. **Play game** — stream `GET https://lichess.org/api/board/game/stream/{gameId}` for state updates, send moves via `POST https://lichess.org/api/board/game/{gameId}/move/{uci}`
4. **Game actions** — abort, resign, offer/accept draw, offer/accept takeback
5. **Game ends** — stream closes, return to game creation panel

### Streaming Implementation

Use `fetch()` + `ReadableStream` to consume ND-JSON:

```typescript
const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop()!;
  for (const line of lines) {
    if (line.trim()) onEvent(JSON.parse(line));
  }
}
```

### Game State

Frontend maintains game state from the stream:
- First event is `gameFull` — full game data (players, clocks, initial FEN, current moves)
- Subsequent events are `gameState` — updated moves string, clocks, status, draw/takeback offers
- Moves arrive as a space-separated UCI string (e.g., `"e2e4 e7e5 g1f3"`) — parse and replay on the board

### Time Controls

Board API supports rapid, classical, correspondence, and blitz (for direct challenges). Bullet/UltraBullet not allowed.

Default presets:
- 10+0 (rapid)
- 15+10 (rapid)
- 30+0 (classical)
- Custom input

## 3. Opening Explorer Upgrade

Replace the static `chessOpenings.ts` database with live data from `explorer.lichess.org`.

### API Calls (public, no auth, frontend-only)

| Database | Endpoint | Use |
|---|---|---|
| Masters | `GET https://explorer.lichess.org/masters?fen={fen}` | OTB master games |
| Lichess | `GET https://explorer.lichess.org/lichess?fen={fen}&speeds=...&ratings=...` | All rated Lichess games |

### Response Shape

```json
{
  "opening": { "eco": "C50", "name": "Italian Game" },
  "white": 12345, "draws": 6789, "black": 11234,
  "moves": [
    { "uci": "e2e4", "san": "e4", "white": 5000, "draws": 3000, "black": 4000 },
    ...
  ],
  "topGames": [{ "id": "abc123", "white": { "name": "...", "rating": 2700 }, ... }]
}
```

### UI Changes to Book Moves Panel

Each move shows statistics:
- SAN notation + game count + win/draw/loss bar (colored proportional bar)
- e.g., `e4 — 1.2M games (52% / 30% / 18%)`

Toggle between Masters and Lichess database. Optional rating bracket filter for Lichess database (1600, 1800, 2000, 2200, 2500).

### Caching & Fallback

- **Session cache:** `Map<string, ExplorerResponse>` keyed by FEN + database params. Avoids re-fetching the same position.
- **Fallback:** Keep `chessOpenings.ts` as offline fallback if Explorer API is unreachable. Show indicator for cached vs live data.

## 4. Chessground Integration

Replace `react-chessboard` and `chess.js` with Lichess's own libraries.

### Dependencies

- Remove: `react-chessboard`, `chess.js`
- Add: `chessground` (board UI), `chessops` (chess logic, FEN parsing, move validation)

### `ChessgroundBoard` React Component

Wraps the vanilla JS Chessground in React:

```typescript
interface ChessgroundBoardProps {
  fen: string;
  orientation: "white" | "black";
  turnColor: "white" | "black";
  onMove: (orig: string, dest: string) => void;
  movable: { free: boolean; dests?: Map<string, string[]> };
  lastMove?: [string, string];
  check?: string; // square of king in check
  premovable?: boolean;
}
```

- `useRef` for the container div, `useEffect` to create Chessground on mount
- Update via `cg.set(config)` on prop changes (not unmount/remount)
- Import Chessground base CSS, override with custom theme:
  - Dark squares: `#164e63`
  - Light squares: `#1e293b`
  - Last move highlight: cyan accent with low opacity
  - Selected square: cyan accent
  - Piece set: default Chessground pieces (cburnett)

### Usage in Both Modes

- **Explorer mode:** movable by current turn side, `onMove` triggers position update + explorer fetch. Uses `chessops` for legal move generation.
- **Live game mode:** movable only on your turn (controlled by `movable.dests`), `onMove` sends UCI to Lichess. Premoves enabled via `premovable`.

## 5. Page Layout & UX

### Tab Bar

Two tabs at the top of `/plays`, below the heading:

- **"Explorer"** — always visible, default active
- **"Play"** — only rendered when admin is logged in

Styling: uppercase monospace, cyan accent on active tab border-bottom, dim `#555` for inactive. Matches the site's aesthetic.

### Explorer Tab

- **Left:** Chessground board (400px max) + controls (reset, takeback, flip)
- **Right:** Opening name/ECO code + database toggle (Masters/Lichess) + book moves with statistics + optional rating filter
- **Below board:** Move history

### Play Tab (admin only)

**No game active — creation panel:**
- Three options: Challenge Player (username input), Open Challenge (generates link), Find Opponent (seek)
- Time control picker (presets + custom)
- Color picker (white / black / random)
- "Create Game" button

**Game active:**
- Chessground board with clocks above/below
- Opponent info (name, rating)
- Game actions: resign, offer draw, abort (if < 2 moves), request takeback
- Move history
- Status messages: "Waiting for opponent...", "Your turn", "Opponent's turn", etc.

**Game ended:**
- Result display (win/loss/draw + reason)
- "New Game" button to return to creation panel

### Lichess Connection Status

Small indicator in the Play tab header area: "Connected as nam685" (green dot) or "Not connected" with a "Connect" button. Only visible to admin.

## 6. New Backend Files

| File | Purpose |
|---|---|
| `website/models/lichess.py` | `LichessToken` model |
| `website/views/lichess.py` | OAuth views + token/status endpoints |
| `website/models/__init__.py` | Add `LichessToken` import |
| `website/views/__init__.py` | Add lichess view imports |
| `website/urls.py` | Add `/api/lichess/` routes |

## 7. New Frontend Files

| File | Purpose |
|---|---|
| `components/ChessgroundBoard.tsx` | React wrapper for Chessground |
| `components/ChessgroundBoard.css` | Custom theme overrides |
| `components/LichessGame.tsx` | Live game component (Board API streaming, moves, actions) |
| `components/LichessGameCreator.tsx` | Game creation panel (challenge/seek/open) |
| `components/OpeningExplorer.tsx` | Explorer panel with live stats |
| `app/plays/PlaysClient.tsx` | Updated: tab bar, mode switching, admin detection |
| `lib/lichessApi.ts` | Lichess API helpers (stream parsing, move sending, challenge creation) |
| `lib/chessOpenings.ts` | Kept as offline fallback |

## 8. Environment Variables

No new env vars needed. Lichess uses public client PKCE with no client secret.

The `client_id` (`nam685.de`) and redirect URI are hardcoded in the view (or configurable via settings if preferred).

## 9. Migration

One new migration for the `LichessToken` model.
