import os
from datetime import date, datetime, timedelta
from decimal import Decimal

import httpx

BASE_URL = "https://www.alphavantage.co/query"


def fetch_alpha_vantage(provider_id: str, days: int = 365) -> list[tuple[date, Decimal]]:
    """Fetch daily price history from Alpha Vantage.

    For provider_id starting with 'XAU', uses FX_DAILY (from_symbol=XAU, to_symbol=USD).
    Otherwise uses TIME_SERIES_DAILY for stocks/ETFs.
    """
    api_key = os.environ.get("ALPHA_VANTAGE_API_KEY", "")
    cutoff = date.today() - timedelta(days=days)

    if provider_id.startswith("XAU"):
        params = {
            "function": "FX_DAILY",
            "from_symbol": "XAU",
            "to_symbol": "USD",
            "outputsize": "full" if days > 100 else "compact",
            "apikey": api_key,
        }
        series_key = "Time Series FX (Daily)"
    else:
        params = {
            "function": "TIME_SERIES_DAILY",
            "symbol": provider_id,
            "outputsize": "full" if days > 100 else "compact",
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
