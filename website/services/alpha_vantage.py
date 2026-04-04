import os
from datetime import date, datetime, timedelta
from decimal import Decimal

import httpx

BASE_URL = "https://www.alphavantage.co/query"


def fetch_alpha_vantage(provider_id: str, days: int = 365) -> list[tuple[date, Decimal]]:
    """Fetch daily price history from Alpha Vantage using TIME_SERIES_DAILY."""
    api_key = os.environ.get("ALPHA_VANTAGE_API_KEY", "")
    cutoff = date.today() - timedelta(days=days)

    params = {
        "function": "TIME_SERIES_DAILY",
        "symbol": provider_id,
        "outputsize": "compact",
        "apikey": api_key,
    }
    series_key = "Time Series (Daily)"

    resp = httpx.get(BASE_URL, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    series = data.get(series_key, {})
    results = []
    for date_str, values in series.items():
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
        if d >= cutoff:
            results.append((d, Decimal(values["4. close"])))

    results.sort(key=lambda x: x[0])
    return results


_AV_TYPE_MAP = {
    "Equity": "stock",
    "ETF": "stock",
    "Mutual Fund": "stock",
}

_BOND_KEYWORDS = {"bond", "govt", "government", "treasury", "gilt", "sovereign", "fixed income"}
_COMMODITY_KEYWORDS = {"gold", "silver", "platinum", "palladium", "oil", "crude", "commodity", "natural gas"}


def _refine_asset_type(base_type: str, name: str) -> str:
    """Refine asset_type for ETFs based on name keywords (e.g. bond ETFs → 'bond')."""
    if base_type != "stock":
        return base_type
    lower = name.lower()
    if any(kw in lower for kw in _BOND_KEYWORDS):
        return "bond"
    if any(kw in lower for kw in _COMMODITY_KEYWORDS):
        return "commodity"
    return base_type


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
        name = match.get("2. name", "")
        asset_type = _refine_asset_type(asset_type, name)
        results.append(
            {
                "symbol": symbol,
                "name": name,
                "asset_type": asset_type,
                "provider": "alpha_vantage",
                "provider_id": symbol,
                "currency": match.get("8. currency", "USD"),
                "match_score": float(match.get("9. matchScore", "0")),
            }
        )
    return results
