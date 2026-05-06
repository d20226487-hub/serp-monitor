"""SerpAPI provider. Wraps https://serpapi.com/search.json."""
from __future__ import annotations

import asyncio
from typing import Any

import httpx

from .._redact import redact
from ..app_settings import get_serpapi_key
from .base import ProviderConfigError, ProviderError, ResultRow, SerpProvider, domain_of

SEARCH_URL = "https://serpapi.com/search.json"
ACCOUNT_URL = "https://serpapi.com/account"


def _parse_organic(data: dict, top_n: int) -> list[ResultRow]:
    rows: list[ResultRow] = []
    for r in (data.get("organic_results") or [])[:top_n]:
        url = r.get("link") or r.get("url")
        rows.append({
            "position": r.get("position") or (len(rows) + 1),
            "url": url,
            "title": r.get("title"),
            "description": r.get("snippet") or r.get("description"),
            "domain": domain_of(url),
        })
    return rows


class SerpAPIProvider(SerpProvider):
    name = "serpapi"

    def __init__(self, **kw):
        super().__init__(**kw)
        self._client = httpx.AsyncClient(timeout=self._timeout)

    async def aclose(self) -> None:
        await self._client.aclose()

    def _key(self) -> str:
        k = get_serpapi_key()
        if not k:
            raise ProviderConfigError("SerpAPI key not configured")
        return k

    async def _get(self, params: dict, *, retries: int = 3) -> dict:
        # 4xx are permanent failures (bad params, invalid key, unsupported
        # location): we surface SerpAPI's own message and DON'T retry — every
        # retry on a 4xx wastes a credit for no benefit.
        # 5xx and 429 are transient: retry with exponential backoff.
        last: Exception | None = None
        for attempt in range(retries):
            try:
                async with self._sem:
                    resp = await self._client.get(SEARCH_URL, params=params)
                if resp.status_code == 429 or 500 <= resp.status_code < 600:
                    raise httpx.HTTPStatusError(
                        f"upstream {resp.status_code}",
                        request=resp.request,
                        response=resp,
                    )
                if resp.status_code >= 400:
                    # Surface SerpAPI's own error text so the user sees
                    # *why* (e.g. "Unsupported `location` parameter") instead
                    # of just "400 Bad Request". Redact api_key from any URL
                    # that might appear in the body.
                    body_msg = ""
                    try:
                        body_msg = (resp.json() or {}).get("error") or ""
                    except ValueError:
                        body_msg = resp.text[:200]
                    safe_params = {k: v for k, v in params.items() if k != "api_key"}
                    raise ProviderError(
                        redact(
                            f"SerpAPI {resp.status_code}: "
                            f"{body_msg or '<no body>'} "
                            f"(params: {safe_params})"
                        )
                    )
                return resp.json()
            except ProviderError:
                # Our own permanent-failure raise — don't retry.
                raise
            except (httpx.HTTPError, httpx.TimeoutException) as e:
                last = e
                await asyncio.sleep(min(2 ** attempt, 8))
        assert last is not None
        # `last` is the wrapped httpx exception; its str() may include a URL
        # with `api_key=…` in it. Redact before raising.
        raise ProviderError(redact(f"SerpAPI request failed: {last}")) from last

    async def search_google(
        self, *, keyword, device, location, language,
        google_domain, country_code, top_n,
    ) -> list[ResultRow]:
        params: dict[str, Any] = {
            "engine": "google",
            "q": keyword,
            "num": min(max(top_n, 10), 100),
            "device": device,
            "api_key": self._key(),
        }
        if location and location.get("canonical_name"):
            params["location"] = location["canonical_name"]
        if language:
            params["hl"] = language
        if country_code:
            params["gl"] = country_code.lower()
        if google_domain:
            params["google_domain"] = google_domain
        data = await self._get(params)
        return _parse_organic(data, top_n)

    async def search_yandex(
        self, *, keyword, device, language,
        yandex_domain, yandex_lr, country_code, top_n,
    ) -> list[ResultRow]:
        params: dict[str, Any] = {
            "engine": "yandex",
            "text": keyword,
            "yandex_domain": yandex_domain,
            "p": 0,
            "api_key": self._key(),
        }
        if yandex_lr is not None:
            params["lr"] = yandex_lr
        if language:
            params["lang"] = language
        # SerpAPI's Yandex doesn't honor a `device` param; tag downstream only.
        _ = device, country_code
        data = await self._get(params)
        return _parse_organic(data, top_n)

    async def test_credentials(self) -> dict:
        key = self._key()
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(ACCOUNT_URL, params={"api_key": key})
        if r.status_code == 401:
            raise ProviderConfigError("SerpAPI rejected the key")
        if r.status_code >= 400:
            raise ProviderError(f"SerpAPI {r.status_code}: {r.text[:200]}")
        d = r.json()
        return {
            "ok": True,
            "plan": d.get("plan_name") or d.get("plan_id"),
            "searches_left": d.get("plan_searches_left") or d.get("searches_left"),
            "this_month": d.get("this_month_usage") or d.get("total_searches_left"),
        }


# --- Locations endpoint stays here since it's SerpAPI-specific ---------------

LOCATIONS_URL = "https://serpapi.com/locations.json"


async def search_serpapi_locations(q: str, limit: int = 20) -> list[dict]:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(LOCATIONS_URL, params={"q": q, "limit": limit})
        r.raise_for_status()
        return r.json()
