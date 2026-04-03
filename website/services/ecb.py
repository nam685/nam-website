import csv
import io
from datetime import date, timedelta
from decimal import Decimal

import httpx

BASE_URL = "https://data-api.ecb.europa.eu/service/data"


def fetch_ecb(provider_id: str, days: int = 365) -> list[tuple[date, Decimal]]:
    """Fetch monthly yield data from ECB SDMX API.

    provider_id is the full series key, e.g. 'FM.M.U2.EUR.4F.BB.U2_10Y.YLD'.
    The first dot-separated segment is the flow ref (FM), the rest is the key.
    """
    parts = provider_id.split(".", 1)
    flow_ref = parts[0]
    key = parts[1] if len(parts) > 1 else ""

    cutoff = date.today() - timedelta(days=days)

    resp = httpx.get(
        f"{BASE_URL}/{flow_ref}/{key}",
        params={"format": "csvdata"},
        timeout=30,
    )
    resp.raise_for_status()

    reader = csv.DictReader(io.StringIO(resp.text))
    results = []
    for row in reader:
        time_period = row.get("TIME_PERIOD", "")
        obs_value = row.get("OBS_VALUE", "")
        if not time_period or not obs_value:
            continue
        # Monthly format: "2026-03" → date(2026, 3, 1)
        try:
            d = date.fromisoformat(time_period + "-01") if len(time_period) == 7 else date.fromisoformat(time_period)
        except ValueError:
            continue
        if d >= cutoff:
            results.append((d, Decimal(obs_value)))

    results.sort(key=lambda x: x[0])
    return results
