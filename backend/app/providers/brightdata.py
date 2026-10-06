"""Bright Data SERP API provider.

Bright Data exposes their SERP API through the generic `/request` endpoint:
you POST a Google/Yandex search URL with `brd_json=1` appended, authenticated
with a Bearer token, and they return parsed JSON. You also pass a "zone" name
(set up in the Bright Data dashboard, e.g. `serp_api1`).

One request is ONE Google results page. Google ignores `num` (measured
2026-10-01: num=20 returned 7-10 organic rows, every query, desktop and
mobile), so a top-20 job asks for page 2 (`start=10`) as well — and each page
is a billed request, which the run's cost counts.

Docs: https://docs.brightdata.com/scraping-automation/serp-api
"""
from __future__ import annotations

import asyncio
import logging
import math
from typing import Any
from urllib.parse import urlencode

import httpx

from .._redact import redact
from ..app_settings import get_provider_creds
from .base import (
    ProviderConfigError, ProviderError, ProviderTransientError, ResultRow,
    SerpProvider, domain_of,
    shown_host,
    display_url,
    is_search_redirect,
)
from ..provider_locations import location_for
from .uule import google_uule
from .yandex_html import parse_yandex_html

log = logging.getLogger(__name__)

REQUEST_URL = "https://api.brightdata.com/request"
# Zone state lookup, used to explain an empty 200 accurately.
ZONE_STATUS_URL = "https://api.brightdata.com/zone/status"


def google_pages(top_n: int) -> int:
    """Google result pages (= billed requests) a Google query of this depth takes."""
    return math.ceil(min(max(top_n or 10, 10), 100) / 10)


def requests_per_query(engine: str, top_n: int) -> int:
    """Billed requests per query: Google pages through; Yandex is one page."""
    return google_pages(top_n) if engine == "google" else 1


async def _current_location(location: dict | None) -> dict | None:
    """The job's location under the name Google's geo-targets list has for it
    TODAY — the list Bright Data documents as "all available uule values".

    A uule carries a NAME, and Google silently ignores one it does not know:
    the search then answers for the whole country and nothing says so. A job
    saved as "Almaty,Almaty Province,Kazakhstan" therefore goes out as
    "Almaty,Almaty Region,Kazakhstan" (same Google ID). A location that is in
    no list at all (Bukhara, Samarkand: measured 2026-10-05) gets NO uule —
    country-level by `gl`, which is what it was getting anyway, now without
    pretending; the job form says so before the run. With no list to check
    against, the stored name goes out as it always did.
    """
    if not location or not (location.get("canonical_name") or location.get("google_id")):
        return location
    found, have_list = await asyncio.to_thread(location_for, "brightdata", location)
    if found is not None:
        return {**location, "canonical_name": found.name}
    return None if have_list else location


def _build_google_url(
    *, keyword, device, language, google_domain, country_code, top_n,
    location: dict | None = None, start: int = 0,
) -> str:
    domain = google_domain or "google.com"
    _ = top_n  # depth is reached by paging (`start`), not by `num` — see module docstring
    params: dict[str, Any] = {
        "q": keyword,
        "num": 10,
        "brd_json": 1,  # Bright Data parses Google for us (zone has Full JSON)
        "brd_mobile": 1 if device == "mobile" else 0,
    }
    if start:
        params["start"] = start
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
        display = r.get("display_link")
        # Bright Data's Full JSON returns Google's own redirector in `link`
        # (https://www.google.kz/goto?url=CAES…) and the real address only in
        # `display_link`. There is no field carrying the resolved destination,
        # and the goto token is opaque, so without this every row would store
        # google.<tld> as its domain and the distribution tables would count
        # Google instead of the sites that ranked. Fall back to the displayed
        # address, which is what a person reading the SERP sees.
        if is_search_redirect(url):
            # `source` is Bright Data's second copy of the address and is often
            # a bare host when display_link is awkwardly formatted, so it is
            # worth trying before giving up and keeping the useless redirect.
            url = display_url(display) or display_url(r.get("source")) or url
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


def _has_next_page(payload: dict) -> bool:
    """Does Google offer another page? Bright Data copies Google's pager into
    `pagination`. Measured over 64 pages (2026-10-01): 59 carry `next_page`,
    4 only `next_page_link` (and do have a page 2); the one page with NO pager
    block had no "next" link in its HTML either, and "kaspi вход" (5 results,
    no pager) returned an empty, still billed, page 2. So: no next-page field
    = the SERP ends here, as on our own browser."""
    pager = payload.get("pagination")
    if not isinstance(pager, dict):
        return False
    return bool(pager.get("next_page") or pager.get("next_page_start") or pager.get("next_page_link"))


class BrightDataProvider(SerpProvider):
    name = "brightdata"
    counts_requests = True

    @staticmethod
    def requests_per_query(engine: str, top_n: int) -> int:
        return requests_per_query(engine, top_n)

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
                # A DISABLED zone answers 200 with an empty body rather than an
                # error. Without this check the empty string falls through to
                # _coerce_json, which reports "no SERP parser configured" — the
                # wrong cause, and one that sends you to the wrong dashboard
                # page. Ask Bright Data what the zone's actual status is and say
                # so. Measured: zone serp_api1 -> {"status":"disabled"}.
                if not r.text.strip():
                    zone = zone_override or creds["zone"]
                    msg, transient = await self._explain_empty(creds["token"], zone, url)
                    # A disabled zone fails the same way every time; an active
                    # (or unknown) one is Bright Data failing this one request.
                    raise (ProviderTransientError if transient else ProviderError)(msg)
                # Bright Data bills successful requests only — this one is billed.
                self.billed_requests += 1
                return self._coerce_json(r) if expect_json else r.text
            except (httpx.HTTPError, httpx.TimeoutException) as e:
                last = e
                await asyncio.sleep(min(2 ** attempt, 8))
        assert last is not None
        raise ProviderError(redact(f"Bright Data request failed: {last}")) from last

    async def _explain_empty(self, token: str, zone: str, url: str) -> tuple[str, bool]:
        """Turn an empty 200 into an actionable message, and say whether it is
        worth retrying (True unless the zone is known to be switched off).

        Bright Data exposes the zone's state at /zone/status, so we can name the
        real problem instead of guessing. The probe is best-effort: if it fails
        we still return a message that mentions the likely cause, because a
        diagnostic call failing must not replace the original error.
        """
        status: str | None = None
        try:
            r = await self._client.get(
                f"{ZONE_STATUS_URL}?zone={zone}",
                headers={"Authorization": f"Bearer {token}"},
            )
            if r.status_code == 200:
                status = (r.json() or {}).get("status")
        except Exception:  # noqa: BLE001 — diagnosis is a bonus, never fatal
            pass

        if status and status != "active":
            return ((
                f'Bright Data zone "{zone}" is {status} — it returned an empty '
                "response. Re-enable it in the Bright Data dashboard under "
                "Proxies & Scraping Infrastructure, then run the job again. "
                "(The zone's permissions are fine; it is simply switched off, "
                "which is also what happens when billing lapses.)"
            ), False)
        if status == "active":
            # The zone is fine, so nothing on the account explains this: Bright
            # Data took the request and could not serve it. Measured repeatedly
            # on Google, far more often with brd_mobile=1 than without — say so
            # rather than send anyone to check billing on an active zone.
            mobile = "brd_mobile=1" in url
            return ((
                f'Bright Data returned an EMPTY response for zone "{zone}" '
                f"(url={url!r}) although the zone is active — Bright Data could "
                "not serve this request, even after retrying. Nothing on the "
                "account needs fixing"
                + (
                    ". Mobile Google requests (brd_mobile=1) are where this has "
                    "been seen most, so another provider is the reliable choice "
                    "for mobile Google."
                    if mobile else "; retry later, or use another provider for this query."
                )
            ), True)
        # Status unknown (the probe itself failed): treated as transient, since
        # retrying costs a few seconds and the common cause is intermittent.
        return (
            f'Bright Data returned an EMPTY response for zone "{zone}" '
            f"(url={url!r}). That usually means the zone is disabled or out of "
            "funds — check it in the Bright Data dashboard. It does not mean "
            "the SERP parser is misconfigured; a parser problem returns HTML, "
            "not an empty body."
        ), True

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
                "Bright Data returned non-JSON. Likely causes: (1) your zone doesn't "
                "have a SERP parser configured for this engine — enable it in the "
                "Bright Data dashboard; (2) the zone is disabled or out of funds; "
                "or (3) the target URL is wrong. "
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
        location = await _current_location(location)
        rows: list[ResultRow] = []
        seen: set[str] = set()
        for page in range(google_pages(top_n)):
            url = _build_google_url(
                keyword=keyword, device=device, language=language,
                google_domain=google_domain, country_code=country_code, top_n=top_n,
                location=location, start=page * 10,
            )
            data = await self._request(url)
            page_rows = _parse_results(data, 100)
            # Bright Data numbers every page from 1 again (measured: start=10
            # -> rank 1..10); positions continue from the previous page here.
            offset = rows[-1]["position"] if rows else 0
            for r in page_rows:
                # Each page is a separate fetch, and two fetches of one query
                # can come back as different SERPs; a result already shown on
                # an earlier page is that artefact, not a second ranking.
                if r["url"] in seen:
                    log.info("brightdata: %r page %s repeats %s — dropped", keyword, page + 1, r["url"])
                    continue
                seen.add(r["url"])
                rows.append({**r, "position": offset + (r["position"] or len(rows) + 1)})
            if not page_rows or not _has_next_page(data):
                break
        return rows[:top_n]

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
