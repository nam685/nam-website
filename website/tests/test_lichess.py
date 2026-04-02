import pytest
from django.utils import timezone

from website.models import LichessToken


@pytest.mark.django_db
class TestLichessToken:
    def test_create_token(self):
        token = LichessToken.objects.create(
            access_token="lip_test123",
            lichess_username="testuser",
            expires_at=timezone.now() + timezone.timedelta(days=365),
        )
        assert token.access_token == "lip_test123"
        assert token.lichess_username == "testuser"
        assert str(token) == "Lichess: testuser"

    def test_upsert_replaces_existing(self):
        LichessToken.objects.create(
            access_token="old_token",
            lichess_username="olduser",
            expires_at=timezone.now() + timezone.timedelta(days=365),
        )
        # Delete all, then create new (single-row upsert pattern)
        LichessToken.objects.all().delete()
        LichessToken.objects.create(
            access_token="new_token",
            lichess_username="newuser",
            expires_at=timezone.now() + timezone.timedelta(days=365),
        )
        assert LichessToken.objects.count() == 1
        assert LichessToken.objects.first().lichess_username == "newuser"
