"""SERP provider interface. All providers expose the same shape so the job
runner doesn't have to special-case who's behind the request."""
from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from typing import TypedDict
from urllib.parse import urlparse

from ..config import settings


class ProviderError(RuntimeError):
    """A retriable / observable error from an upstream provider."""


class ProviderConfigError(ProviderError):
    """Misconfiguration — missing credentials, unknown provider, etc.
    Not retriable."""


class ResultRow(TypedDict, total=False):
    position: int
    url: str | None
    title: str | None
    description: str | None
    domain: str | None
    #: The host the engine DISPLAYS for this result, when it differs from the
    #: one the link opens. See shown_host().
    shown_host: str | None


def domain_of(url: str | None) -> str | None:
    if not url:
        return None
    try:
        return urlparse(url).hostname
    except Exception:
        return None


def shown_host(display: str | None) -> str | None:
    """The host of the address a search engine DISPLAYS for a result, lower
    case, without a leading www: «https://boostwin.biz › kz» -> boostwin.biz.

    Usually the result's own host. Not always, and the exception is the whole
    reason this exists: on the KZ mobile SERP for "boostwin", Google printed
    boostwin.biz — with that site's title and description — above a link that
    opened proceed-boostwincasino.icu. A reader scanning the page sees the
    brand and clicks into a doorway. Keeping the displayed host beside the real
    one is what makes that visible.

    Every provider has its own name for this field: `breadcrumb` /
    `website_name` (DataForSEO), `displayed_link` (SerpAPI), `url_shown`
    (Oxylabs), `display_link` (Bright Data), and for Yandex it is scraped from
    the result's path element. They all render the same SERP line.

    None when nothing host-like is displayed. DataForSEO's `website_name` is
    often a site NAME rather than an address — «Отзовик» — so anything with a
    space or without a dot is rejected rather than stored as a fake host.

    Ported from site-auditor, which has been capturing this since 2026-09-17;
    the two tools must agree on what "displayed host" means or the same SERP
    will read differently in each.
    """
    text = str(display or "").split("›")[0].strip()
    if not text or " " in text:
        return None
    if "://" not in text:
        text = "https://" + text
    host = (domain_of(text) or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host if host and "." in host else None


class SerpProvider(ABC):
    """Common interface. All methods are async + bounded by an internal
    semaphore. Implementations must be safe to instantiate per-request."""

    name: str = "abstract"

    #: True when the upstream reports real per-request cost, so the job runner
    #: can record actual spend instead of estimating from a configured rate.
    #: Only DataForSEO does today; SerpAPI/Bright Data/Oxylabs return no price.
    reports_cost: bool = False

    def __init__(self, *, concurrency: int | None = None, timeout: float = 60.0):
        self._sem = asyncio.Semaphore(concurrency or settings.serpapi_concurrency)
        self._timeout = timeout
        #: Running total (USD) accumulated across every call this instance makes.
        #: One provider instance serves one job run, so this ends up being the
        #: run's true cost. Incremented only by providers with reports_cost=True.
        self.reported_cost: float = 0.0

    async def __aenter__(self) -> "SerpProvider":
        return self

    async def __aexit__(self, *exc):
        await self.aclose()

    async def aclose(self) -> None:
        return None

    @abstractmethod
    async def search_google(
        self,
        *,
        keyword: str,
        device: str,                # "desktop" | "mobile"
        location: dict | None,      # {canonical_name, country_code, ...}
        language: str | None,       # ISO code (e.g. "ru")
        google_domain: str | None,  # e.g. "google.kz"
        country_code: str | None,
        top_n: int,
    ) -> list[ResultRow]:
        ...

    @abstractmethod
    async def search_yandex(
        self,
        *,
        keyword: str,
        device: str,
        language: str | None,
        yandex_domain: str,         # e.g. "yandex.kz"
        yandex_lr: int | None,      # numeric region id (Moscow=213, Almaty=162, …)
        country_code: str | None,
        top_n: int,
    ) -> list[ResultRow]:
        ...

    @abstractmethod
    async def test_credentials(self) -> dict:
        """Cheap probe — verify auth without burning a search credit when
        possible. Should raise ProviderConfigError on auth failure."""
        ...
