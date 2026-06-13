import os
from datetime import date, datetime, timezone
from decimal import Decimal

import httpx
from django.core.management.base import BaseCommand

from website.models import PriceSnapshot, Ticker

AV_URL = "https://www.alphavantage.co/query"
CG_URL = "https://api.coingecko.com/api/v3"


def fetch_deep_history(ticker: Ticker) -> list[tuple[date, Decimal]]:
    """Fetch ~max available daily closes for one ticker (AV full / CoinGecko max)."""
    if ticker.provider == "alpha_vantage":
        resp = httpx.get(
            AV_URL,
            params={
                "function": "TIME_SERIES_DAILY",
                "symbol": ticker.provider_id,
                "outputsize": "full",
                "apikey": os.environ.get("ALPHA_VANTAGE_API_KEY", ""),
            },
            timeout=60,
        )
        resp.raise_for_status()
        series = resp.json().get("Time Series (Daily)", {})
        out = [(datetime.strptime(d, "%Y-%m-%d").date(), Decimal(v["4. close"])) for d, v in series.items()]
        out.sort(key=lambda x: x[0])
        return out
    if ticker.provider == "coingecko":
        resp = httpx.get(
            f"{CG_URL}/coins/{ticker.provider_id}/market_chart",
            params={"vs_currency": "usd", "days": "max", "interval": "daily"},
            timeout=60,
        )
        resp.raise_for_status()
        seen, out = set(), []
        for ts_ms, price in resp.json().get("prices", []):
            d = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).date()
            if d not in seen:
                seen.add(d)
                out.append((d, Decimal(str(price))))
        out.sort(key=lambda x: x[0])
        return out
    return []


class Command(BaseCommand):
    help = "One-time backfill of deep daily history for all tickers (AV full / CoinGecko max)."

    def handle(self, *_args, **_options):
        for ticker in Ticker.objects.all():
            try:
                history = fetch_deep_history(ticker)
            except Exception as e:  # noqa: BLE001 — log and continue
                self.stderr.write(f"  {ticker.symbol}: ERROR — {e}")
                continue
            existing = set(PriceSnapshot.objects.filter(ticker=ticker).values_list("date", flat=True))
            new = [PriceSnapshot(ticker=ticker, date=d, price=p) for d, p in history if d not in existing]
            if new:
                PriceSnapshot.objects.bulk_create(new)
            self.stdout.write(f"  {ticker.symbol}: +{len(new)} snapshots")
