"""Bright Data SERP API provider.

Bright Data exposes their SERP API through the generic `/request` endpoint:
you POST a Google/Yandex search URL with `brd_json=1` appended, authenticated
with a Bearer token, and they return parsed JSON. You also pass a "zone" name
(set up in the Bright Data dashboard, e.g. `serp_api1`).

Docs: https://docs.brightdata.com/scraping-automation/serp-api
"""
from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import urlencode

import httpx

from .._redact import redact
from ..app_settings import get_provider_creds
from .base import (
    ProviderConfigError, ProviderError, ResultRow, SerpProvider, domain_of,
    shown_host,
)
from .uule import google_uule
from .yandex_html import parse_yandex_html

REQUEST_URL = "https://api.brightdata.com/request"


def _build_google_url(
    *, keyword, device, language, google_domain, country_code, top_n,
    location: dict | None = None,
) -> str:
    domain = google_domain or "google.com"
    params: dict[str, Any] = {
        "q": keyword,
        "num": min(max(top_n, 10), 100),
        "brd_json": 1,  # Bright Data parses Google for us (zone has Full JSON)
        "brd_mobile": 1 if device == "mobile" else 0,
    }
    if language:
        params["hl"] = language
    if country_code:
        params["gl"] = country_code.lower()
    # City-level targeting: Bright Data Google honors Google's native `uule=`.
    # SerpAPI hides this behind a `location=` param; we encode it ourselves.
    if location and location.get("canonical_name"):
        u = google_uule(location["canonical_name"])
        if u:
            params["uule"] = u
    return f"https://www.{domain}/search?{urlencode(params)}"


def _build_yandex_url(*, keyword, device, language, yandex_domain, yandex_lr, top_n) -> str:
    """Yandex on Bright Data: deliberately NO `brd_json=1`. Bright Data's
    Full-JSON parser doesn't support Yandex on most plans (returns
    "JSON output is not supported"). We fetch the raw page and parse it
    ourselves with `yandex_html.parse_yandex_html`."""
    params: dict[str, Any] = {"text": keyword}
    if yandex_lr is not None:
        params["lr"] = yandex_lr
    if language:
        params["lang"] = language
    # brd_mobile: explicit on both branches per Bright Data's checklist.
    params["brd_mobile"] = 1 if device == "mobile" else 0
    _ = top_n  # Yandex first page already returns ~10; pagination not wired
    return f"https://{yandex_domain}/search/?{urlencode(params)}"


def _parse_results(payload: dict, top_n: int) -> list[ResultRow]:
    """Best-effort parser. Bright Data returns parsed SERP JSON when
    parse_results=true; the envelope varies by engine and zone, so we
    walk a few likely paths before giving up."""
    candidates: list[dict] = []
    if isinstance(payload.get("organic"), list):
        candidates = payload["organic"]
    elif isinstance(payload.get("organic_results"), list):
        candidates = payload["organic_results"]
    elif isinstance(payload.get("results"), dict):
        # Could be {"results": {"organic": [...]}} (single-result envelope)
        inner = payload["results"]
        candidates = inner.get("organic") or inner.get("organic_results") or []
    elif isinstance(payload.get("results"), list):
        # Could be {"results": [{"content": {"organic": [...]}}]} (Oxylabs-like envelope)
        first = payload["results"][0] if payload["results"] else {}
        content = first.get("content") if isinstance(first, dict) else None
        if isinstance(content, dict):
            candidates = content.get("organic") or content.get("organic_results") or []
            if not candidates and isinstance(content.get("results"), dict):
                inner2 = content["results"]
                candidates = inner2.get("organic") or inner2.get("organic_results") or []

    rows: list[ResultRow] = []
    for r in candidates[:top_n]:
        if not isinstance(r, dict):
            continue
        url = r.get("url") or r.get("link") or r.get("href")
        rows.append({
            "position": r.get("rank") or r.get("position") or (len(rows) + 1),
            "url": url,
            "title": r.get("title"),
            "description": r.get("snippet") or r.get("description") or r.get("desc"),
            "domain": domain_of(url),
            # Bright Data's name for the address Google prints.
            "shown_host": shown_host(r.get("display_link")),
        })
    return rows


class BrightDataProvider(SerpProvider):
    name = "brightdata"

    def __init__(self, **kw):
        super().__init__(**kw)
        self._client = httpx.AsyncClient(timeout=self._timeout)

    async def aclose(self) -> None:
        await self._client.aclose()

    def _creds(self) -> dict:
        c = get_provider_creds("brightdata")
        token = c.get("token")
        zone = c.get("zone")
        if not token or not zone:
            raise ProviderConfigError("Bright Data needs `token` and `zone` configured in Settings")
        return c

    async def _request(
        self, url: str, *, expect_json: bool = True, zone_override: str | None = None,
    ) -> dict | str:
        """If expect_json=True, return parsed JSON (Google path). If False,
        return the raw response text (Yandex path — parsed downstream by
        yandex_html.parse_yandex_html). `zone_override` lets the caller route
        a specific request through a different Bright Data zone (e.g. a
        Raw-HTML zone for Yandex when the primary zone is Full-JSON)."""
        creds = self._creds()
        headers = {
            "Authorization": f"Bearer {creds['token']}",
            "Content-Type": "application/json",
        }
        body = {
            "zone": zone_override or creds["zone"],
            "url": url,
            "format": "raw",
        }
        last: Exception | None = None
        for attempt in range(3):
            try:
                async with self._sem:
                    r = await self._client.post(REQUEST_URL, headers=headers, json=body)
                if r.status_code in (401, 403):
                    raise ProviderConfigError(redact(f"Bright Data auth failed: {r.text[:300]}"))
                if 400 <= r.status_code < 500 and r.status_code != 429:
                    raise ProviderError(
                        redact(f"Bright Data {r.status_code} for url={url!r}: {r.text[:500]}")
                    )
                if r.status_code == 429 or 500 <= r.status_code < 600:
                    raise httpx.HTTPStatusError(f"upstream {r.status_code}",
                                                request=r.request, response=r)
                r.raise_for_status()
                return self._coerce_json(r) if expect_json else r.text
            except (httpx.HTTPError, httpx.TimeoutException) as e:
                last = e
                await asyncio.sleep(min(2 ** attempt, 8))
        assert last is not None
        raise ProviderError(redact(f"Bright Data request failed: {last}")) from last

    @staticmethod
    def _coerce_json(r: httpx.Response) -> dict:
        """Bright Data returns parsed JSON when parse_results=true, but the
        envelope shape varies:
            (a) the response body IS the parsed SERP JSON (most common)
            (b) wrapped: {"status_code":200, "headers":{}, "body":"<json>"}
            (c) wrapped: {"results":[{"content":{...}}]}  (some zones)
        Try them in order; if the body is HTML, surface a clear, actionable error.
        """
        try:
            data = r.json()
        except ValueError:
            text = r.text[:300].replace("\n", " ")
            # Specific case: Bright Data tells you flat-out that the zone
            # doesn't have a JSON parser for this engine.
            if "JSON output is not supported" in text:
                raise ProviderError(
                    "Bright Data: your zone does NOT have a JSON parser enabled "
                    "for this engine (typically Yandex). Two options: (a) enable "
                    "Yandex parsing on the zone in the Bright Data dashboard if "
                    "your plan supports it, or (b) route Yandex queries through "
                    "SerpAPI by changing the job's Provider — Bright Data can "
                    "stay as the Google provider on a separate job."
                )
            raise ProviderError(
                "Bright Data returned non-JSON. Two likely causes: (1) your zone "
                "doesn't have a SERP parser configured for this engine — enable "
                "it in the Bright Data dashboard, or (2) the target URL is wrong. "
                f"First 300 chars of response: {text}"
            )
        # Case (a): already parsed
        if isinstance(data, dict) and (
            "organic" in data or "organic_results" in data or "results" in data
        ):
            # `results` may be the parsed-list shape, fall through to caller.
            return data
        # Case (b): wrapped with stringified inner body
        if isinstance(data, dict) and isinstance(data.get("body"), str):
            try:
                import json as _json
                inner = _json.loads(data["body"])
                if isinstance(inner, dict):
                    return inner
            except ValueError:
                pass
        # Unknown shape — return as-is and let the parser handle/error.
        return data if isinstance(data, dict) else {"_raw": data}

    async def search_google(
        self, *, keyword, device, location, language,
        google_domain, country_code, top_n,
    ) -> list[ResultRow]:
        url = _build_google_url(
            keyword=keyword, device=device, language=language,
            google_domain=google_domain, country_code=country_code, top_n=top_n,
            location=location,
        )
        data = await self._request(url)
        return _parse_results(data, top_n)

    async def search_yandex(
        self, *, keyword, device, language,
        yandex_domain, yandex_lr, country_code, top_n,
    ) -> list[ResultRow]:
        _ = country_code
        creds = self._creds()
        zone_raw = creds.get("zone_raw")
        if not zone_raw:
            raise ProviderConfigError(
                "Bright Data Yandex requires a second zone configured as "
                "'Raw HTML' in the Bright Data dashboard. Create one and paste "
                "its name into the Bright Data card's `zone_raw` field on the "
                "Settings page. (The primary `zone` stays as Full JSON for Google.)"
            )
        url = _build_yandex_url(
            keyword=keyword, device=device, language=language,
            yandex_domain=yandex_domain, yandex_lr=yandex_lr, top_n=top_n,
        )
        # Route through the raw-HTML zone so Bright Data won't try to parse.
        html = await self._request(url, expect_json=False, zone_override=zone_raw)
        if not isinstance(html, str):
            raise ProviderError("Bright Data returned unexpected type for Yandex (expected HTML)")
        return parse_yandex_html(html, top_n)

    async def test_credentials(self) -> dict:
        # Bright Data has no documented free auth-check endpoint, so we issue
        # the cheapest possible search ("test" on google.com) — costs ~1 SERP
        # credit on most plans, far cheaper than any real run. Returning the
        # presence of a parsed payload is enough to say "creds work".
        url = "https://www.google.com/search?q=test&brd_json=1"
        data = await self._request(url)
        return {
            "ok": True,
            "parsed_keys": list(data.keys())[:8] if isinstance(data, dict) else None,
        }
