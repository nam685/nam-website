from datetime import date, timedelta
from decimal import Decimal

from django.http import JsonResponse
from django.views.decorators.http import require_GET

from website.models import PriceSnapshot, Ticker

PERIOD_DAYS = {
    "1W": 7,
    "1M": 30,
    "3M": 90,
    "1Y": 365,
    "ALL": None,
}


def bets_list(request):
    """Public: all tickers with latest price and 30-day sparkline."""
    tickers = Ticker.objects.all()
    result = []
    for t in tickers:
        snapshots = list(
            PriceSnapshot.objects.filter(ticker=t).order_by("date").values_list("date", "price", "change_pct")[:30]
        )
        latest_price = None
        latest_change = None
        latest_date = None
        sparkline = []
        if snapshots:
            sparkline = [float(s[1]) for s in snapshots]
            latest_date, latest_price, latest_change = snapshots[-1]

        result.append({
            "id": t.id,
            "symbol": t.symbol,
            "name": t.name,
            "asset_type": t.asset_type,
            "display_order": t.display_order,
            "price": str(latest_price) if latest_price is not None else None,
            "change_pct": str(latest_change) if latest_change is not None else None,
            "currency": t.currency,
            "sparkline": sparkline,
            "updated_at": str(latest_date) if latest_date else None,
        })

    return JsonResponse(result, safe=False)


@require_GET
def bets_history(request, ticker_id):
    """Public: price history for one ticker with period filter."""
    try:
        ticker = Ticker.objects.get(pk=ticker_id)
    except Ticker.DoesNotExist:
        return JsonResponse({"error": "Ticker not found"}, status=404)

    period = request.GET.get("period", "1M")
    days = PERIOD_DAYS.get(period, 30)

    qs = PriceSnapshot.objects.filter(ticker=ticker).order_by("date")
    if days is not None:
        cutoff = date.today() - timedelta(days=days)
        qs = qs.filter(date__gte=cutoff)

    prices = [
        {
            "date": str(s.date),
            "price": str(s.price),
            "change_pct": str(s.change_pct) if s.change_pct is not None else None,
        }
        for s in qs
    ]

    all_snapshots = list(PriceSnapshot.objects.filter(ticker=ticker).order_by("date").values_list("date", "price"))
    change_periods = _compute_change_periods(all_snapshots)

    return JsonResponse({
        "id": ticker.id,
        "symbol": ticker.symbol,
        "name": ticker.name,
        "asset_type": ticker.asset_type,
        "currency": ticker.currency,
        "period": period,
        "prices": prices,
        "change_periods": change_periods,
    })


def _compute_change_periods(snapshots: list[tuple[date, Decimal]]) -> dict[str, str | None]:
    """Compute % change for each period from the full snapshot history."""
    if not snapshots:
        return {k: None for k in PERIOD_DAYS}

    latest_date, latest_price = snapshots[-1]
    result = {}
    for label, days in PERIOD_DAYS.items():
        if days is None:
            ref_price = snapshots[0][1]
        else:
            cutoff = latest_date - timedelta(days=days)
            ref_price = None
            for d, p in snapshots:
                if d >= cutoff:
                    ref_price = p
                    break
            if ref_price is None:
                ref_price = snapshots[0][1]

        if ref_price and ref_price != 0:
            change = ((latest_price - ref_price) / ref_price * 100).quantize(Decimal("0.01"))
            result[label] = str(change)
        else:
            result[label] = None

    return result
