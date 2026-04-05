import json
import time
from datetime import datetime
from decimal import Decimal

from django.core.cache import cache
from django.core.management.base import BaseCommand
from django.db.models import F, Max

from website.models import PriceSnapshot, Ticker
from website.services import PROVIDER_ADAPTERS
from website.services.alpha_vantage import AlphaVantageQuotaError


class Command(BaseCommand):
    help = "Fetch latest prices for all tracked tickers"

    def handle(self, *_args, **_options):
        # Prioritise least up-to-date tickers: no data first, then oldest
        tickers = list(
            Ticker.objects.annotate(latest_date=Max("snapshots__date")).order_by(F("latest_date").asc(nulls_first=True))
        )
        errors = []
        last_av_time: float | None = None
        av_quota_hit = False

        for ticker in tickers:
            # Skip remaining Alpha Vantage tickers once quota is exhausted
            if ticker.provider == "alpha_vantage" and av_quota_hit:
                errors.append({"symbol": ticker.symbol, "message": "Skipped — Alpha Vantage quota exhausted"})
                self.stderr.write(f"  {ticker.symbol}: SKIPPED (AV quota)")
                continue

            # Rate-limit: 1.5s between Alpha Vantage requests (free key: ~1 req/sec)
            if ticker.provider == "alpha_vantage" and last_av_time is not None:
                elapsed = time.monotonic() - last_av_time
                if elapsed < 1.5:
                    time.sleep(1.5 - elapsed)

            adapter = PROVIDER_ADAPTERS.get(ticker.provider)
            if not adapter:
                errors.append({"symbol": ticker.symbol, "message": f"Unknown provider: {ticker.provider}"})
                continue

            try:
                history = adapter(ticker.provider_id, days=365)
                self._upsert_snapshots(ticker, history)
                self.stdout.write(f"  {ticker.symbol}: {len(history)} data points")
            except AlphaVantageQuotaError as e:
                av_quota_hit = True
                errors.append({"symbol": ticker.symbol, "message": str(e)})
                self.stderr.write(f"  {ticker.symbol}: ERROR — {e}")
            except Exception as e:
                errors.append({"symbol": ticker.symbol, "message": str(e)})
                self.stderr.write(f"  {ticker.symbol}: ERROR — {e}")

            if ticker.provider == "alpha_vantage":
                last_av_time = time.monotonic()

        status = {
            "last_sync": datetime.now().isoformat(),
            "errors": errors,
        }
        cache.set("bets:sync_status", json.dumps(status), timeout=86400)

        if errors:
            self.stdout.write(f"Sync complete with {len(errors)} error(s)")
        else:
            self.stdout.write(f"Sync complete: {len(tickers)} tickers updated")

    def _upsert_snapshots(self, ticker: Ticker, history: list[tuple]) -> None:
        existing_dates = set(PriceSnapshot.objects.filter(ticker=ticker).values_list("date", flat=True))
        new_snapshots = []
        prev_price: Decimal | None = None

        # Get the last known price before this batch for change_pct calculation
        last_existing = (
            PriceSnapshot.objects.filter(ticker=ticker).order_by("-date").values_list("price", flat=True).first()
        )
        if last_existing is not None:
            prev_price = last_existing

        for d, price in history:
            if d in existing_dates:
                prev_price = price
                continue

            change_pct = None
            if prev_price is not None and prev_price != 0:
                change_pct = ((price - prev_price) / prev_price * 100).quantize(Decimal("0.0001"))

            new_snapshots.append(PriceSnapshot(ticker=ticker, date=d, price=price, change_pct=change_pct))
            prev_price = price

        if new_snapshots:
            PriceSnapshot.objects.bulk_create(new_snapshots)
