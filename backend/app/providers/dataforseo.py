"""DataForSEO SERP API provider (Live mode).

Endpoint:  POST https://api.dataforseo.com/v3/serp/google/organic/live/regular
Auth:      HTTP Basic — login:password from https://app.dataforseo.com/api-access
           (the API password is auto-generated and is NOT your account password).

Why "live/regular":
  - `live` returns results in one request (~6s), which fits our synchronous job
    runner. The cheaper task queue ($0.0006 vs $0.002) needs POST → poll
    tasks_ready → GET with ~5min turnaround; that's a runner rewrite, deferred.
  - `regular` returns `organic`, `paid` and `featured_snippet` items only, which
    is all we extract. `advanced` adds the other SERP features we ignore.

IMPORTANT — Yandex is NOT supported by DataForSEO.
  Their SERP API covers Google, Bing, YouTube, Yahoo, Baidu, Naver and Seznam.
  Every /v3/serp/yandex/* path 404s. `search_yandex` therefore raises a
  ProviderConfigError telling the user to route Yandex through another provider.
  (Some third-party blog posts claim Yandex support — they are wrong.)

Location handling:
  DataForSEO's `location_name` uses the Google Ads geo-target canonical format,
  which is the SAME format as SerpAPI's `canonical_name`. So our saved locations
  ("Almaty,Almaty Province,Kazakhstan") pass straight through with no mapping.

Request/response shape:
  The request body is always a LIST of task objects, even for a single search.
  The response nests as: {"status_code":20000, "tasks":[{"status_code":20000,
  "result":[{"items":[...]}]}]}. Both the envelope AND the task carry their own
  status_code; 20000 means OK. We check both — a 200 HTTP with a 40xxx task
  status is still a failure.
"""
from __future__ import annotations

import asyncio
from typing import Any

import httpx

from .._redact import redact
from ..app_settings import get_provider_creds
from .base import ProviderConfigError, ProviderError, ResultRow, SerpProvider, domain_of

BASE_URL = "https://api.dataforseo.com"
GOOGLE_LIVE_URL = f"{BASE_URL}/v3/serp/google/organic/live/regular"
USER_DATA_URL = f"{BASE_URL}/v3/appendix/user_data"

OK_STATUS = 20000

# Fallback only: used when a job has a country but no canonical_name. DataForSEO
# REQUIRES a location, so without this we'd have nothing to send. Kept small and
# self-contained on purpose — importing the map from tasks.py would be circular
# (tasks.py imports this package). Names must match DataForSEO's location DB,
# which follows Google Ads country naming.
_CC_TO_LOCATION_NAME: dict[str, str] = {
    "us": "United States", "gb": "United Kingdom", "ca": "Canada",
    "au": "Australia", "de": "Germany", "fr": "France", "es": "Spain",
    "it": "Italy", "nl": "Netherlands", "pl": "Poland", "br": "Brazil",
    "mx": "Mexico", "ar": "Argentina", "in": "India", "jp": "Japan",
    "kr": "South Korea", "sg": "Singapore", "ae": "United Arab Emirates",
    "sa": "Saudi Arabia", "tr": "Turkiye", "kz": "Kazakhstan",
    "ru": "Russia", "ua": "Ukraine", "by": "Belarus", "uz": "Uzbekistan",
    "kg": "Kyrgyzstan", "tj": "Tajikistan", "tm": "Turkmenistan",
    "az": "Azerbaijan", "am": "Armenia", "ge": "Georgia",
}


def _location_name(location: dict | None, country_code: str | None) -> str:
    """Resolve what to send as `location_name`.

    Prefers the canonical_name (city-level, same format DataForSEO expects),
    falls back to a country name. Raises rather than guessing — sending a bad
    location silently returns results for the wrong place, which is exactly the
    failure mode we've been bitten by before.
    """
    if location and location.get("canonical_name"):
        return location["canonical_name"]
    cc = (country_code or "").lower()
    if cc and cc in _CC_TO_LOCATION_NAME:
        return _CC_TO_LOCATION_NAME[cc]
    raise ProviderConfigError(
        "DataForSEO requires a location for every search. Add a location to this "
        "job (Settings → Saved locations, then pick it in the job form), or pick "
        "a country we can map. Unlike SerpAPI, DataForSEO has no "
        "'no geo targeting' mode."
    )


def _parse_organic(payload: dict, top_n: int) -> list[ResultRow]:
    """Pull organic rows out of the DataForSEO envelope.

    Path: tasks[0].result[0].items[], keeping only type == "organic".
    We use `rank_absolute` (position across the whole SERP) rather than
    `rank_group` (position among same-type items) so positions stay comparable
    with the other providers, which report absolute SERP position.
    """
    tasks = payload.get("tasks") or []
    if not tasks:
        return []
    task = tasks[0] or {}
    results = task.get("result") or []
    if not results:
        return []
    items = (results[0] or {}).get("items") or []

    rows: list[ResultRow] = []
    for it in items:
        if not isinstance(it, dict) or it.get("type") != "organic":
            continue
        url = it.get("url")
        rows.append({
            "position": it.get("rank_absolute") or it.get("rank_group") or (len(rows) + 1),
            "url": url,
            "title": it.get("title"),
            "description": it.get("description"),
            # DataForSEO gives us `domain` directly; fall back to parsing the URL.
            "domain": it.get("domain") or domain_of(url),
        })
        if len(rows) >= top_n:
            break
    return rows


class DataForSEOProvider(SerpProvider):
    name = "dataforseo"

    def __init__(self, **kw):
        super().__init__(**kw)
        self._client = httpx.AsyncClient(timeout=self._timeout)

    async def aclose(self) -> None:
        await self._client.aclose()

    def _auth(self) -> tuple[str, str]:
        c = get_provider_creds("dataforseo")
        login, password = c.get("login"), c.get("password")
        if not login or not password:
            raise ProviderConfigError(
                "DataForSEO needs `login` and `password` configured in Settings. "
                "Get them from app.dataforseo.com/api-access — note the API "
                "password is auto-generated and differs from your account password."
            )
        return login, password

    @staticmethod
    def _check_status(payload: dict) -> dict:
        """Validate both envelope and task status codes, returning the payload.

        DataForSEO answers HTTP 200 even for logical failures, so the real
        outcome lives in status_code (20000 == OK). We surface their own
        status_message, which names the offending field (e.g. "Invalid Field:
        location_name") — far more actionable than a bare HTTP code.
        """
        env_status = payload.get("status_code")
        if env_status != OK_STATUS:
            raise ProviderError(
                redact(f"DataForSEO {env_status}: {payload.get('status_message')}")
            )
        tasks = payload.get("tasks") or []
        if not tasks:
            raise ProviderError("DataForSEO returned no tasks in the response")
        t_status = (tasks[0] or {}).get("status_code")
        if t_status != OK_STATUS:
            raise ProviderError(
                redact(f"DataForSEO task {t_status}: {(tasks[0] or {}).get('status_message')}")
            )
        return payload

    async def _post(self, url: str, body: list[dict]) -> dict:
        last: Exception | None = None
        for attempt in range(3):
            try:
                async with self._sem:
                    r = await self._client.post(url, auth=self._auth(), json=body)
                if r.status_code in (401, 403):
                    raise ProviderConfigError(
                        redact(f"DataForSEO rejected the credentials: {r.text[:300]}")
                    )
                # Permanent client errors — don't retry, surface the body.
                if 400 <= r.status_code < 500 and r.status_code != 429:
                    raise ProviderError(
                        redact(f"DataForSEO {r.status_code}: {r.text[:500]}")
                    )
                # Transient — retry with backoff.
                if r.status_code == 429 or 500 <= r.status_code < 600:
                    raise httpx.HTTPStatusError(
                        f"upstream {r.status_code}", request=r.request, response=r
                    )
                r.raise_for_status()
                return self._check_status(r.json())
            except (ProviderConfigError, ProviderError):
                raise  # our own permanent failures — never retry
            except (httpx.HTTPError, httpx.TimeoutException) as e:
                last = e
                await asyncio.sleep(min(2 ** attempt, 8))
        assert last is not None
        raise ProviderError(redact(f"DataForSEO request failed: {last}")) from last

    async def search_google(
        self, *, keyword, device, location, language,
        google_domain, country_code, top_n,
    ) -> list[ResultRow]:
        task: dict[str, Any] = {
            "keyword": keyword,
            "location_name": _location_name(location, country_code),
            # depth = how many results to fetch; DataForSEO accepts 10..700 and
            # bills per 10 results, so don't ask for more than we'll store.
            "depth": min(max(top_n, 10), 100),
            "device": "mobile" if device == "mobile" else "desktop",
        }
        if language:
            task["language_code"] = language
        if google_domain:
            task["se_domain"] = google_domain
        # `os` is optional; DataForSEO defaults sensibly per device (windows /
        # android). We leave it unset rather than pinning a value the user
        # didn't ask for.
        data = await self._post(GOOGLE_LIVE_URL, [task])
        return _parse_organic(data, top_n)

    async def search_yandex(
        self, *, keyword, device, language,
        yandex_domain, yandex_lr, country_code, top_n,
    ) -> list[ResultRow]:
        _ = keyword, device, language, yandex_domain, yandex_lr, country_code, top_n
        raise ProviderConfigError(
            "DataForSEO does not support Yandex — their SERP API covers Google, "
            "Bing, YouTube, Yahoo, Baidu, Naver and Seznam only. Set this job's "
            "Provider to SerpAPI, Bright Data or Oxylabs for Yandex, or remove "
            "Yandex from the job's engines and keep DataForSEO for Google."
        )

    async def test_credentials(self) -> dict:
        """Free probe — /v3/appendix/user_data is not billed. Returns the account
        balance so the user gets something useful back, not just 'ok'."""
        login, password = self._auth()
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.get(USER_DATA_URL, auth=(login, password))
        if r.status_code in (401, 403):
            raise ProviderConfigError("DataForSEO rejected the credentials")
        if r.status_code >= 400:
            raise ProviderError(redact(f"DataForSEO {r.status_code}: {r.text[:200]}"))
        payload = self._check_status(r.json())
        result = ((payload.get("tasks") or [{}])[0].get("result") or [{}])[0] or {}
        money = result.get("money") or {}
        return {
            "ok": True,
            "login": result.get("login"),
            # Surfaced in the Settings card so the user can see remaining funds.
            "balance": money.get("balance"),
        }
