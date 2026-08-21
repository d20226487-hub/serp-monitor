"""DataForSEO Domain Analytics WHOIS — domain registration dates.

Endpoint:  POST https://api.dataforseo.com/v3/domain_analytics/whois/overview/live
Auth:      HTTP Basic, the same login/password the SERP provider uses.

Why this exists: domain AGE is the signal Ahrefs cannot give us. A site with 300
referring domains and no top-10 keywords is suspicious; the same site registered
four months ago is a doorway. Feeding registration dates to the AI judge turns a
guess into an observation.

COST — the reason this module batches everything into one call.
Measured against the live API, the charge is essentially FLAT PER REQUEST:

    limit=3,   1 row returned   →  $0.1212
    limit=3,   2 rows returned  →  $0.1224
    limit=100, 5 rows returned  →  $0.1260

So ~$0.12 of base fee plus roughly a tenth of a cent per row. One request per
domain would have cost $1.20 for a ten-domain SERP instead of $0.12. Every
domain a run needs therefore goes into a single `domain in [...]` filter, and
callers are expected to have already dropped anything the cache can answer.

Registration dates do not change, which is what makes caching worth it: a
scheduled job pays once and then rides the cache until a new domain shows up.

The database is keyed on REGISTRABLE domains — `tribuna.com` is present,
`by.tribuna.com` is not. Reduce hosts with providers.registrable first.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

from .._redact import redact
from .base import ProviderConfigError, ProviderError

WHOIS_URL = "https://api.dataforseo.com/v3/domain_analytics/whois/overview/live"

OK_STATUS = 20000

# DataForSEO caps `limit` at 1000 per request. A single run will not come close,
# but a caller passing a huge list should be chunked rather than truncated.
MAX_PER_REQUEST = 1000

# "2000-09-26 11:00:01 +00:00" — their WHOIS timestamps carry an offset with a
# colon that %z accepts on 3.7+, but the space before it does not match %z's
# expectations directly, so the format string spells the whole thing out.
_DT_FORMAT = "%Y-%m-%d %H:%M:%S %z"


@dataclass
class WhoisRecord:
    domain: str
    created_datetime: datetime | None
    changed_datetime: datetime | None
    expiration_datetime: datetime | None
    registrar: str | None
    epp_status_codes: list[str]


@dataclass
class WhoisOutcome:
    """Result of one batched lookup.

    `found` holds the domains DataForSEO returned. `missing` holds the ones it
    did not — a real answer, not an error: their database does not contain every
    domain on the internet, and a domain absent today may appear later. Callers
    cache the misses too, or every run re-pays $0.12 asking the same question.
    """
    found: dict[str, WhoisRecord] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)
    cost: float = 0.0
    error: str | None = None


def _parse_dt(raw: Any) -> datetime | None:
    if not raw or not isinstance(raw, str):
        return None
    try:
        return datetime.strptime(raw.strip(), _DT_FORMAT)
    except ValueError:
        # Some registrars report a date with no time or no offset. Salvage the
        # date, which is all the age calculation needs.
        try:
            return datetime.strptime(raw.strip()[:10], "%Y-%m-%d").replace(
                tzinfo=timezone.utc
            )
        except ValueError:
            return None


def _item_to_record(item: dict) -> WhoisRecord | None:
    domain = (item.get("domain") or "").strip().lower()
    if not domain:
        return None
    codes = item.get("epp_status_codes") or []
    return WhoisRecord(
        domain=domain,
        created_datetime=_parse_dt(item.get("created_datetime")),
        changed_datetime=_parse_dt(item.get("changed_datetime")),
        expiration_datetime=_parse_dt(item.get("expiration_datetime")),
        registrar=(item.get("registrar") or None),
        epp_status_codes=[str(c) for c in codes if c],
    )


async def fetch_whois(
    client: httpx.AsyncClient,
    login: str,
    password: str,
    domains: list[str],
) -> WhoisOutcome:
    """Look up every domain in ONE request. Never raises for API-level failures.

    A WHOIS failure must not take down an analyzer run: the ages are an extra
    signal on top of a SERP and Ahrefs pass that already succeeded and already
    cost money. Errors come back on the outcome for the caller to record.
    """
    wanted = sorted({(d or "").strip().lower() for d in domains if (d or "").strip()})
    if not wanted:
        return WhoisOutcome()
    if not login or not password:
        raise ProviderConfigError(
            "DataForSEO credentials are not configured — set them in "
            "Settings → DataForSEO."
        )
    if len(wanted) > MAX_PER_REQUEST:
        raise ProviderError(
            f"{len(wanted)} domains exceeds the {MAX_PER_REQUEST} per-request cap"
        )

    body = [{
        # `limit` does not drive the price (see the cost note above), but asking
        # for exactly what we filtered for keeps the response honest if a filter
        # ever matches more rows than expected.
        "limit": len(wanted),
        "filters": [["domain", "in", wanted]],
    }]

    try:
        resp = await client.post(WHOIS_URL, auth=(login, password), json=body)
    except httpx.HTTPError as e:
        return WhoisOutcome(missing=wanted, error=f"request failed: {redact(str(e))}")

    if resp.status_code != 200:
        return WhoisOutcome(
            missing=wanted,
            error=f"HTTP {resp.status_code}: {redact(resp.text[:300])}",
        )
    try:
        data = resp.json()
    except ValueError:
        return WhoisOutcome(missing=wanted, error="response was not JSON")

    # Both the envelope and the task carry their own status_code, and a 200 HTTP
    # with a 40xxx task status is still a failure — same trap as the SERP client.
    if data.get("status_code") != OK_STATUS:
        return WhoisOutcome(
            missing=wanted,
            error=f"{data.get('status_code')}: {data.get('status_message')}",
        )
    tasks = data.get("tasks") or []
    if not tasks:
        return WhoisOutcome(missing=wanted, error="response contained no tasks")
    task = tasks[0]
    # The charge lands whether or not the task succeeded, so read it first.
    cost = float(data.get("cost") or task.get("cost") or 0.0)
    if task.get("status_code") != OK_STATUS:
        return WhoisOutcome(
            missing=wanted,
            cost=cost,
            error=f"{task.get('status_code')}: {task.get('status_message')}",
        )

    found: dict[str, WhoisRecord] = {}
    for result in task.get("result") or []:
        for item in result.get("items") or []:
            rec = _item_to_record(item)
            if rec:
                found[rec.domain] = rec

    return WhoisOutcome(
        found=found,
        missing=[d for d in wanted if d not in found],
        cost=cost,
    )


def domain_age_days(created: datetime | None, now: datetime | None = None) -> int | None:
    """Age in whole days, or None when the registration date is unknown.

    Note what `created_datetime` means: it is the current registration record.
    A domain that lapsed and was re-registered reports the NEW date, not the
    original one. For spotting doorways that is the behaviour we want — a
    dropped domain picked up last spring is a new site whatever its history.
    """
    if created is None:
        return None
    ref = now or datetime.now(timezone.utc)
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=timezone.utc)
    return max(0, (ref - created).days)


def format_age(days: int | None) -> str:
    """Compact human age: "4 mo", "1.3 y", "26 y". Empty when unknown.

    Years get a decimal only below ten, where the difference between 1.2 and 1.9
    changes how a domain reads; past that the precision is noise.
    """
    if days is None:
        return ""
    if days < 31:
        return f"{days} d"
    if days < 365:
        return f"{days // 30} mo"
    years = days / 365.25
    return f"{years:.1f} y" if years < 10 else f"{years:.0f} y"
