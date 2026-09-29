"""Provider registry. Each provider knows how to call its underlying SERP API
and return a normalized list of result rows."""
from .base import SerpProvider, ProviderError, ProviderConfigError
from .serpapi import SerpAPIProvider
from .brightdata import BrightDataProvider
from .oxylabs import OxylabsProvider
from .dataforseo import DataForSEOProvider

PROVIDERS: dict[str, type[SerpProvider]] = {
    "serpapi": SerpAPIProvider,
    "brightdata": BrightDataProvider,
    "oxylabs": OxylabsProvider,
    # Google-only: DataForSEO's SERP API has no Yandex endpoint.
    "dataforseo": DataForSEOProvider,
}


def get_provider(name: str) -> SerpProvider:
    cls = PROVIDERS.get(name)
    if cls is None:
        raise ProviderConfigError(f"unknown provider: {name!r}")
    return cls()


def supports(name: str, engine: str) -> bool:
    """Whether a provider can query an engine at all — no request needed."""
    cls = PROVIDERS.get(name)
    return cls is not None and engine in cls.engines


__all__ = [
    "SerpProvider",
    "ProviderError",
    "ProviderConfigError",
    "PROVIDERS",
    "get_provider",
    "supports",
]
