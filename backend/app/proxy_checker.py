"""Proxy Checker: hand it the project's own domains that the SERP checks found.

User, 2026-10-05: "We will send our domains (specified in the project and found
in the SERPs during checks) to the Proxy Checker … GEO is taken from the job's
GEO, domains are taken from the SERPs", and on WHEN: "let the user specify this
on the project page".

One request per country:

    POST <url>                      Authorization: Bearer <token>
    {"DailyCheck": {"geo": "KG", "domains": ["lucky-zazino.pro", …]}}

* "Our domains found in the SERPs" is the same question the positions tables
  answer, by the same rule (positions_csv.counted_host / the project domain or
  its www. spelling): a domain is sent for a country only if a check in that
  country actually captured it. A project domain that ranks nowhere is not sent.
* GEO is the result's country code, upper-cased. A check with no location has
  no country, and is not sent anywhere.
* Which GEOs: the project has a list of its GEOs (Project.geos, set on the
  project page — until it is, the countries its jobs check stand in), and of
  those the user picks whose findings go to the Proxy Checker
  (Project.proxy_checker_geos; unset = all of them). A country outside both is
  never sent, however many of our domains its SERPs showed.
* When, per project (Project.proxy_checker_mode): "off"; "after_run" — what
  each finished run found, straight after it; "daily" — once a day at
  proxy_checker_time (UTC, HH:MM), everything found in the last 24 hours. A
  "Send now" on the project page sends the last 24 hours at any time.
* Every request made is kept in tool_deliveries: what went, where, and what
  came back — an integration that fails silently is worse than none.

Assumed, not known (the API's behaviour could only be probed without a token:
403 on GET and POST): each request stands alone, so two projects sending for
the same country do not overwrite one another; and any 2xx means accepted.

The connection (URL, token) is global: Settings → Tools Connection. The token
is stored like the SERP providers' and never returned to the browser. No
address is built in: the Proxy Checker is somebody's own service, so both are
entered there, and until both are nothing is sent.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ._redact import redact
from .app_settings import _get, _set
from .db import SessionLocal
from .models import Job, JobRun, Project, Result, ToolDelivery
from .positions_csv import counted_host

log = logging.getLogger(__name__)

TOOL = "proxy_checker"
KEY_URL = "proxy_checker_url"
KEY_TOKEN = "proxy_checker_token"
MODES = ("off", "after_run", "daily")
#: "Send now" and the daily send look this far back.
WINDOW_HOURS = 24
#: SQLite's oldest builds allow 999 bound values in one statement.
_HOSTS_PER_QUERY = 400


# --------------------------------------------------------------------------
# Connection (global)
# --------------------------------------------------------------------------

def connection() -> dict:
    """{"url", "token"} — the real token; for the sender only."""
    db = SessionLocal()
    try:
        return {"url": (_get(db, KEY_URL) or "").strip(), "token": (_get(db, KEY_TOKEN) or "").strip()}
    finally:
        db.close()


def set_connection(*, url: str | None = None, token: str | None = None) -> None:
    """Only what is given changes; an empty string clears that field."""
    db = SessionLocal()
    try:
        if url is not None:
            _set(db, KEY_URL, url.strip() or None)
        if token is not None:
            _set(db, KEY_TOKEN, token.strip() or None)
    finally:
        db.close()


def connection_status() -> dict:
    """What the browser may see: never the token itself. `connected` = there
    is both an address and a token, i.e. something can be sent."""
    c = connection()
    token = c["token"]
    return {
        "url": c["url"], "connected": bool(c["url"] and token),
        "token": {"configured": True, "last4": token[-4:], "length": len(token)} if token else {"configured": False},
    }


# --------------------------------------------------------------------------
# Pure: what to send
# --------------------------------------------------------------------------

def group_found(rows: list[tuple], domains: list[str]) -> dict[str, list[str]]:
    """Country → the project's domains found there, sorted.

    `rows` are (country_code, linked_host, shown_host, job_prefers_shown) for
    captured results. A result counts as the host the positions tables count
    it as, and matches a project domain exactly or as its www. spelling — a
    subdomain is a different target, which is why projects list them apart.
    """
    by_host = {h: d for d in domains for h in (d.lower(), f"www.{d.lower()}")}
    found: dict[str, set[str]] = {}
    for country, linked, shown, prefers_shown in rows:
        geo = (country or "").strip().upper()
        domain = by_host.get(counted_host(linked, shown, bool(prefers_shown)).lower())
        if geo and domain:
            found.setdefault(geo, set()).add(domain)
    return {geo: sorted(ds) for geo, ds in sorted(found.items())}


def clean_geos(values) -> list[str]:
    """ISO country codes as stored and sent: upper-case, two letters, once
    each, in the order given. Anything else is dropped rather than guessed at."""
    out: list[str] = []
    for v in values or []:
        code = str(v or "").strip().upper()
        if len(code) == 2 and code.isalpha() and code not in out:
            out.append(code)
    return out


def geos_to_send(project_geos: list[str], chosen: list[str] | None) -> list[str]:
    """The countries whose findings go out: the project's GEOs, narrowed to
    the ones chosen for the Proxy Checker. `None` = no choice was made, so all
    of the project's GEOs — also the ones added to it tomorrow. A chosen
    country that is no longer one of the project's is not sent."""
    if chosen is None:
        return list(project_geos)
    return [g for g in project_geos if g in set(clean_geos(chosen))]


def keep_geos(by_geo: dict[str, list[str]], allowed: list[str]) -> dict[str, list[str]]:
    return {geo: domains for geo, domains in by_geo.items() if geo in set(allowed)}


def build_payload(geo: str, domains: list[str]) -> dict:
    return {"DailyCheck": {"geo": geo, "domains": list(domains)}}


def valid_time(value: str | None) -> bool:
    """HH:MM, 24-hour."""
    try:
        return bool(value) and datetime.strptime(value, "%H:%M").strftime("%H:%M") == value
    except ValueError:
        return False


# --------------------------------------------------------------------------
# Loading and sending
# --------------------------------------------------------------------------

def job_countries(db: Session, project_id: int) -> list[str]:
    """The countries the project's jobs check, from their locations."""
    codes: list[str] = []
    for (locations,) in db.query(Job.locations).filter(Job.project_id == project_id).all():
        codes += [(loc or {}).get("country_code") for loc in (locations or []) if isinstance(loc, dict)]
    return sorted(clean_geos(codes))


def project_geos(db: Session, project: Project) -> list[str]:
    """The project's GEOs: the list set on its page, or — never set — the
    countries its jobs check, so a project nobody configured behaves as before."""
    if project.geos is not None:
        return clean_geos(project.geos)
    return job_countries(db, project.id)


def send_geos(db: Session, project: Project) -> list[str]:
    return geos_to_send(project_geos(db, project), project.proxy_checker_geos)


def found_by_geo(db: Session, project: Project, *, run_id: int | None = None,
                 since: datetime | None = None) -> dict[str, list[str]]:
    """The project's domains its checks captured, by country — in one run, or
    in every run of the project started since `since` (naive UTC, as runs are
    stored)."""
    domains = [d for d in (project.domains or []) if d]
    if not domains:
        return {}
    hosts = [h for d in domains for h in (d, f"www.{d}")]
    rows: list[tuple] = []
    for i in range(0, len(hosts), _HOSTS_PER_QUERY):
        part = hosts[i:i + _HOSTS_PER_QUERY]
        q = (
            db.query(Result.country_code, Result.domain, Result.shown_host, Job.prefer_shown_host)
            .join(JobRun, JobRun.id == Result.run_id)
            .join(Job, Job.id == JobRun.job_id)
            .filter(Job.project_id == project.id,
                    or_(Result.domain.in_(part), Result.shown_host.in_(part)))
        )
        if run_id is not None:
            q = q.filter(Result.run_id == run_id)
        if since is not None:
            q = q.filter(JobRun.started_at >= since)
        rows += [tuple(r) for r in q.distinct().all()]
    return group_found(rows, domains)


def recent_window() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=WINDOW_HOURS)


def send_one(url: str, token: str, geo: str, domains: list[str],
             client: httpx.Client | None = None) -> tuple[bool, int | None, str]:
    """(accepted, HTTP status, what came back). Never raises: a failed request
    is an outcome to record, not a reason to fail the run that triggered it."""
    own = client is None
    client = client or httpx.Client(timeout=30)
    try:
        r = client.post(url, json=build_payload(geo, domains),
                        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
        return 200 <= r.status_code < 300, r.status_code, redact(r.text or "")[:300]
    except httpx.HTTPError as e:
        return False, None, redact(f"{type(e).__name__}: {e}")[:300]
    finally:
        if own:
            client.close()


def deliver(db: Session, project: Project, by_geo: dict[str, list[str]], *, trigger: str,
            run_id: int | None = None, client: httpx.Client | None = None) -> list[ToolDelivery]:
    """One request per country, each recorded. Nothing is sent, and nothing
    recorded, when the connection is incomplete (no address or no token) or
    nothing was found."""
    conn = connection()
    if not conn["url"] or not conn["token"] or not by_geo:
        return []
    out = []
    for geo, domains in by_geo.items():
        ok, status, body = send_one(conn["url"], conn["token"], geo, domains, client)
        row = ToolDelivery(tool=TOOL, project_id=project.id, run_id=run_id, trigger=trigger, geo=geo,
                           domains=domains, ok=ok, status_code=status, response=body)
        db.add(row)
        out.append(row)
        if not ok:
            log.warning("proxy checker refused %s for project %s: %s %s", geo, project.id, status, body[:120])
    db.commit()
    return out


def after_run(run_id: int) -> None:
    """Called when ANY run ends (tasks.run_job_async, and the importer of the
    own-browser runs). Sends only for a project set to "after_run". Swallows
    everything: the check that just finished must not fail on its messenger."""
    db = SessionLocal()
    try:
        run = db.get(JobRun, run_id)
        job = db.get(Job, run.job_id) if run else None
        project = db.get(Project, job.project_id) if job and job.project_id else None
        if project is None or project.proxy_checker_mode != "after_run":
            return
        found = keep_geos(found_by_geo(db, project, run_id=run_id), send_geos(db, project))
        deliver(db, project, found, trigger="after_run", run_id=run_id)
    except Exception:  # noqa: BLE001
        log.exception("proxy checker: sending after run %s failed", run_id)
    finally:
        db.close()


def send_recent(project_id: int, trigger: str) -> list[ToolDelivery]:
    """Everything the project's checks found in the last WINDOW_HOURS — the
    daily send and the project page's "Send now"."""
    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        if project is None:
            return []
        found = keep_geos(found_by_geo(db, project, since=recent_window()), send_geos(db, project))
        rows = deliver(db, project, found, trigger=trigger)
        for r in rows:
            db.refresh(r)
            db.expunge(r)
        return rows
    finally:
        db.close()


def daily_send(project_id: int) -> None:
    """The scheduler's callable (top-level, so the job store can pickle it)."""
    try:
        send_recent(project_id, "daily")
    except Exception:  # noqa: BLE001
        log.exception("proxy checker: daily send for project %s failed", project_id)
