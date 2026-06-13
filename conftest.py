import pytest
from django.core.cache import cache

from website.auth import create_token


@pytest.fixture(autouse=True)
def _clear_cache():
    """Clear Django cache between tests to avoid stale cached values.

    Silently skips when the cache backend is unavailable (e.g. Redis not running
    in a pure-unit-test environment) so that I/O-free tests can run without
    infrastructure.
    """
    try:
        cache.clear()
    except Exception:
        pass
    yield
    try:
        cache.clear()
    except Exception:
        pass


@pytest.fixture(autouse=True)
def _disable_ssl_redirect(settings):
    settings.SECURE_SSL_REDIRECT = False


@pytest.fixture()
def admin_token():
    return create_token()


@pytest.fixture()
def auth_headers(admin_token):
    return {"HTTP_AUTHORIZATION": f"Bearer {admin_token}"}
