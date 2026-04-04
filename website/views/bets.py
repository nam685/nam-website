import json
from datetime import date, timedelta
from decimal import Decimal

from django.core.cache import cache
from django.core.management import call_command
from django.db import models
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET

from website.auth import require_admin
from website.models import PriceSnapshot, Ticker
from website.services import search_alpha_vantage, search_coingecko
from website.services.alpha_vantage import AlphaVantageQuotaError
from website.utils import parse_json_body

PERIOD_DAYS = {
    "1W": 7,
    "1M": 30,
    "3M": 90,
    "1Y": 365,
    "ALL": None,
}


def bets_list(_request):
    """Public: all tickers with latest price and 30-day sparkline."""
    tickers = Ticker.objects.all()
    result = []
    for t in tickers:
        snapshots = list(
            PriceSnapshot.objects.filter(ticker=t).order_by("-date").values_list("date", "price", "change_pct")[:30]
        )
        snapshots.reverse()  # chronological order for sparkline
        latest_price = None
        latest_change = None
        latest_date = None
        sparkline = []
        if snapshots:
            sparkline = [float(s[1]) for s in snapshots]
            latest_date, latest_price, latest_change = snapshots[-1]

        result.append(
            {
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
            }
        )

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

    return JsonResponse(
        {
            "id": ticker.id,
            "symbol": ticker.symbol,
            "name": ticker.name,
            "asset_type": ticker.asset_type,
            "currency": ticker.currency,
            "period": period,
            "prices": prices,
            "change_periods": change_periods,
        }
    )


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


@csrf_exempt
@require_admin
def bets_create(request):
    """Admin: add a new ticker."""
    body, err = parse_json_body(request)
    if err:
        return err

    symbol = body.get("symbol", "").strip().upper()
    name = body.get("name", "").strip()
    asset_type = body.get("asset_type", "")
    provider = body.get("provider", "")
    provider_id = body.get("provider_id", "").strip()
    currency = body.get("currency", "USD").strip()

    if not all([symbol, name, asset_type, provider, provider_id]):
        return JsonResponse({"error": "Missing required fields"}, status=400)

    if asset_type not in dict(Ticker.AssetType.choices):
        return JsonResponse({"error": f"Invalid asset_type: {asset_type}"}, status=400)

    if provider not in dict(Ticker.Provider.choices):
        return JsonResponse({"error": f"Invalid provider: {provider}"}, status=400)

    if Ticker.objects.filter(symbol=symbol).exists():
        return JsonResponse({"error": f"Ticker {symbol} already exists"}, status=400)

    max_order = Ticker.objects.aggregate(m=models.Max("display_order"))["m"] or 0

    ticker = Ticker.objects.create(
        symbol=symbol,
        name=name,
        asset_type=asset_type,
        provider=provider,
        provider_id=provider_id,
        currency=currency,
        display_order=max_order + 1,
    )

    return JsonResponse(
        {
            "id": ticker.id,
            "symbol": ticker.symbol,
            "name": ticker.name,
        },
        status=201,
    )


@csrf_exempt
@require_admin
def bets_delete(_request, ticker_id):
    """Admin: remove a ticker and all its price history."""
    try:
        ticker = Ticker.objects.get(pk=ticker_id)
    except Ticker.DoesNotExist:
        return JsonResponse({"error": "Ticker not found"}, status=404)

    ticker.delete()
    return JsonResponse({"ok": True})


@csrf_exempt
@require_admin
def bets_sync(_request):
    """Admin: trigger manual price sync."""
    call_command("sync_prices")
    return JsonResponse({"ok": True})


@require_GET
@require_admin
def bets_sync_status(_request):
    """Admin: check last sync time and errors."""
    raw = cache.get("bets:sync_status")
    if raw:
        status = json.loads(raw)
    else:
        status = {"last_sync": None, "errors": []}
    return JsonResponse(status)


@require_GET
@require_admin
def bets_search(request):
    """Admin: search for tickers across providers."""
    q = request.GET.get("q", "").strip()
    if len(q) < 2:
        return JsonResponse({"error": "Query must be at least 2 characters"}, status=400)

    quota_error = None
    try:
        av_results = search_alpha_vantage(q)
    except AlphaVantageQuotaError as e:
        av_results = []
        quota_error = str(e)
    except Exception:
        av_results = []

    try:
        cg_results = search_coingecko(q)
    except Exception:
        cg_results = []

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

    if not merged and quota_error:
        return JsonResponse({"error": quota_error}, status=429)

    return JsonResponse(merged, safe=False)
