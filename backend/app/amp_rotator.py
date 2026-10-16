"""AMP Rotator: today's AMP domain of each of a project's domains.

User, 2026-10-13: "The purpose of connecting SERP Monitor with AMP rotator: get
today's AMP domain of each domain per project", and on where it is set up: "In
the settings, AMP Rotator, let the user add the endpoints. Each project will
have their AMP rotator endpoint. Make the adding via a form, where the user
will choose a project and will specify the endpoint".

The rotator's API, as its own description gives it:

    POST https://<rotator-host>/api/          HTTP Basic
    ["domain.com", "domain2.com"]             the site hostnames it rotates for
    200 {"domain.com": "<its AMP host today>", "domain2.com": ""}

"" is a site that rotator does not know. The call only reads state — asking
does not rotate anything. Rotation is daily ("after 03:00 Kyiv" in the
description), so each endpoint is asked once a day, at a time that is its own
setting (the user: "Make the time when the AMP rotator request is made
configurable"), plus whenever someone presses "Fetch now"; and at start-up for
an endpoint whose daily moment passed while the app was off, because a
scheduler that was not running cannot fire a tick it missed.

* An endpoint belongs to a project and is asked about ALL of that project's
  domains: the rotator answers "" for the ones it does not serve, and those
  are simply not kept. A project may have several endpoints — a rotator serves
  only the sites in its own config, and a project's domains can be spread over
  more than one.
* What is kept is the latest answer: one row per (endpoint, domain) with the
  AMP host and since when that host has been the answer. A domain the rotator
  stops naming is dropped. A fetch that FAILS changes nothing — yesterday's
  hosts stay, visibly dated, rather than vanish on a timeout.
* A rotator's AMP config can be uploaded too (user, 2026-10-16: "The goal is
  to know all the past AMPs that we have missed and mark them in Positions
  report + send them to the Proxy Checker IF they appear in SERPs"). For each
  site in it, the AMP domains listed BEFORE the one the daily checks named
  last are the site's earlier ones, and join the history below
  (import_config).
* Beside that, every AMP host a rotator has ever named is remembered
  (AmpDomainSeen), and nothing but deleting the project forgets one. The
  positions tables count a result on an AMP host as the project's (the user:
  "we have not added the today's AMP domains to the project BUT they appear in
  SERPs. Then they should be counted in positions as well"), and a SERP read
  yesterday shows yesterday's AMP host, which today's answer no longer names.
* ONE login and password serve every rotator (the user: "All the AMP rotators
  have the same passwords" — "It will be one for each AMP rotator endpoint"),
  so the pair is a setting of the connection, not of an endpoint. The password
  is stored like the other tools' secrets and never sent to the browser;
  errors are kept without it. Until the pair is saved nothing is asked.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import NamedTuple

import httpx
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from ._redact import redact
from .app_settings import _get, _set
from .db import SessionLocal
from .models import AmpDomain, AmpDomainSeen, AmpEndpoint, Project

log = logging.getLogger(__name__)

TOOL = "amp_rotator"
KEY_USERNAME = "amp_rotator_username"
KEY_PASSWORD = "amp_rotator_password"
#: A new endpoint's daily time unless another is given, HH:MM in UTC. Rotation
#: is "after 03:00 Kyiv", which is 00:00 UTC in summer and 01:00 in winter:
#: 02:00 UTC is after it in both, with an hour to spare.
DEFAULT_TIME = "02:00"


def utcnow() -> datetime:
    """Naive UTC, as every timestamp in this database is stored."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# --------------------------------------------------------------------------
# Pure
# --------------------------------------------------------------------------

def clean_host(value: object) -> str | None:
    """A hostname as it is compared and shown: lower case, no scheme, path,
    port or trailing dot. Anything that is not one is None."""
    if not isinstance(value, str):
        return None
    host = value.strip().lower().split("://", 1)[-1].split("/", 1)[0].split(":", 1)[0].rstrip(".")
    return host if host and "." in host and " " not in host else None


def read_answer(data: object, sent: list[str]) -> dict[str, str]:
    """Domain → its AMP host, from {"domain.com": "amp-host", "other.com": ""}.

    Only domains that were asked about are believed, and "" (a site the
    rotator does not know) or anything that is not a hostname is left out.
    """
    if not isinstance(data, dict):
        return {}
    wanted = {d.lower(): d for d in sent}
    found: dict[str, str] = {}
    for name, value in data.items():
        domain = wanted.get(str(name).strip().lower())
        amp = clean_host(value)
        if domain is not None and amp is not None:
            found[domain] = amp
    return found


class AmpPeriod(NamedTuple):
    """Whose AMP domain a host is, or was, and when."""
    #: The project domain, as the project spells it.
    domain: str
    #: The first and the last time a rotator named it for that domain. These
    #: are the days SERP Monitor HEARD it — the rotator says which host is
    #: current, never since when — so it may have been the AMP domain before
    #: the first of them.
    first: datetime
    last: datetime
    #: The latest answer about that domain still names it.
    current: bool
    #: "rotator" (a daily answer named it) or "config" (an uploaded AMP config
    #: listed it before the current one: `last` is then only "before this day").
    source: str = "rotator"


def periods(seen: list[tuple], domains: list[str],
            current: set[tuple[str, str]] | frozenset = frozenset()) -> dict[str, AmpPeriod]:
    """AMP host → whose AMP domain it is, or was, and when.

    `seen` are (domain, AMP host, first named, last named[, source]) from the history;
    `domains` are the project's own, as it spells them; `current` the
    (domain, AMP host) pairs of the rotators' latest answers.

    * Only for domains still in the project: one taken off the list takes its
      AMP hosts with it.
    * A host that is itself on the project's list is not an AMP host here — it
      was put there by hand and counts as itself.
    * A host named for two domains goes to the one it was named for last.
    """
    mine = {clean_host(d): d for d in domains if clean_host(d)}
    out: dict[str, AmpPeriod] = {}
    for domain, host, first, last, *rest in seen:
        owner = mine.get(domain)
        if owner is None or host in mine:
            continue
        prior = out.get(host)
        if prior is None or last > prior.last:
            out[host] = AmpPeriod(owner, first, last, (domain, host) in current, rest[0] if rest else "rotator")
    return out


def owners(seen: list[tuple[str, str, datetime]], domains: list[str]) -> dict[str, str]:
    """AMP host → the project domain it is, or was, the AMP domain of. `seen`
    are (domain, AMP host, last named); the rules are `periods`'."""
    return {host: p.domain for host, p in periods([(d, h, last, last) for d, h, last in seen], domains).items()}


def as_dates(period: AmpPeriod | None) -> dict | None:
    """A period as the page gets it: {"from", "to"} — `to` None while the
    latest answer still names the host."""
    if period is None:
        return None
    return {"from": period.first, "to": None if period.current else period.last, "source": period.source}


# --------------------------------------------------------------------------
# A rotator's AMP config: the past AMP domains SERP Monitor missed
# --------------------------------------------------------------------------

class ConfigSite(NamedTuple):
    """One site of a rotator's AMP config, as it is read here."""
    site: str
    #: The AMP domains, in the config's order: earlier rotations first.
    amps: list[str]


def read_config(data: object) -> tuple[list[ConfigSite], list[str]]:
    """(the sites, what could not be read) from a rotator's AMP config:

        [{"site": "a.com", "folder": "a.com", "active-amp": "x.top",
          "amps": ["d1.com", "d2.com", …], "verification": {…}}, …]

    "folder", "active-amp" and "verification" are not used: which AMP domain
    is current comes from SERP Monitor's own daily checks. Raises ValueError
    when the file is not a list at all."""
    if not isinstance(data, list):
        raise ValueError("The AMP config must be a JSON list of sites: [{\"site\": …, \"amps\": […]}, …]")
    sites: list[ConfigSite] = []
    problems: list[str] = []
    for n, item in enumerate(data, start=1):
        site = clean_host(item.get("site")) if isinstance(item, dict) else None
        raw = item.get("amps") if isinstance(item, dict) else None
        if site is None:
            problems.append(f"entry {n}: no \"site\"")
            continue
        if not isinstance(raw, list):
            problems.append(f"{site}: no \"amps\" list")
            continue
        amps: list[str] = []
        for value in raw:
            host = clean_host(value)
            if host and host not in amps:
                amps.append(host)
        sites.append(ConfigSite(site, amps))
    return sites, problems


def past_from_config(sites: list[ConfigSite], domains: list[str],
                     last_named: dict[str, str]) -> tuple[list[tuple[str, str]], list[dict]]:
    """(the (domain, AMP host) pairs to add, a line per site saying what was
    taken or why not).

    The user's rule (2026-10-16): "check which AMP is current based on daily
    checks in SERP Monitor, identify the main site looking at "site", then
    take only the AMPs that precede from "amps" the last daily checked AMP".
    `last_named` maps a project domain (bare host) to the AMP host the daily
    checks named last for it. The ones after it in the list are the site's
    next AMP domains, not yet in use: not taken.
    """
    mine = {clean_host(d) for d in domains if clean_host(d)}
    pairs: list[tuple[str, str]] = []
    report: list[dict] = []
    for s in sites:
        if s.site not in mine:
            report.append({"site": s.site, "status": "not_in_project"})
            continue
        current = last_named.get(s.site)
        if current is None:
            report.append({"site": s.site, "status": "never_checked"})
            continue
        if current not in s.amps:
            report.append({"site": s.site, "status": "current_not_listed", "current": current})
            continue
        past = [h for h in s.amps[:s.amps.index(current)] if h not in mine]
        pairs += [(s.site, h) for h in past]
        report.append({"site": s.site, "status": "ok", "current": current, "past": past})
    return pairs, report


def import_config(db, endpoint: AmpEndpoint, data: object, file_name: str | None = None) -> dict:
    """Read a rotator's AMP config and add the past AMP domains it reveals to
    the project's history, where the positions tables, the Blocks tab and the
    Proxy Checker find them. Dated "before" the day the current AMP domain was
    first named. A pair already known keeps what it was known from. Commits,
    and keeps a summary on the endpoint. Raises ValueError on a file that is
    not a config."""
    project = db.get(Project, endpoint.project_id)
    sites, problems = read_config(data)
    # What the daily checks named last for each domain, and since when.
    latest: dict[str, tuple[str, datetime, datetime]] = {}
    for domain, host, first, last in (
        db.query(AmpDomainSeen.domain, AmpDomainSeen.amp_domain, AmpDomainSeen.first_seen, AmpDomainSeen.last_seen)
        .filter(AmpDomainSeen.project_id == project.id, AmpDomainSeen.source == "rotator").all()
    ):
        if domain not in latest or last > latest[domain][2]:
            latest[domain] = (host, first, last)
    pairs, report = past_from_config(sites, list(project.domains or []), {d: v[0] for d, v in latest.items()})
    known = {(d, h) for d, h in db.query(AmpDomainSeen.domain, AmpDomainSeen.amp_domain)
             .filter(AmpDomainSeen.project_id == project.id).all()}
    new = [(project.id, d, h, latest[d][1], latest[d][1]) for d, h in pairs if (d, h) not in known]
    remember(db, new, again=False, source="config")
    summary = {
        "uploaded_at": utcnow().isoformat(), "file_name": file_name, "sites": len(sites),
        "added": len(new), "known": len(pairs) - len(new),
        "report": report, "problems": problems[:20],
    }
    endpoint.config = summary
    db.commit()
    return summary


def valid_time(value: str | None) -> bool:
    """HH:MM, 24-hour."""
    try:
        return bool(value) and datetime.strptime(value, "%H:%M").strftime("%H:%M") == value
    except ValueError:
        return False


def last_tick(now: datetime, hhmm: str) -> datetime:
    """The most recent daily moment at or before `now` (both UTC)."""
    hour, minute = (int(x) for x in hhmm.split(":"))
    today = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return today if today <= now else today - timedelta(days=1)


def is_due(fetched_at: datetime | None, now: datetime, hhmm: str) -> bool:
    """Whether an endpoint still owes the fetch of the latest daily moment —
    it has never been asked, or was last asked before that moment."""
    return fetched_at is None or fetched_at < last_tick(now, hhmm)


class Fetched(NamedTuple):
    ok: bool
    status_code: int | None          # None = no HTTP answer at all
    amp: dict[str, str]              # domain → AMP host, when ok
    error: str | None                # why not, without the credentials


def _safe(text: str, username: str, password: str) -> str:
    """An error message with the credentials taken out, however they got in."""
    text = redact(text) or ""
    for secret in (password, username):
        if len(secret) >= 4:
            text = text.replace(secret, "<hidden>")
    return text[:300]


def fetch(url: str, username: str, password: str, domains: list[str],
          client: httpx.Client | None = None) -> Fetched:
    """Ask one rotator about `domains`. Never raises: a rotator that is down
    is an outcome to show, not a reason to fail whatever asked."""
    own = client is None
    client = client or httpx.Client(timeout=30)
    try:
        r = client.post(url, json=list(domains), auth=(username, password),
                        headers={"Accept": "application/json"})
        if not 200 <= r.status_code < 300:
            return Fetched(False, r.status_code, {}, _safe(f"HTTP {r.status_code}: {(r.text or '').strip()[:200]}", username, password))
        try:
            data = r.json()
        except ValueError:
            return Fetched(False, r.status_code, {}, "the answer is not JSON")
        if not isinstance(data, dict):
            return Fetched(False, r.status_code, {}, "the answer is not a domain-to-AMP mapping")
        return Fetched(True, r.status_code, read_answer(data, domains), None)
    except (httpx.HTTPError, httpx.InvalidURL) as e:
        return Fetched(False, None, {}, _safe(f"{type(e).__name__}: {e}", username, password))
    finally:
        if own:
            client.close()


# --------------------------------------------------------------------------
# The login and password (one pair for every rotator)
# --------------------------------------------------------------------------

def credentials() -> tuple[str, str]:
    """(login, password) — the real password; for the asking only."""
    db = SessionLocal()
    try:
        return (_get(db, KEY_USERNAME) or "").strip(), _get(db, KEY_PASSWORD) or ""
    finally:
        db.close()


def set_credentials(*, username: str | None = None, password: str | None = None) -> None:
    """Only what is given changes; an empty string clears that field."""
    db = SessionLocal()
    try:
        if username is not None:
            _set(db, KEY_USERNAME, username.strip() or None)
        if password is not None:
            _set(db, KEY_PASSWORD, password or None)
    finally:
        db.close()


def credentials_status() -> dict:
    """What the browser may see: the login, and only WHETHER a password is saved."""
    username, password = credentials()
    return {"username": username, "has_password": bool(password), "ready": bool(username and password)}


# --------------------------------------------------------------------------
# Asking and keeping
# --------------------------------------------------------------------------

#: Rows per statement when the history is written, and hosts per IN (…) when
#: it is read: far under SQLite's limit on bound values whatever the build.
_CHUNK = 400


def remember(db, rows: list[tuple[int, str, str, datetime, datetime]], *, again: bool = True,
             source: str = "rotator") -> None:
    """Add (project, domain, AMP host, first named, last named) to the history.
    A pair already there keeps its first date and, with `again`, takes the new
    last one. One statement per chunk, so two endpoints of one project fetched
    at the same minute cannot trip over each other. Not committed here."""
    for i in range(0, len(rows), _CHUNK):
        stmt = sqlite_insert(AmpDomainSeen).values([
            {"project_id": p, "domain": d, "amp_domain": h, "first_seen": first, "last_seen": last, "source": source}
            for p, d, h, first, last in rows[i:i + _CHUNK]
        ])
        key = ["project_id", "domain", "amp_domain"]
        db.execute(stmt.on_conflict_do_update(index_elements=key, set_={"last_seen": stmt.excluded.last_seen})
                   if again else stmt.on_conflict_do_nothing(index_elements=key))


def remember_current(db) -> None:
    """Start-up: the AMP hosts on record today are in the history too. They
    are once a rotator has answered; this covers the answers that came before
    the history was kept. Changes nothing when they are all there."""
    remember(db, [(a.project_id, a.domain, a.amp_domain, a.since, a.fetched_at)
                  for a in db.query(AmpDomain).all()], again=False)
    db.commit()


def amp_periods(db, project: Project) -> dict[str, AmpPeriod]:
    """AMP host → whose AMP domain it is, or was, and when: every one a
    rotator has named for this project. See `periods` for the rules."""
    rows = (db.query(AmpDomainSeen.domain, AmpDomainSeen.amp_domain,
                     AmpDomainSeen.first_seen, AmpDomainSeen.last_seen, AmpDomainSeen.source)
            .filter(AmpDomainSeen.project_id == project.id).all())
    current = {(d, h) for d, h in db.query(AmpDomain.domain, AmpDomain.amp_domain)
               .filter(AmpDomain.project_id == project.id).all()}
    return periods([tuple(r) for r in rows], list(project.domains or []), current)


def amp_hosts(db, project: Project) -> dict[str, str]:
    """AMP host → the project domain it is, or was, the AMP domain of: every
    one a rotator has named for this project. What the positions tables count
    as the project's beside its own domains."""
    return {host: p.domain for host, p in amp_periods(db, project).items()}


def project_domains(project: Project) -> list[str]:
    seen: list[str] = []
    for d in project.domains or []:
        host = clean_host(d)
        if host and host not in seen:
            seen.append(host)
    return seen


def refresh_endpoint(endpoint_id: int, client: httpx.Client | None = None) -> bool:
    """Ask one endpoint about its project's domains and keep the answer.
    True when the rotator answered. Own session: called from the scheduler,
    from start-up and from a request alike."""
    db = SessionLocal()
    try:
        endpoint = db.get(AmpEndpoint, endpoint_id)
        project = db.get(Project, endpoint.project_id) if endpoint else None
        if endpoint is None or project is None:
            return False
        domains = project_domains(project)
        url = endpoint.url
    finally:
        db.close()

    # The request is made with NO session open: a slow rotator must not hold a
    # database connection, and SQLite has one writer.
    username, password = credentials()
    if not (username and password):
        got = Fetched(False, None, {}, "no login and password are saved for the AMP Rotators")
    elif not domains:
        got = Fetched(False, None, {}, "the project has no domains to ask about")
    else:
        got = fetch(url, username, password, domains, client)

    db = SessionLocal()
    try:
        endpoint = db.get(AmpEndpoint, endpoint_id)
        if endpoint is None:                     # removed while the request was out
            return False
        now = utcnow()
        endpoint.fetched_at, endpoint.ok, endpoint.status_code = now, got.ok, got.status_code
        endpoint.error, endpoint.sent = got.error, len(domains)
        if got.ok:
            have = {a.domain: a for a in db.query(AmpDomain).filter(AmpDomain.endpoint_id == endpoint_id).all()}
            for domain, amp in got.amp.items():
                row = have.pop(domain, None)
                if row is None:
                    db.add(AmpDomain(endpoint_id=endpoint_id, project_id=endpoint.project_id,
                                     domain=domain, amp_domain=amp, since=now, fetched_at=now))
                else:
                    if row.amp_domain != amp:
                        row.amp_domain, row.since = amp, now
                    row.fetched_at = now
            for gone in have.values():           # the rotator no longer names these
                db.delete(gone)
            # Into the history too, where a host stays after the rotator moves on.
            remember(db, [(endpoint.project_id, domain, amp, now, now) for domain, amp in got.amp.items()])
        else:
            log.warning("amp rotator: endpoint %s (project %s) not fetched: %s", endpoint_id, endpoint.project_id, got.error)
        db.commit()
        return got.ok
    finally:
        db.close()


def refresh_project(project_id: int) -> int:
    """Every endpoint of one project. Returns how many answered."""
    db = SessionLocal()
    try:
        ids = [e.id for e in db.query(AmpEndpoint).filter(AmpEndpoint.project_id == project_id).all()]
    finally:
        db.close()
    return sum(refresh_endpoint(i) for i in ids)


def endpoint_time(endpoint: AmpEndpoint) -> str:
    return endpoint.fetch_time if valid_time(endpoint.fetch_time) else DEFAULT_TIME


def refresh_due() -> int:
    """Every endpoint that still owes the fetch of its own latest daily moment."""
    now = utcnow()
    db = SessionLocal()
    try:
        ids = [e.id for e in db.query(AmpEndpoint).all() if is_due(e.fetched_at, now, endpoint_time(e))]
    finally:
        db.close()
    return sum(refresh_endpoint(i) for i in ids)


def daily_refresh(endpoint_id: int) -> None:
    """The scheduler's callable (top-level, so the job store can pickle it):
    one endpoint, at its own time."""
    try:
        refresh_endpoint(endpoint_id)
    except Exception:  # noqa: BLE001
        log.exception("amp rotator: the daily fetch of endpoint %s failed", endpoint_id)


def catch_up() -> None:
    """At start-up, off the request path: fetch for the endpoints whose daily
    moment passed while the app was not running."""
    def work() -> None:
        try:
            done = refresh_due()
            if done:
                log.info("amp rotator: caught up %d endpoint(s) at start-up", done)
        except Exception as e:  # noqa: BLE001 - never take the app down
            log.warning("amp rotator: start-up catch-up failed: %s", redact(str(e)))
    threading.Thread(target=work, name="amp-rotator-catch-up", daemon=True).start()


def remove_endpoint(db, endpoint: AmpEndpoint) -> None:
    """An endpoint and what it fetched. Explicit: SQLite only cascades with
    the foreign-key pragma on, and it is not. Not committed here."""
    db.query(AmpDomain).filter(AmpDomain.endpoint_id == endpoint.id).delete(synchronize_session=False)
    db.delete(endpoint)


def remove_project(db, project_id: int) -> list[int]:
    """A deleted project's endpoints and AMP domains, with their history.
    Returns the endpoints' ids, whose daily ticks the caller takes off the
    scheduler. Not committed here."""
    db.query(AmpDomainSeen).filter(AmpDomainSeen.project_id == project_id).delete(synchronize_session=False)
    endpoints = db.query(AmpEndpoint).filter(AmpEndpoint.project_id == project_id).all()
    ids = [e.id for e in endpoints]
    for endpoint in endpoints:
        remove_endpoint(db, endpoint)
    return ids
