import pytest
from django.core.cache import cache

from website.auth import create_token


@pytest.fixture(autouse=True)
def _clear_cache(settings):
    """Use an in-process cache for tests (no live Redis needed) and clear it around each test.

    Production uses Redis, but the test suite must not depend on a running Redis instance.
    Overriding CACHES via the pytest-django `settings` fixture resets the cache connection to
    LocMemCache, so cache-backed features (rate limits, the shuffle recent-seed ring) still
    exercise real cache semantics without an external service.
    """
    settings.CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "nam-website-tests",
        }
    }
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def _disable_ssl_redirect(settings):
    settings.SECURE_SSL_REDIRECT = False


@pytest.fixture()
def admin_token():
    return create_token()


@pytest.fixture()
def auth_headers(admin_token):
    return {"HTTP_AUTHORIZATION": f"Bearer {admin_token}"}
