# Bets Ticker Search Autocomplete — Design Spec

## Problem

Adding a ticker to the bets dashboard requires filling 6 fields manually (symbol, name, asset_type, provider, provider_id, currency). The user already knows which ticker they want — the app should search and autofill.

## Solution

Replace the multi-field add form with a single search input. As the user types (e.g., "vwce"), the backend searches Alpha Vantage and CoinGecko in parallel and returns unified suggestions. The user picks one and it's added immediately. Bonds are pre-seeded (no search needed for ECB series).

## Scope

- Backend search endpoint proxying Alpha Vantage SYMBOL_SEARCH + CoinGecko /search
- Frontend: single input with debounced typeahead dropdown, one-click add
- Add popular bond/bond ETF tickers to seed data
- Out of scope: ticker discovery, browsing, ECB search

---

## Backend

### New endpoint

`GET /api/bets/search/?q=vwce` — admin-only, requires auth.

Behavior:
1. Reject if `q` is less than 2 characters (return 400)
2. Search Alpha Vantage `SYMBOL_SEARCH` and CoinGecko `/search` in parallel (using `httpx.AsyncClient` or sequential with short timeouts)
3. Map results to a unified format
4. Deduplicate by symbol (Alpha Vantage wins on collision since it covers more asset types)
5. Exclude symbols that already exist in the Ticker table
6. Return top 8 results sorted by match score

Response format:
```json
[
  {
    "symbol": "VWCE.DE",
    "name": "Vanguard FTSE All-World UCITS ETF USD Acc",
    "asset_type": "stock",
    "provider": "alpha_vantage",
    "provider_id": "VWCE.DE",
    "currency": "EUR",
    "source": "alpha_vantage"
  },
  {
    "symbol": "BTC",
    "name": "Bitcoin",
    "asset_type": "crypto",
    "provider": "coingecko",
    "provider_id": "bitcoin",
    "currency": "USD",
    "source": "coingecko"
  }
]
```

### New service methods

**`website/services/alpha_vantage.py` — `search_alpha_vantage(query: str) -> list[dict]`**

Calls `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords={query}&apikey={key}`.

Response mapping:
- `symbol` ← `1. symbol`
- `name` ← `2. name`
- `asset_type` ← map `3. type`: "Equity" → "stock", "ETF" → "stock", "Mutual Fund" → "stock", "Cryptocurrency" → skip (CoinGecko handles crypto)
- `provider` ← `"alpha_vantage"`
- `provider_id` ← `1. symbol`
- `currency` ← `8. currency`
- `match_score` ← `9. matchScore` (float, for sorting)

Timeout: 5 seconds. On failure, return empty list (don't block CoinGecko results).

**`website/services/coingecko.py` — `search_coingecko(query: str) -> list[dict]`**

Calls `https://api.coingecko.com/api/v3/search?query={query}`.

Response mapping (from `coins` array, first 5 items):
- `symbol` ← `symbol` (uppercased)
- `name` ← `name`
- `asset_type` ← `"crypto"`
- `provider` ← `"coingecko"`
- `provider_id` ← `id` (e.g., "bitcoin")
- `currency` ← `"USD"`
- `match_score` ← index-based (first result = 1.0, decaying)

Timeout: 5 seconds. On failure, return empty list.

### View

Add `bets_search` to `website/views/bets.py`:
- Decorated with `@require_GET` and `@require_admin`
- Reads `q` from query params
- Calls both search functions (sequentially is fine — they're fast and this is admin-only)
- Merges results, excludes existing symbols, returns top 8

### URL

Add to `website/urls.py`: `GET /api/bets/search/` → `bets_search`

---

## Frontend

### Replace add form

Current: "+" button toggles a 6-field form with inputs/selects.

New: "+" button toggles a single search input. As the user types:
1. Debounce 300ms
2. `GET /api/bets/search/?q={input}` with auth header
3. Show dropdown below input with results (each row: symbol bold, name dimmed, asset_type tag)
4. Click a result → `POST /api/bets/create/` with all fields from the search result → close form, refresh tickers
5. Clicking outside or pressing Escape closes the dropdown
6. Show "Searching..." while loading, "No results" if empty

No intermediate field review. The search result has all data needed to create the ticker.

### Interaction details

- Min 2 chars to trigger search
- Dropdown max height ~200px with overflow scroll
- Each result row: `VWCE.DE` (bold) — `Vanguard FTSE All-World...` (dimmed) — `stock` (small tag)
- Hover highlight on rows
- Keyboard: arrow keys to navigate, Enter to select (stretch goal, not required)

---

## Seed Data

Add popular bond ETFs to `fixtures/seed.example.json`:

| Symbol | Name | Provider | Provider ID | Currency |
|--------|------|----------|-------------|----------|
| EU10Y | Euro 10Y Govt Bond Yield | ecb | FM.M.U2.EUR.4F.BB.U2_10Y.YLD | % |
| IBGL.DE | iShares EUR Govt Bond 15-30yr | alpha_vantage | IBGL.DE | EUR |
| VGEA.DE | Vanguard EUR Eurozone Govt Bond | alpha_vantage | VGEA.DE | EUR |

EU10Y already exists in seed. Add IBGL.DE and VGEA.DE as bond-type tickers using Alpha Vantage (they're ETFs that track bonds, so they have stock-like symbols searchable via Alpha Vantage, but we set asset_type to "bond" for display).

---

## Testing

### Backend tests (in `website/tests/test_bets.py`)

- `test_search_requires_auth` — 401 without token
- `test_search_rejects_short_query` — 400 for q < 2 chars
- `test_search_returns_results` — mock both provider search functions, verify unified format
- `test_search_excludes_existing_tickers` — create a ticker, verify it's excluded from results
- `test_search_alpha_vantage` — mock httpx, verify mapping from AV response format
- `test_search_coingecko` — mock httpx, verify mapping from CG response format
- `test_search_handles_provider_failure` — mock one provider to fail, verify other results still returned

---

## CLAUDE.md Updates

Add `GET /api/bets/search/?q=...` to the API endpoints list.

## QA Checklist Updates

Add:
- Admin: search input appears when clicking "+ Add Ticker"
- Typing "vwce" shows stock results with autofill
- Typing "bitcoin" shows crypto results
- Clicking a result adds the ticker immediately
- Already-tracked tickers don't appear in results
