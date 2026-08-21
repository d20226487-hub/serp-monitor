"""RDAP — registration dates straight from the registries, free.

RDAP is the IETF protocol that replaced WHOIS, and ICANN has required it of
every gTLD registry since 2019. https://rdap.org bootstraps: it redirects a
domain to whichever registry is authoritative for its TLD.

Why this runs BEFORE DataForSEO, despite DataForSEO already being wired up:
measured against run 68, DataForSEO had no record for 17 of 63 domains and
every one of them was a doorway — `.app`, `.site`, `.live`, `.ink`, `.click`,
`.cfd`. Its WHOIS database is built from domains with ranking history, so a
domain registered last week is invisible to it by construction. RDAP answered
15 of those 17, including domains one day old. Those are the exact domains the
whole age signal exists to catch.

What RDAP does NOT cover is most ccTLDs — .kz, .ru, .by, .am, .uz all return
404 — which is why DataForSEO stays as the fallback rather than being dropped.

No API key, no per-request charge. Registries do rate-limit, so lookups run at
a bounded concurrency and a failure never escalates beyond "ask the fallback".
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

log = logging.getLogger(__name__)

BOOTSTRAP_URL = "https://rdap.org/domain/{domain}"

# Registries throttle. Four at a time clears a 60-domain run in seconds without
# tripping anything, and a 429 just falls through to the paid fallback anyway.
MAX_CONCURRENCY = 4
TIMEOUT_SECONDS = 15


@dataclass
class RdapRecord:
    domain: str
    created_datetime: datetime | None
    changed_datetime: datetime | None
    expiration_datetime: datetime | None
    registrar: str | None
    epp_status_codes: list[str]


def _parse_dt(raw) -> datetime | None:
    """RDAP timestamps are ISO 8601, sometimes with fractional seconds and
    either a 'Z' or a numeric offset: 2026-08-16T19:12:11.518Z."""
    if not raw or not isinstance(raw, str):
        return None
    text = raw.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        try:
            dt = datetime.strptime(text[:10], "%Y-%m-%d")
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _registrar_of(data: dict) -> str | None:
    """Pull the registrar's display name out of the jCard mess.

    RDAP nests it as entities[].vcardArray[1][][0] == "fn", which is verbose
    but stable across registries.
    """
    for entity in data.get("entities") or []:
        if "registrar" not in (entity.get("roles") or []):
            continue
        vcard = entity.get("vcardArray")
        if not (isinstance(vcard, list) and len(vcard) > 1):
            continue
        for item in vcard[1]:
            if isinstance(item, list) and len(item) > 3 and item[0] == "fn":
                name = item[3]
                if isinstance(name, str) and name.strip():
                    return name.strip()
    return None


def _to_record(domain: str, data: dict) -> RdapRecord | None:
    events = {}
    for ev in data.get("events") or []:
        action = ev.get("eventAction")
        if action and ev.get("eventDate"):
            events[action] = ev["eventDate"]
    created = _parse_dt(events.get("registration"))
    if created is None:
        # Without a registration date there is nothing here we need; let the
        # fallback try rather than caching a hit that has no age in it.
        return None
    return RdapRecord(
        domain=domain,
        created_datetime=created,
        changed_datetime=_parse_dt(
            events.get("last changed") or events.get("last update of RDAP database")
        ),
        expiration_datetime=_parse_dt(events.get("expiration")),
        registrar=_registrar_of(data),
        epp_status_codes=[str(s) for s in (data.get("status") or []) if s],
    )


# A 404 is a real answer — this TLD has no RDAP service, and asking again will
# never change that. Everything else that goes wrong is worth one more try.
ATTEMPTS = 3
BACKOFF_SECONDS = 0.6


async def fetch_one(
    client: httpx.AsyncClient, domain: str
) -> tuple[RdapRecord | None, str]:
    """Look up one domain.

    Returns (record, outcome) where outcome is one of:
      "ok"       - resolved, record is populated
      "absent"   - RDAP answered definitively that it has nothing (404/no
                   registration event). Asking again is pointless.
      "error"    - transient: throttled, timed out, 5xx, unparseable.

    The distinction matters more than it looks. A transient failure that gets
    reported as "absent" ends up negative-cached for two weeks, and the domain's
    age silently disappears from every run in between — which is exactly what
    happened on run 68 before this returned an outcome at all.
    """
    last = "error"
    for attempt in range(ATTEMPTS):
        try:
            resp = await client.get(
                BOOTSTRAP_URL.format(domain=domain),
                headers={"Accept": "application/rdap+json"},
                timeout=TIMEOUT_SECONDS,
                follow_redirects=True,
            )
        except httpx.HTTPError as e:
            log.debug("rdap %s attempt %s: %s", domain, attempt + 1, e)
            last = "error"
        else:
            if resp.status_code == 404:
                return None, "absent"
            if resp.status_code == 200:
                try:
                    rec = _to_record(domain, resp.json())
                except ValueError:
                    return None, "error"
                # A 200 with no registration event is a real, final answer.
                return (rec, "ok") if rec else (None, "absent")
            # 429 and 5xx: back off and try again.
            log.debug("rdap %s attempt %s: HTTP %s", domain, attempt + 1, resp.status_code)
            last = "error"
        if attempt < ATTEMPTS - 1:
            await asyncio.sleep(BACKOFF_SECONDS * (attempt + 1))
    return None, last


@dataclass
class RdapBatch:
    """Resolved records, plus the domains that failed for reasons that may not
    recur. The caller must not cache a transient failure as "no such domain"."""
    found: dict[str, RdapRecord]
    transient: set[str]


async def fetch_many(domains: list[str]) -> RdapBatch:
    """Look up a batch at bounded concurrency. Never raises."""
    wanted = sorted({(d or "").strip().lower() for d in domains if (d or "").strip()})
    if not wanted:
        return RdapBatch({}, set())
    sem = asyncio.Semaphore(MAX_CONCURRENCY)
    out: dict[str, RdapRecord] = {}
    transient: set[str] = set()

    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
        async def one(domain: str) -> None:
            async with sem:
                rec, outcome = await fetch_one(client, domain)
                if outcome == "ok" and rec is not None:
                    out[domain] = rec
                elif outcome == "error":
                    transient.add(domain)

        await asyncio.gather(*(one(d) for d in wanted))
    log.info(
        "rdap: resolved %s/%s (%s transient failures)",
        len(out), len(wanted), len(transient),
    )
    return RdapBatch(out, transient)
