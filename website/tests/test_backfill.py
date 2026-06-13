from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest

from website.models import PriceSnapshot, Ticker


@pytest.mark.django_db
def test_backfill_inserts_history_without_duplicates():
    t = Ticker.objects.create(
        symbol="TEST", name="Test", asset_type="stock", provider="alpha_vantage", provider_id="TEST"
    )
    PriceSnapshot.objects.create(ticker=t, date=date(2020, 1, 2), price=Decimal("101"))

    fake = [
        (date(2020, 1, 1), Decimal("100")),
        (date(2020, 1, 2), Decimal("101")),  # already exists -> skipped
        (date(2020, 1, 3), Decimal("102")),
    ]
    with patch("website.management.commands.backfill_history.fetch_deep_history", return_value=fake):
        from django.core.management import call_command

        call_command("backfill_history")

    assert PriceSnapshot.objects.filter(ticker=t).count() == 3  # 2 new + 1 existing, no dup
