"""Oxylabs SERP Scraper API (Realtime).

Endpoint: https://realtime.oxylabs.io/v1/queries
Auth:     HTTP Basic — username:password from your Oxylabs dashboard.

Google: still uses `source: "google_search"`.

Yandex: the dedicated `yandex_search` source has been DECOMMISSIONED.
Yandex queries now go through `source: "universal"` with a manually-built
URL. Oxylabs' rules for the URL:

    https://yandex.<domain>/search/?text=<query>&numdoc=<limit>&p=<start_page-1>&lr=<lr>

  - URL-encode the query.
  - `p` is zero-based (page 1 → p=0, page 2 → p=1, …).
  - On `.ru` and `.tr` domains use `lr=<region_id>`.
  - On all other domains, use `rstr=-<region_id>` (note the leading minus).
  - The old `pages` param is unsupported — submit each page as a separate job.

Docs: https://developers.oxylabs.io/scraper-apis/serp-scraper-api
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any
from urllib.parse import quote, urlencode

import httpx

from .._redact import redact
from ..app_settings import get_provider_creds
from .base import ProviderConfigError, ProviderError, ResultRow, SerpProvider, domain_of
from .yandex_html import parse_yandex_html

log = logging.getLogger(__name__)

QUERIES_URL = "https://realtime.oxylabs.io/v1/queries"


def _shape_summary(payload: dict, depth: int = 5) -> dict:
    """Best-effort tree of keys + leaf-types for diagnostics. Caps depth so
    we don't dump entire SERP results into the log."""
    def walk(v, d):
        if d <= 0:
            return f"<{type(v).__name__}>"
        if isinstance(v, dict):
            return {k: walk(v[k], d - 1) for k in list(v)[:20]}
        if isinstance(v, list):
            return [walk(v[0], d - 1)] if v else []
        return f"<{type(v).__name__}>"
    return walk(payload, depth)


def _hunt_organic(node, _depth: int = 6) -> list | None:
    """Recursively look for a key named 'organic' that points to a non-empty
    list of dicts. Used for Oxylabs `universal` source where the parsed
    organic list can live at varying paths."""
    if _depth <= 0:
        return None
    if isinstance(node, dict):
        for key in ("organic", "organic_results", "results"):
            v = node.get(key)
            if isinstance(v, list) and v and isinstance(v[0], dict) and (
                v[0].get("url") or v[0].get("link") or v[0].get("href") or v[0].get("title")
            ):
                return v
        for v in node.values():
            found = _hunt_organic(v, _depth - 1)
            if found is not None:
                return found
    elif isinstance(node, list) and node:
        # Scan a few entries — content may be wrapped in a list
        for item in node[:5]:
            found = _hunt_organic(item, _depth - 1)
            if found is not None:
                return found
    return None


def _country_from_yandex_domain(yandex_domain: str | None) -> str | None:
    """Map yandex.<tld> back to a 2-letter country code so we can pin the
    Oxylabs proxy when only the domain is known."""
    if not yandex_domain:
        return None
    tld = yandex_domain.rsplit(".", 1)[-1].lower()
    return {
        "ru": "RU", "by": "BY", "kz": "KZ", "uz": "UZ",
        "tr": "TR",  # yandex.com.tr ends in .tr
    }.get(tld)


def _build_yandex_url(*, keyword: str, language: str | None,
                     yandex_domain: str, yandex_lr: int | None, top_n: int) -> str:
    """Build a Yandex URL for Oxylabs' universal source.

    NOTE on `lr` vs `rstr`: Oxylabs' docs describe a `rstr=-<id>` convention
    for non-`.ru/.tr` domains (a leftover from the decommissioned
    `yandex_search` source). In practice Yandex itself ignores `rstr=` —
    only `lr=` is honored — and Bright Data + SerpAPI both use `lr=` on
    every TLD with correct city-level results. We follow the same pattern.
    """
    domain = yandex_domain or "yandex.com"
    params: dict[str, Any] = {
        "text": keyword,
        "numdoc": min(max(top_n, 10), 100),
        "p": 0,  # first page; zero-based
    }
    if yandex_lr is not None:
        params["lr"] = yandex_lr
    if language:
        params["lang"] = language
    return f"https://{domain}/search/?{urlencode(params, quote_via=quote)}"


def _organic_from_oxylabs(payload: dict, top_n: int, *, context: str = "") -> list[ResultRow]:
    """Walk the Oxylabs envelope to find the organic list. Shape varies
    between sources/plans:
      - google_search:                    results[0].content.results.organic
      - universal (parsed):               results[0].content.results.organic
                                          (sometimes nested under .serp / .data)
      - universal (unparsed):             results[0].content is a string (HTML)
    """
    organic: list = []
    content = None
    try:
        first = (payload.get("results") or [])[0]
        content = first.get("content") if isinstance(first, dict) else None
        # Try the common explicit paths first, then fall back to a recursive hunt.
        if isinstance(content, dict):
            inner = content.get("results")
            if isinstance(inner, dict):
                organic = inner.get("organic") or []
            if not organic:
                organic = content.get("organic") or []
            if not organic:
                hunted = _hunt_organic(content)
                if hunted:
                    organic = hunted
    except Exception:
        organic = []

    if not organic:
        # Dump enough of the structure to either fix the parser or confirm
        # that Oxylabs returned raw HTML (parser not running for this source).
        try:
            shape = _shape_summary(payload, depth=6)
            content_keys = (
                list(content.keys())[:20] if isinstance(content, dict) else
                f"<str len={len(content)}>" if isinstance(content, str) else
                f"<{type(content).__name__}>"
            )
            content_preview = ""
            if isinstance(content, str):
                content_preview = f" | content[0:300]={content[:300]!r}"
            log.warning(
                "oxylabs %s: no organic. content_keys=%s | shape=%s%s",
                context or "request",
                content_keys,
                json.dumps(shape, default=str)[:1200],
                content_preview,
            )
        except Exception:
            pass

    rows: list[ResultRow] = []
    for r in organic[:top_n]:
        if not isinstance(r, dict):
            continue
        url = r.get("url") or r.get("link") or r.get("href")
        rows.append({
            "position": r.get("pos") or r.get("position") or (len(rows) + 1),
            "url": url,
            "title": r.get("title"),
            "description": r.get("desc") or r.get("snippet") or r.get("description"),
            "domain": domain_of(url),
        })
    return rows


class OxylabsProvider(SerpProvider):
    name = "oxylabs"

    def __init__(self, **kw):
        super().__init__(**kw)
        self._client = httpx.AsyncClient(timeout=self._timeout)

    async def aclose(self) -> None:
        await self._client.aclose()

    def _auth(self) -> tuple[str, str]:
        c = get_provider_creds("oxylabs")
        u, p = c.get("username"), c.get("password")
        if not u or not p:
            raise ProviderConfigError("Oxylabs needs `username` and `password` configured in Settings")
        return u, p

    async def _post(self, body: dict) -> dict:
        last: Exception | None = None
        for attempt in range(3):
            try:
                async with self._sem:
                    r = await self._client.post(QUERIES_URL, auth=self._auth(), json=body)
                if r.status_code in (401, 403):
                    raise ProviderConfigError(redact(f"Oxylabs auth failed: {r.text[:300]}"))
                # Permanent client errors — don't retry. Surface the actual
                # response body so the user can see what Oxylabs rejected.
                if 400 <= r.status_code < 500 and r.status_code != 429:
                    raise ProviderError(
                        redact(f"Oxylabs {r.status_code} for body={body!r}: {r.text[:500]}")
                    )
                # Transient errors — retry with backoff.
                if r.status_code == 429 or 500 <= r.status_code < 600:
                    raise httpx.HTTPStatusError(f"upstream {r.status_code}",
                                                request=r.request, response=r)
                r.raise_for_status()
                return r.json()
            except (httpx.HTTPError, httpx.TimeoutException) as e:
                last = e
                await asyncio.sleep(min(2 ** attempt, 8))
        assert last is not None
        raise ProviderError(redact(f"Oxylabs request failed after retries: {last}")) from last

    async def search_google(
        self, *, keyword, device, location, language,
        google_domain, country_code, top_n,
    ) -> list[ResultRow]:
        body: dict[str, Any] = {
            "source": "google_search",
            "query": keyword,
            "parse": True,
            "limit": min(max(top_n, 10), 100),
            "user_agent_type": "mobile" if device == "mobile" else "desktop",
        }
        # geo_location on google_search controls BOTH the proxy country and
        # the search context. Prefer canonical_name (city-level), fall back
        # to country code so we never go in IP-blind.
        if location and location.get("canonical_name"):
            body["geo_location"] = location["canonical_name"]
        elif country_code:
            body["geo_location"] = country_code.upper()
        if google_domain:
            # Strip "google." prefix → "kz", "com.tr", etc. for Oxylabs.
            body["domain"] = google_domain.replace("google.", "", 1)
        if language:
            body["locale"] = language
        data = await self._post(body)
        return _organic_from_oxylabs(data, top_n, context=f"google '{keyword}'")

    async def search_yandex(
        self, *, keyword, device, language,
        yandex_domain, yandex_lr, country_code, top_n,
    ) -> list[ResultRow]:
        """Yandex on Oxylabs goes through `source: universal` with a manually
        built URL (the dedicated `yandex_search` source was decommissioned).
        `parse: true` doesn't actually engage a Yandex parser — `parser_preset`
        comes back null and `content` ends up empty of organic results — so we
        deliberately request raw HTML and run it through our own
        `parse_yandex_html` extractor (same path used for Bright Data Yandex).
        """
        url = _build_yandex_url(
            keyword=keyword, language=language,
            yandex_domain=yandex_domain, yandex_lr=yandex_lr, top_n=top_n,
        )
        body: dict[str, Any] = {
            "source": "universal",
            "url": url,
            # NOTE: deliberately NO `parse: true` — Oxylabs' universal source
            # doesn't have a Yandex parser, and asking for one returns an
            # empty parsed payload that hides the actual page from us.
            "user_agent_type": "mobile" if device == "mobile" else "desktop",
        }
        # Pin the proxy country so Yandex doesn't IP-locate to a random place
        # and override our `lr=` hint. Yandex weights the request's source IP
        # heavily; without this, two identical jobs return different SERPs
        # depending on which Oxylabs proxy was picked.
        proxy_country = (country_code or _country_from_yandex_domain(yandex_domain))
        if proxy_country:
            body["geo_location"] = proxy_country.upper()

        data = await self._post(body)

        # With parse omitted, results[0].content is the raw HTML string.
        first = (data.get("results") or [{}])[0]
        content = first.get("content") if isinstance(first, dict) else None
        if isinstance(content, str) and content:
            return parse_yandex_html(content, top_n)

        # Fallback: if Oxylabs ever decides to parse (or wraps content
        # differently), try the existing dict-walker so we don't lose data.
        return _organic_from_oxylabs(data, top_n, context=f"yandex '{keyword}' url={url}")

    async def test_credentials(self) -> dict:
        # Cheapest valid query: a parse-enabled Google search for "test".
        # Costs 1 search credit. Oxylabs has no documented free probe.
        body = {
            "source": "google_search",
            "query": "test",
            "parse": True,
            "limit": 10,
        }
        data = await self._post(body)
        first = (data.get("results") or [None])[0] or {}
        return {
            "ok": True,
            "status_code": first.get("status_code"),
            "url": first.get("url"),
        }
