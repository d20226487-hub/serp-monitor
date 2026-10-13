"""Which of a project's domains are in the SERPs, and what each proxy says of them.

User, 2026-10-06: "The goals is to understand which domains are blocked and are
in the SERPs", and, on seeing a first table that reduced the answer to blocked
/ not blocked: "we do not show blocked or not blocked we display the status by
each proxy" — "there may be multiple proxies".

One row per (country, domain), joined from two sources:

* In the SERPs — read off the positions tables' own answer (the latest run per
  query and SERP inside the window), so this table and the Positions tab can
  never disagree about what ranks now. A domain that ranked last week and is
  gone from the latest run is not "in the SERPs".
* The proxies' statuses — what the Proxy Checker last said about that domain
  in that country (models.DomainProxyCheck): a status per proxy, in its own
  names and words ({"KG - Provider A": "PASS", …}), shown as given.

Nothing here turns those statuses into a verdict of ours. The one thing read
into them is whether every proxy said PASS — the only status seen so far — and
that is used for the ORDER of the rows and for a filter, never as a label.

Everything here is pure: the router does the loading. `demo_statuses` exists
because the Proxy Checker had not answered a single request when this was
built, and the user asked to see the table on mock data meanwhile; a demo row
keeps its real domain, country and positions, and only its proxies are made up.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta

#: The periods the table can look back over, in days.
WINDOWS = (1, 7, 30)
DEFAULT_WINDOW = 7

#: The status that means a proxy reached the domain. The only one seen so far.
PASS_WORD = "PASS"
NOT_PASS, UNCHECKED, PASS = "not_pass", "unchecked", "pass"
#: Rows with a proxy that did not say PASS first — a domain that ranks and is
#: not reachable is what the table is opened for — then the ones no proxy has
#: reported on, then the ones every proxy passed.
_ORDER = {NOT_PASS: 0, UNCHECKED: 1, PASS: 2}

#: Demo only. Named so that nobody takes them for the Proxy Checker's own.
DEMO_PROXIES = ("Demo 1", "Demo 2", "Demo 3")
DEMO_NOT_PASS = "FAIL"


def in_serps(positions: dict, geos: list[str]) -> list[dict]:
    """The project's domains found in the latest SERPs, per country.

    `positions` is project_positions()'s answer. Only the project's own GEOs
    count: a page checked in a country the project does not work in is not a
    place its domains need to be reachable. A SERP with no country has no GEO
    and is left out for the same reason it is never sent.
    """
    allowed = set(geos)
    found: dict[tuple[str, str], dict] = {}
    for serp in positions.get("serps", []):
        geo = (serp.get("country_code") or "").strip().upper()
        if not geo or geo not in allowed:
            continue
        for row in serp.get("rows", []):
            for hit in row.get("hits", []):
                entry = found.setdefault((geo, hit["domain"]), {
                    "geo": geo, "domain": hit["domain"], "keywords": set(), "engines": set(),
                    "best_position": None, "best_keyword": None, "best_engine": None, "last_seen": None,
                })
                entry["keywords"].add(row["keyword"].strip().lower())
                entry["engines"].add(serp["engine"])
                if entry["best_position"] is None or hit["position"] < entry["best_position"]:
                    entry.update(best_position=hit["position"], best_keyword=row["keyword"],
                                 best_engine=serp["engine"])
                seen = row.get("checked_at")
                if seen is not None and (entry["last_seen"] is None or seen > entry["last_seen"]):
                    entry["last_seen"] = seen
    return [
        {**e, "keywords": len(e["keywords"]), "engines": sorted(e["engines"])}
        for e in found.values()
    ]


def amp_rows(rows: list[dict], amp: dict[str, list[str]]) -> list[dict]:
    """The AMP side of the table: one row per (country, AMP domain) for every
    row whose domain has an AMP domain today.

    An AMP domain is not looked for in the SERPs itself — it changes daily,
    and the SERP shows the main domain. It is "in the SERPs" of a country
    because its main domain is, so the row carries the main domain's standing
    there (keywords, best position, last seen) and names that domain.
    """
    out: list[dict] = []
    for r in rows:
        for host in amp.get(r["domain"], []):
            out.append({
                "geo": r["geo"], "domain": host, "main_domain": r["domain"],
                "keywords": r["keywords"], "engines": r["engines"],
                "best_position": r["best_position"], "best_keyword": r["best_keyword"],
                "best_engine": r["best_engine"], "last_seen": r["last_seen"],
            })
    return out


#: A check's "where does it rank" is looked up this many days back from the end
#: of the period: a domain is sent to the Proxy Checker because a SERP showed
#: it, but that SERP may have been read the evening before the check.
STANDING_DAYS = 7


def not_passing(checks: list[dict], standing: dict[tuple[str, str], dict]) -> tuple[list[dict], list[dict]]:
    """What did not pass in a period: (main rows, AMP rows).

    `checks` are the newest answers INSIDE the period, one per (country,
    domain) — {"geo", "domain", "main_domain", "statuses", "checked_at"}, with
    `main_domain` set on a domain that was sent as an AMP domain. The period
    is about when the proxies answered: a domain that failed on Monday and
    passed on Wednesday is not listed for the week, and one checked today is
    today's whenever its SERP was read.

    `standing` says where a project domain ranks in a country (in_serps rows
    by (country, domain)); an AMP row takes its main domain's. A check of a
    domain with no standing on record is still listed — it was sent because a
    SERP showed it — with that part empty.
    """
    main: list[dict] = []
    amp: list[dict] = []
    for check in checks:
        proxies = dict(check["statuses"] or {})
        if kind_of(proxies) != NOT_PASS:
            continue
        site = check.get("main_domain") or check["domain"]
        where = standing.get((check["geo"], site)) or {}
        row = {
            "geo": check["geo"], "domain": check["domain"],
            "keywords": where.get("keywords"), "engines": where.get("engines") or [],
            "best_position": where.get("best_position"), "best_keyword": where.get("best_keyword"),
            "best_engine": where.get("best_engine"), "last_seen": where.get("last_seen"),
            "proxies": proxies, "checked_at": check["checked_at"], "kind": NOT_PASS,
        }
        if check.get("main_domain"):
            amp.append({**row, "main_domain": check["main_domain"]})
        else:
            main.append(row)
    return ordered(main), ordered(amp)


def passed(status: str) -> bool:
    return status.strip().upper() == PASS_WORD


def kind_of(proxies: dict[str, str] | None) -> str:
    """How a row sorts and filters: no proxy has reported, every proxy passed,
    or at least one said something else."""
    if not proxies:
        return UNCHECKED
    return PASS if all(passed(s) for s in proxies.values()) else NOT_PASS


def demo_statuses(geo: str, domain: str, now: datetime) -> tuple[dict[str, str] | None, datetime | None]:
    """Made-up proxies for one row, in the Proxy Checker's own shape
    ({"KG - Demo 1": "PASS", …}): the same on every visit (read off the names,
    not rolled), most rows all-PASS, some with one or more proxies failing, a
    few left unchecked."""
    def roll(*parts: str) -> int:
        return int(hashlib.sha1("|".join(parts).encode()).hexdigest(), 16) % 100

    n = roll(geo, domain)
    if n >= 90:
        return None, None
    proxies = {}
    for name in DEMO_PROXIES:
        # A third of the rows have trouble; within those, each proxy fails or
        # not on its own, so "one of three" and "all three" both show up.
        failing = n < 33 and roll(geo, domain, name) < 60
        proxies[f"{geo} - {name}"] = DEMO_NOT_PASS if failing else PASS_WORD
    return proxies, now - timedelta(hours=1 + n % 20)


def ordered(rows: list[dict]) -> list[dict]:
    """By kind, then — among rows with trouble — the more proxies not passing
    the higher, then by best position."""
    def not_passing(r: dict) -> int:
        return sum(not passed(s) for s in (r.get("proxies") or {}).values())

    return sorted(rows, key=lambda r: (
        _ORDER[r["kind"]], -not_passing(r),
        r["best_position"] if r["best_position"] is not None else 10_000,
        r["geo"], r["domain"],
    ))


def counts(rows: list[dict]) -> dict:
    return {
        "in_serps": len(rows),
        NOT_PASS: sum(r["kind"] == NOT_PASS for r in rows),
        PASS: sum(r["kind"] == PASS for r in rows),
        UNCHECKED: sum(r["kind"] == UNCHECKED for r in rows),
    }


def proxies_by_geo(rows: list[dict]) -> dict[str, list[str]]:
    """The proxies that reported for each country — the table's columns there.
    Each country has its own: a proxy is an ISP in that country."""
    seen: dict[str, set[str]] = {}
    for r in rows:
        seen.setdefault(r["geo"], set()).update(r.get("proxies") or {})
    return {geo: sorted(names) for geo, names in sorted(seen.items())}
