from .alpha_vantage import fetch_alpha_vantage
from .coingecko import fetch_coingecko
from .ecb import fetch_ecb

PROVIDER_ADAPTERS = {
    "alpha_vantage": fetch_alpha_vantage,
    "coingecko": fetch_coingecko,
    "ecb": fetch_ecb,
}

__all__ = ["PROVIDER_ADAPTERS", "fetch_alpha_vantage", "fetch_coingecko", "fetch_ecb"]
