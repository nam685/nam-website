from datetime import date, datetime, timezone
from decimal import Decimal

import httpx

BASE_URL = "https://api.coingecko.com/api/v3"


def fetch_coingecko(provider_id: str, days: int = 365) -> list[tuple[date, Decimal]]:
    """Fetch daily price history from CoinGecko."""
    resp = httpx.get(
        f"{BASE_URL}/coins/{provider_id}/market_chart",
        params={"vs_currency": "usd", "days": days, "interval": "daily"},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    results = []
    seen_dates: set[date] = set()
    for timestamp_ms, price in data.get("prices", []):
        d = datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).date()
        if d not in seen_dates:
            seen_dates.add(d)
            results.append((d, Decimal(str(price))))

    results.sort(key=lambda x: x[0])
    return results


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
