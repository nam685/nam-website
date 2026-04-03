# Bets Ticker Search Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 6-field add-ticker form with a single search input that autocompletes from Alpha Vantage and CoinGecko, then adds the ticker in one click.

**Architecture:** New backend endpoint `GET /api/bets/search/?q=...` proxies search to Alpha Vantage SYMBOL_SEARCH + CoinGecko /search, maps results to unified format, excludes already-tracked symbols. Frontend replaces multi-field form with debounced typeahead dropdown. Selecting a result calls existing `POST /api/bets/create/`.

**Tech Stack:** Python/Django (backend search endpoint), httpx (provider API calls), React/TypeScript (frontend typeahead)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `website/services/alpha_vantage.py` | Modify | Add `search_alpha_vantage(query)` function |
| `website/services/coingecko.py` | Modify | Add `search_coingecko(query)` function |
| `website/services/__init__.py` | Modify | Export new search functions |
| `website/views/bets.py` | Modify | Add `bets_search` view |
| `website/views/__init__.py` | Modify | Export `bets_search` |
| `website/urls.py` | Modify | Add search URL route |
| `website/tests/test_bets.py` | Modify | Add search tests |
| `frontend/src/lib/api.ts` | Modify | Add `BetsSearchResult` type |
| `frontend/src/app/bets/page.tsx` | Modify | Replace add form with search typeahead |
| `fixtures/seed.example.json` | Modify | Add bond ETF tickers |
| `CLAUDE.md` | Modify | Add search endpoint to API list |
| `docs/QA-CHECKLIST.md` | Modify | Add search QA items |

---

### Task 1: Alpha Vantage search adapter

**Files:**
- Modify: `website/services/alpha_vantage.py`
- Modify: `website/tests/test_bets.py`

- [ ] **Step 1: Write the failing test**

Add to `website/tests/test_bets.py`, after the existing `TestAlphaVantageAdapter` class:

```python
class TestAlphaVantageSearch:
    @patch("website.services.alpha_vantage.httpx.get")
    def test_search_returns_mapped_results(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "bestMatches": [
                    {
                        "1. symbol": "VWCE.DE",
                        "2. name": "Vanguard FTSE All-World UCITS ETF USD Acc",
                        "3. type": "ETF",
                        "4. region": "Frankfurt",
                        "8. currency": "EUR",
                        "9. matchScore": "1.0000",
                    },
                    {
                        "1. symbol": "VWC.L",
                        "2. name": "Vanguard FTSE 100 UCITS ETF",
                        "3. type": "ETF",
                        "4. region": "London",
                        "8. currency": "GBP",
                        "9. matchScore": "0.6000",
                    },
                ]
            },
        )
        from website.services.alpha_vantage import search_alpha_vantage

        results = search_alpha_vantage("vwce")
        assert len(results) == 2
        assert results[0]["symbol"] == "VWCE.DE"
        assert results[0]["name"] == "Vanguard FTSE All-World UCITS ETF USD Acc"
        assert results[0]["asset_type"] == "stock"
        assert results[0]["provider"] == "alpha_vantage"
        assert results[0]["provider_id"] == "VWCE.DE"
        assert results[0]["currency"] == "EUR"
        assert results[0]["match_score"] == 1.0

    @patch("website.services.alpha_vantage.httpx.get")
    def test_search_skips_crypto_type(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "bestMatches": [
                    {
                        "1. symbol": "BTC",
                        "2. name": "Bitcoin",
                        "3. type": "Cryptocurrency",
                        "4. region": "United States",
                        "8. currency": "USD",
                        "9. matchScore": "1.0000",
                    },
                ]
            },
        )
        from website.services.alpha_vantage import search_alpha_vantage

        results = search_alpha_vantage("btc")
        assert len(results) == 0

    @patch("website.services.alpha_vantage.httpx.get")
    def test_search_handles_api_failure(self, mock_get):
        mock_get.side_effect = Exception("API down")
        from website.services.alpha_vantage import search_alpha_vantage

        results = search_alpha_vantage("vwce")
        assert results == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_bets.py::TestAlphaVantageSearch -v`
Expected: FAIL — `ImportError: cannot import name 'search_alpha_vantage'`

- [ ] **Step 3: Implement `search_alpha_vantage`**

Add to `website/services/alpha_vantage.py` after the existing `fetch_alpha_vantage` function:

```python
_AV_TYPE_MAP = {
    "Equity": "stock",
    "ETF": "stock",
    "Mutual Fund": "stock",
}


def search_alpha_vantage(query: str) -> list[dict]:
    """Search Alpha Vantage SYMBOL_SEARCH for stocks/ETFs. Returns unified result dicts."""
    api_key = os.environ.get("ALPHA_VANTAGE_API_KEY", "")
    try:
        resp = httpx.get(
            BASE_URL,
            params={"function": "SYMBOL_SEARCH", "keywords": query, "apikey": api_key},
            timeout=5,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    results = []
    for match in data.get("bestMatches", []):
        av_type = match.get("3. type", "")
        asset_type = _AV_TYPE_MAP.get(av_type)
        if asset_type is None:
            continue
        symbol = match.get("1. symbol", "")
        results.append(
            {
                "symbol": symbol,
                "name": match.get("2. name", ""),
                "asset_type": asset_type,
                "provider": "alpha_vantage",
                "provider_id": symbol,
                "currency": match.get("8. currency", "USD"),
                "match_score": float(match.get("9. matchScore", "0")),
            }
        )
    return results
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_bets.py::TestAlphaVantageSearch -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add website/services/alpha_vantage.py website/tests/test_bets.py
git commit -m "feat(bets): add Alpha Vantage symbol search adapter"
```

---

### Task 2: CoinGecko search adapter

**Files:**
- Modify: `website/services/coingecko.py`
- Modify: `website/tests/test_bets.py`

- [ ] **Step 1: Write the failing test**

Add to `website/tests/test_bets.py`, after `TestCoinGeckoAdapter`:

```python
class TestCoinGeckoSearch:
    @patch("website.services.coingecko.httpx.get")
    def test_search_returns_mapped_results(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "coins": [
                    {"id": "bitcoin", "name": "Bitcoin", "symbol": "btc"},
                    {"id": "ethereum", "name": "Ethereum", "symbol": "eth"},
                    {"id": "bitcoin-cash", "name": "Bitcoin Cash", "symbol": "bch"},
                ]
            },
        )
        from website.services.coingecko import search_coingecko

        results = search_coingecko("bitcoin")
        assert len(results) == 3
        assert results[0]["symbol"] == "BTC"
        assert results[0]["name"] == "Bitcoin"
        assert results[0]["asset_type"] == "crypto"
        assert results[0]["provider"] == "coingecko"
        assert results[0]["provider_id"] == "bitcoin"
        assert results[0]["currency"] == "USD"
        assert results[0]["match_score"] == 1.0
        assert results[2]["match_score"] < 1.0

    @patch("website.services.coingecko.httpx.get")
    def test_search_limits_to_five(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "coins": [{"id": f"coin-{i}", "name": f"Coin {i}", "symbol": f"C{i}"} for i in range(10)]
            },
        )
        from website.services.coingecko import search_coingecko

        results = search_coingecko("coin")
        assert len(results) == 5

    @patch("website.services.coingecko.httpx.get")
    def test_search_handles_api_failure(self, mock_get):
        mock_get.side_effect = Exception("API down")
        from website.services.coingecko import search_coingecko

        results = search_coingecko("bitcoin")
        assert results == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_bets.py::TestCoinGeckoSearch -v`
Expected: FAIL — `ImportError: cannot import name 'search_coingecko'`

- [ ] **Step 3: Implement `search_coingecko`**

Add to `website/services/coingecko.py` after the existing `fetch_coingecko` function:

```python
def search_coingecko(query: str) -> list[dict]:
    """Search CoinGecko for cryptocurrencies. Returns unified result dicts."""
    try:
        resp = httpx.get(f"{BASE_URL}/search", params={"query": query}, timeout=5)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    results = []
    for i, coin in enumerate(data.get("coins", [])[:5]):
        results.append(
            {
                "symbol": coin.get("symbol", "").upper(),
                "name": coin.get("name", ""),
                "asset_type": "crypto",
                "provider": "coingecko",
                "provider_id": coin.get("id", ""),
                "currency": "USD",
                "match_score": round(1.0 - i * 0.15, 2),
            }
        )
    return results
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_bets.py::TestCoinGeckoSearch -v`
Expected: 3 passed

- [ ] **Step 5: Update `website/services/__init__.py` to export new functions**

Replace the contents of `website/services/__init__.py` with:

```python
from .alpha_vantage import fetch_alpha_vantage, search_alpha_vantage
from .coingecko import fetch_coingecko, search_coingecko
from .ecb import fetch_ecb

PROVIDER_ADAPTERS = {
    "alpha_vantage": fetch_alpha_vantage,
    "coingecko": fetch_coingecko,
    "ecb": fetch_ecb,
}

__all__ = [
    "PROVIDER_ADAPTERS",
    "fetch_alpha_vantage",
    "fetch_coingecko",
    "fetch_ecb",
    "search_alpha_vantage",
    "search_coingecko",
]
```

- [ ] **Step 6: Commit**

```bash
git add website/services/coingecko.py website/services/__init__.py website/tests/test_bets.py
git commit -m "feat(bets): add CoinGecko search adapter"
```

---

### Task 3: Backend search endpoint

**Files:**
- Modify: `website/views/bets.py`
- Modify: `website/views/__init__.py`
- Modify: `website/urls.py`
- Modify: `website/tests/test_bets.py`

- [ ] **Step 1: Write the failing tests**

Add to `website/tests/test_bets.py` at the end:

```python
@pytest.mark.django_db
class TestBetsSearchEndpoint:
    def test_requires_auth(self, client):
        resp = client.get("/api/bets/search/?q=vwce")
        assert resp.status_code == 401

    def test_rejects_short_query(self, client, auth_headers):
        resp = client.get("/api/bets/search/?q=a", **auth_headers)
        assert resp.status_code == 400
        assert "least 2" in resp.json()["error"]

    @patch("website.views.bets.search_alpha_vantage")
    @patch("website.views.bets.search_coingecko")
    def test_returns_merged_results(self, mock_cg, mock_av, client, auth_headers):
        mock_av.return_value = [
            {
                "symbol": "VWCE.DE",
                "name": "Vanguard FTSE All-World",
                "asset_type": "stock",
                "provider": "alpha_vantage",
                "provider_id": "VWCE.DE",
                "currency": "EUR",
                "match_score": 1.0,
            }
        ]
        mock_cg.return_value = [
            {
                "symbol": "VGX",
                "name": "Voyager Token",
                "asset_type": "crypto",
                "provider": "coingecko",
                "provider_id": "ethos",
                "currency": "USD",
                "match_score": 0.5,
            }
        ]
        data = client.get("/api/bets/search/?q=vwce", **auth_headers).json()
        assert len(data) == 2
        assert data[0]["symbol"] == "VWCE.DE"
        assert data[1]["symbol"] == "VGX"

    @patch("website.views.bets.search_alpha_vantage")
    @patch("website.views.bets.search_coingecko")
    def test_excludes_existing_tickers(self, mock_cg, mock_av, client, auth_headers):
        Ticker.objects.create(
            symbol="BTC",
            name="Bitcoin",
            asset_type="crypto",
            provider="coingecko",
            provider_id="bitcoin",
        )
        mock_av.return_value = []
        mock_cg.return_value = [
            {
                "symbol": "BTC",
                "name": "Bitcoin",
                "asset_type": "crypto",
                "provider": "coingecko",
                "provider_id": "bitcoin",
                "currency": "USD",
                "match_score": 1.0,
            },
            {
                "symbol": "ETH",
                "name": "Ethereum",
                "asset_type": "crypto",
                "provider": "coingecko",
                "provider_id": "ethereum",
                "currency": "USD",
                "match_score": 0.85,
            },
        ]
        data = client.get("/api/bets/search/?q=btc", **auth_headers).json()
        assert len(data) == 1
        assert data[0]["symbol"] == "ETH"

    @patch("website.views.bets.search_alpha_vantage")
    @patch("website.views.bets.search_coingecko")
    def test_handles_provider_failure(self, mock_cg, mock_av, client, auth_headers):
        mock_av.side_effect = Exception("AV down")
        mock_cg.return_value = [
            {
                "symbol": "BTC",
                "name": "Bitcoin",
                "asset_type": "crypto",
                "provider": "coingecko",
                "provider_id": "bitcoin",
                "currency": "USD",
                "match_score": 1.0,
            }
        ]
        data = client.get("/api/bets/search/?q=btc", **auth_headers).json()
        assert len(data) == 1
        assert data[0]["symbol"] == "BTC"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_bets.py::TestBetsSearchEndpoint -v`
Expected: FAIL — 404 (URL not found yet)

- [ ] **Step 3: Implement `bets_search` view**

Add to `website/views/bets.py`:

1. Add import at top (after existing imports):
```python
from website.services import search_alpha_vantage, search_coingecko
```

2. Add the view function after `bets_sync_status`:
```python
@require_GET
@require_admin
def bets_search(request):
    """Admin: search for tickers across providers."""
    q = request.GET.get("q", "").strip()
    if len(q) < 2:
        return JsonResponse({"error": "Query must be at least 2 characters"}, status=400)

    av_results = search_alpha_vantage(q)
    cg_results = search_coingecko(q)

    existing_symbols = set(Ticker.objects.values_list("symbol", flat=True))

    seen = set()
    merged = []
    for item in sorted(av_results + cg_results, key=lambda x: x["match_score"], reverse=True):
        sym = item["symbol"]
        if sym in seen or sym in existing_symbols:
            continue
        seen.add(sym)
        merged.append(item)
        if len(merged) >= 8:
            break

    return JsonResponse(merged, safe=False)
```

- [ ] **Step 4: Wire up the URL and exports**

Add to `website/views/__init__.py` — in the `from .bets import (...)` block, add `bets_search` to the import list. Also add `"bets_search"` to the `__all__` list.

Add to `website/urls.py` — add this line after the existing `bets/sync-status/` route:
```python
path("bets/search/", views.bets_search),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_bets.py::TestBetsSearchEndpoint -v`
Expected: 5 passed

- [ ] **Step 6: Run full test suite**

Run: `uv run pytest website/tests/test_bets.py -v`
Expected: All tests pass (existing + new)

- [ ] **Step 7: Commit**

```bash
git add website/views/bets.py website/views/__init__.py website/urls.py website/tests/test_bets.py
git commit -m "feat(bets): add ticker search endpoint"
```

---

### Task 4: Frontend — replace add form with search typeahead

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/app/bets/page.tsx`

- [ ] **Step 1: Add `BetsSearchResult` type to `frontend/src/lib/api.ts`**

Add after the existing `BetsHistory` interface (line 178):

```typescript
export interface BetsSearchResult {
  symbol: string;
  name: string;
  asset_type: "stock" | "commodity" | "crypto" | "bond";
  provider: string;
  provider_id: string;
  currency: string;
  match_score: number;
}
```

- [ ] **Step 2: Replace state and handlers in `frontend/src/app/bets/page.tsx`**

In `BetsPage` component (starts at line 302), replace the add form state and handler. Remove these lines:

```typescript
const [showAddForm, setShowAddForm] = useState(false);
const [addForm, setAddForm] = useState({
  symbol: "",
  name: "",
  asset_type: "stock",
  provider: "alpha_vantage",
  provider_id: "",
  currency: "USD",
});
```

Replace with:

```typescript
const [showSearch, setShowSearch] = useState(false);
const [searchQuery, setSearchQuery] = useState("");
const [searchResults, setSearchResults] = useState<BetsSearchResult[]>([]);
const [searching, setSearching] = useState(false);
```

Also add the `BetsSearchResult` import at the top — update line 6:

```typescript
import type { BetsTicker, BetsHistory, BetsSearchResult } from "@/lib/api";
```

- [ ] **Step 3: Add debounced search effect**

Add this `useEffect` after the existing effects in `BetsPage`:

```typescript
useEffect(() => {
  if (searchQuery.length < 2) {
    setSearchResults([]);
    return;
  }
  setSearching(true);
  const timer = setTimeout(() => {
    const token = store("adminToken");
    fetch(`${API}/api/bets/search/?q=${encodeURIComponent(searchQuery)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSearchResults(data);
      })
      .catch(console.error)
      .finally(() => setSearching(false));
  }, 300);
  return () => clearTimeout(timer);
}, [searchQuery]);
```

- [ ] **Step 4: Replace `handleAdd` with `handleSelect`**

Remove the existing `handleAdd` function. Replace with:

```typescript
const handleSelect = async (result: BetsSearchResult) => {
  const token = store("adminToken");
  const resp = await fetch(`${API}/api/bets/create/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(result),
  });
  if (resp.ok) {
    setShowSearch(false);
    setSearchQuery("");
    setSearchResults([]);
    const r = await fetch(`${API}/api/bets/`);
    setTickers(await r.json());
  }
};
```

- [ ] **Step 5: Update the header button**

Find the "+ Add Ticker" button (around line 467). Change `onClick` from `() => setShowAddForm(!showAddForm)` to `() => setShowSearch(!showSearch)`.

- [ ] **Step 6: Replace the add form JSX with search typeahead**

Replace the entire `{/* Add ticker form */}` section (the `{showAddForm && (...)}` block, lines 500-620) with:

```tsx
{/* Search typeahead */}
{showSearch && (
  <div
    style={{
      border: `1px solid ${ACCENT}33`,
      padding: 12,
      marginBottom: 16,
      position: "relative",
    }}
  >
    <input
      autoFocus
      placeholder="Search ticker (e.g. VWCE, Bitcoin)..."
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      style={{
        background: "#111",
        border: "1px solid #333",
        color: "#eee",
        padding: "8px 12px",
        fontSize: 14,
        width: "100%",
        boxSizing: "border-box",
      }}
    />
    {searching && (
      <div style={{ fontSize: 12, color: "#555", marginTop: 8 }}>
        Searching...
      </div>
    )}
    {!searching && searchQuery.length >= 2 && searchResults.length === 0 && (
      <div style={{ fontSize: 12, color: "#555", marginTop: 8 }}>
        No results
      </div>
    )}
    {searchResults.length > 0 && (
      <div
        style={{
          marginTop: 4,
          maxHeight: 240,
          overflowY: "auto",
          border: "1px solid #222",
          background: "#0a0a0a",
        }}
      >
        {searchResults.map((r) => (
          <div
            key={`${r.provider}-${r.symbol}`}
            onClick={() => handleSelect(r)}
            style={{
              padding: "8px 12px",
              cursor: "pointer",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid #1a1a1a",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "#151515")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <div>
              <span
                style={{
                  fontWeight: 600,
                  color: "#eee",
                  fontSize: 14,
                }}
              >
                {r.symbol}
              </span>
              <span
                style={{
                  color: "#666",
                  fontSize: 12,
                  marginLeft: 8,
                }}
              >
                {r.name}
              </span>
            </div>
            <span
              style={{
                fontSize: 10,
                color: "#555",
                textTransform: "uppercase",
                letterSpacing: 1,
                border: "1px solid #333",
                padding: "2px 6px",
              }}
            >
              {r.asset_type}
            </span>
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 7: Build and verify**

Run from `frontend/`: `pnpm build`
Expected: Build succeeds with no errors

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/app/bets/page.tsx
git commit -m "feat(bets): replace add form with search typeahead"
```

---

### Task 5: Add bond ETF seed data

**Files:**
- Modify: `fixtures/seed.example.json`

- [ ] **Step 1: Add bond ETF tickers to seed data**

In `fixtures/seed.example.json`, add two new ticker entries after the existing EU10Y ticker (pk 4). Use pk 5 and 6:

```json
{
  "model": "website.ticker",
  "pk": 5,
  "fields": {
    "symbol": "IBGL.DE",
    "name": "iShares EUR Govt Bond 15-30yr",
    "asset_type": "bond",
    "provider": "alpha_vantage",
    "provider_id": "IBGL.DE",
    "currency": "EUR",
    "display_order": 4,
    "created_at": "2026-04-03T00:00:00Z"
  }
},
{
  "model": "website.ticker",
  "pk": 6,
  "fields": {
    "symbol": "VGEA.DE",
    "name": "Vanguard EUR Eurozone Govt Bond",
    "asset_type": "bond",
    "provider": "alpha_vantage",
    "provider_id": "VGEA.DE",
    "currency": "EUR",
    "display_order": 5,
    "created_at": "2026-04-03T00:00:00Z"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add fixtures/seed.example.json
git commit -m "feat(bets): add bond ETF tickers to seed data"
```

---

### Task 6: Update docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/QA-CHECKLIST.md`

- [ ] **Step 1: Add search endpoint to `CLAUDE.md`**

In `CLAUDE.md`, in the API Endpoints section, find the bets block. Add this line after `GET  /api/bets/sync-status/`:

```
GET  /api/bets/search/?q=...         auth required, searches Alpha Vantage + CoinGecko
```

- [ ] **Step 2: Add QA items to `docs/QA-CHECKLIST.md`**

In `docs/QA-CHECKLIST.md`, in the `## Bets (Market Dashboard)` section, replace the existing add ticker item with:

```markdown
- [ ] Admin: "+ Add Ticker" opens search input
- [ ] Typing "vwce" shows stock results from Alpha Vantage
- [ ] Typing "bitcoin" shows crypto results from CoinGecko
- [ ] Clicking a search result adds the ticker immediately
- [ ] Already-tracked tickers are excluded from search results
- [ ] Search shows "No results" for gibberish input
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/QA-CHECKLIST.md
git commit -m "docs: update API endpoints and QA checklist for bets search"
```

---

### Task 7: Run full test suite

- [ ] **Step 1: Run backend tests**

Run: `uv run pytest -v`
Expected: All tests pass

- [ ] **Step 2: Run frontend build**

Run from `frontend/`: `pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Run frontend lint**

Run from `frontend/`: `pnpm lint`
Expected: No errors
