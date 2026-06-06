"""Local conftest for scripts/ tests — pure helpers don't need Django/Redis."""

import pytest


@pytest.fixture(autouse=True)
def _clear_cache():
    """Override root conftest's Redis-dependent cache clear with a no-op."""
    yield


@pytest.fixture(autouse=True)
def _disable_ssl_redirect():
    """Override root conftest's Django settings fixture with a no-op."""
    yield
