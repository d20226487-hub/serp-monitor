"""Connected tools (Settings → Tools Connection, and each project's page).

Today: the Proxy Checker — see ../proxy_checker.py for what is sent and why.
The connection is global; WHEN a project's domains are sent is the project's
own setting, as the user asked. AMP Rotator comes later.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import blocks
from .. import proxy_checker as pc
from ..amp_rotator import amp_periods, as_dates
from ..db import get_db
from ..models import DomainProxyCheckLog, Project, ToolDelivery
from ..scheduler import (
    direct_check_next_run, proxy_checker_next_run, upsert_direct_check_schedule,
    upsert_proxy_checker_schedule,
)
from .project_positions import _parse_stamp, project_positions

router = APIRouter(tags=["tools"])


def _delivery(d: ToolDelivery, names: dict[int, str] | None = None) -> dict:
    return {
        "id": d.id, "project_id": d.project_id,
        "project_name": (names or {}).get(d.project_id) if d.project_id else None,
        "run_id": d.run_id, "trigger": d.trigger, "geo": d.geo, "domains": d.domains or [],
        "ok": d.ok, "status_code": d.status_code, "response": d.response, "sent_at": d.sent_at,
        # The request as a curl command and the answer as received; null on
        # sends made before they were kept.
        "curl": pc.curl_command(d.request), "response_raw": d.response_raw,
    }


def _recent(db: Session, project_id: int | None = None, limit: int = 12) -> list[dict]:
    q = db.query(ToolDelivery).filter(ToolDelivery.tool == pc.TOOL)
    if project_id is not None:
        q = q.filter(ToolDelivery.project_id == project_id)
    rows = q.order_by(ToolDelivery.sent_at.desc(), ToolDelivery.id.desc()).limit(limit).all()
    names = dict(db.query(Project.id, Project.name).all())
    return [_delivery(r, names) for r in rows]


# --- the connection (global) ------------------------------------------------

class ProxyCheckerConnectionIn(BaseModel):
    #: Omitted = unchanged. "" = cleared.
    url: str | None = None
    token: str | None = None
    #: The global switch: send after every SERP check and CSV upload, for the
    #: projects that follow it. Omitted = unchanged.
    auto_after_run: bool | None = None
    #: How long an answer is waited for, in minutes. Omitted = unchanged.
    timeout_minutes: int | None = None


@router.get("/settings/tools/proxy-checker")
def get_proxy_checker(db: Session = Depends(get_db)):
    auto = pc.auto_after_run()
    projects = [
        {"id": p.id, "name": p.name, "mode": p.proxy_checker_mode, "time": p.proxy_checker_time,
         "effective_mode": pc.effective_mode(p.proxy_checker_mode, auto)}
        for p in db.query(Project).order_by(Project.name).all()
    ]
    return {
        **pc.connection_status(), "auto_after_run": auto,
        # How long an answer is waited for, and the range it may be set in.
        "timeout_minutes": pc.timeout_minutes(),
        "timeout_range": [pc.TIMEOUT_MINUTES_MIN, pc.TIMEOUT_MINUTES_MAX],
        "projects": projects, "deliveries": _recent(db),
    }


@router.put("/settings/tools/proxy-checker")
def update_proxy_checker(payload: ProxyCheckerConnectionIn, db: Session = Depends(get_db)):
    url = payload.url
    if url is not None and url.strip() and not url.strip().lower().startswith(("https://", "http://")):
        raise HTTPException(400, "The API address must start with https:// or http://")
    if payload.timeout_minutes is not None and not (
            pc.TIMEOUT_MINUTES_MIN <= payload.timeout_minutes <= pc.TIMEOUT_MINUTES_MAX):
        raise HTTPException(
            400, f"The wait must be {pc.TIMEOUT_MINUTES_MIN}–{pc.TIMEOUT_MINUTES_MAX} minutes")
    pc.set_connection(url=url, token=payload.token)
    if payload.auto_after_run is not None:
        pc.set_auto_after_run(payload.auto_after_run)
    if payload.timeout_minutes is not None:
        pc.set_timeout_minutes(payload.timeout_minutes)
    return get_proxy_checker(db)


@router.delete("/settings/tools/proxy-checker")
def clear_proxy_checker(db: Session = Depends(get_db)):
    """Forget the address and the token. Projects keep their schedules; with
    the connection gone nothing is sent."""
    pc.set_connection(url="", token="")
    return get_proxy_checker(db)


# --- one project's schedule -------------------------------------------------

class ProxyCheckerScheduleIn(BaseModel):
    mode: str
    #: For "daily": HH:MM, UTC.
    time: str | None = None
    #: Which of the project's GEOs to send. Omitted = unchanged; null = all of
    #: them (also ones added later); a list = only those.
    geos: list[str] | None = None


class ProjectGeosIn(BaseModel):
    #: ISO country codes. null = forget the list: the jobs' countries stand in.
    geos: list[str] | None = None


def _project(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404)
    return project


def _geos_state(db: Session, project: Project) -> dict:
    from_jobs = pc.job_countries(db, project.id)
    return {
        # null = never set on the project page; `effective` is what is used.
        "geos": pc.clean_geos(project.geos) if project.geos is not None else None,
        "effective": pc.project_geos(db, project),
        "from_jobs": from_jobs,
    }


def _project_state(db: Session, project: Project) -> dict:
    project_geos = pc.project_geos(db, project)
    amp_parents = pc.amp_parents(db, project)
    # What the SERPs of the last 24 hours showed, then what rides along.
    found = pc.keep_geos(pc.found_by_geo(db, project, since=pc.recent_window()), project_geos)
    preview = pc.add_amp(found, pc.amp_of(db, project.id))
    auto = pc.auto_after_run()
    return {
        "mode": project.proxy_checker_mode or "off",
        # "inherit" follows the global switch in Settings; what it comes to now.
        "auto_after_run": auto,
        "effective_mode": pc.effective_mode(project.proxy_checker_mode, auto),
        "time": project.proxy_checker_time,
        "next_run": proxy_checker_next_run(project.id),
        "connected": pc.connection_status()["connected"],
        "window_hours": pc.WINDOW_HOURS,
        # The project's GEOs to choose among, and the choice (null = all).
        "project_geos": project_geos,
        "geos": pc.clean_geos(project.proxy_checker_geos) if project.proxy_checker_geos is not None else None,
        # What a send would carry: the project's domains its checks found in
        # the last 24 hours, the AMP domains found there themselves, and the
        # AMP domain of the day of each found domain, by country, for EVERY
        # project GEO — the page narrows it to the chosen ones as they are
        # toggled, so the effect of a choice shows before saving.
        "preview": preview,
        # Which of those are AMP domains: found in that country themselves, or
        # sent because their main domain was found there.
        "preview_amp": {geo: [d for d in domains if d in amp_parents] for geo, domains in preview.items()},
        # How many of them the SERPs showed; the rest ride along.
        "preview_found": {geo: len(domains) for geo, domains in found.items()},
        "deliveries": _recent(db, project.id),
        # The project's sends running now (see proxy_checker.in_progress).
        "sending": pc.in_progress(project.id),
    }


#: Said when a button is pressed while a send of the project is running.
BUSY = "A send to the Proxy Checker for this project is already running: wait for it to finish."


@router.get("/lookup/countries")
def list_countries():
    """Every country, for the project's GEO picker: Google's geo-targets list
    has them all with their ISO codes. Empty until that list is mirrored."""
    from ..provider_locations import MirrorSession, ProviderLocation
    with MirrorSession() as m:
        rows = (
            m.query(ProviderLocation.country_code, ProviderLocation.name)
            .filter(ProviderLocation.provider == "google", ProviderLocation.location_type == "Country")
            .all()
        )
    seen: dict[str, str] = {}
    for code, name in rows:
        if code and len(code) == 2:
            seen.setdefault(code.upper(), name)
    return [{"code": c, "name": n} for c, n in sorted(seen.items(), key=lambda kv: kv[1])]


@router.get("/projects/{project_id}/geos")
def get_project_geos(project_id: int, db: Session = Depends(get_db)):
    return _geos_state(db, _project(db, project_id))


@router.put("/projects/{project_id}/geos")
def update_project_geos(project_id: int, payload: ProjectGeosIn, db: Session = Depends(get_db)):
    project = _project(db, project_id)
    if payload.geos is None:
        project.geos = None
    else:
        cleaned = pc.clean_geos(payload.geos)
        if len(cleaned) != len([g for g in payload.geos if str(g or "").strip()]):
            raise HTTPException(400, "GEOs must be two-letter country codes, each once (for example KG, KZ, UZ)")
        project.geos = cleaned
    db.commit()
    db.refresh(project)
    return _geos_state(db, project)


@router.get("/projects/{project_id}/proxy-checker")
def get_project_proxy_checker(project_id: int, db: Session = Depends(get_db)):
    return _project_state(db, _project(db, project_id))


@router.put("/projects/{project_id}/proxy-checker")
def update_project_proxy_checker(
    project_id: int, payload: ProxyCheckerScheduleIn, db: Session = Depends(get_db),
):
    project = _project(db, project_id)
    if payload.mode not in pc.MODES:
        raise HTTPException(400, f"mode must be one of {', '.join(pc.MODES)}")
    if payload.mode == "daily" and not pc.valid_time(payload.time):
        raise HTTPException(400, "A daily send needs a time as HH:MM")
    project.proxy_checker_mode = payload.mode
    if payload.mode == "daily":
        project.proxy_checker_time = payload.time
    if "geos" in payload.model_fields_set:
        project.proxy_checker_geos = None if payload.geos is None else pc.clean_geos(payload.geos)
    db.commit()
    db.refresh(project)
    upsert_proxy_checker_schedule(project)
    return _project_state(db, project)


@router.post("/projects/{project_id}/proxy-checker/send")
async def send_project_now(project_id: int, db: Session = Depends(get_db)):
    """"Send now": the last 24 hours' findings, whatever the project's mode."""
    project = _project(db, project_id)
    if not pc.connection_status()["connected"]:
        raise HTTPException(
            409, "The Proxy Checker is not connected: add its address and token in Settings → Tools Connection.")
    try:
        sent = await run_in_threadpool(lambda: pc.send_recent(project.id, "manual", exclusive=True))
    except pc.Busy:
        raise HTTPException(409, BUSY)
    return {"sent": [_delivery(d) for d in sent], **_project_state(db, project)}


# --- checking chosen domains without a SERP ----------------------------------

class DirectCheckIn(BaseModel):
    enabled: bool
    #: Every how many hours: one of proxy_checker.DIRECT_HOURS.
    hours: int
    #: Which of the project's domains. Omitted = unchanged; null = all of them
    #: (also ones added later); a list = only those.
    domains: list[str] | None = None
    #: Which of the project's GEOs, likewise.
    geos: list[str] | None = None


def _direct_state(db: Session, project: Project) -> dict:
    project_domains = [d for d in (project.domains or []) if d]
    chosen = project.direct_check_domains
    project_geos = pc.project_geos(db, project)
    last = (db.query(ToolDelivery.sent_at)
            .filter(ToolDelivery.tool == pc.TOOL, ToolDelivery.project_id == project.id,
                    ToolDelivery.trigger.in_(pc.DIRECT_TRIGGERS))
            .order_by(ToolDelivery.sent_at.desc()).first())
    amp = pc.amp_of(db, project.id)
    return {
        "enabled": bool(project.direct_check_enabled),
        "hours": project.direct_check_hours or pc.DEFAULT_DIRECT_HOURS,
        "hours_choices": list(pc.DIRECT_HOURS),
        "project_domains": project_domains,
        # null = all of them; a list = only those, as still in the project.
        "domains": None if chosen is None else pc.direct_domains(project_domains, chosen),
        # The project's GEOs, whether they were set on the project page or are
        # the jobs' countries standing in, and which are checked: null = all.
        "project_geos": project_geos,
        "geos_set": project.geos is not None,
        "geos": None if project.direct_check_geos is None
        else pc.geos_to_send(project_geos, project.direct_check_geos),
        # Domain → its AMP domain(s) of the day, which ride along.
        "amp": {d: amp[d] for d in project_domains if d in amp},
        "next_run": direct_check_next_run(project.id) if project.direct_check_enabled else None,
        "last_at": last[0] if last else None,
        "connected": pc.connection_status()["connected"],
        # The project's sends running now, of any kind: one press at a time.
        "sending": pc.in_progress(project.id),
    }


def _unknown_domains(project: Project, domains: list[str]) -> None:
    known = {d.lower() for d in project.domains or []}
    unknown = [d for d in domains if str(d or "").strip().lower() not in known]
    if unknown:
        raise HTTPException(400, f"Not a domain of this project: {', '.join(unknown[:5])}")


def _known_geos(db: Session, project: Project, geos: list[str]) -> list[str]:
    """The GEOs as stored; any that is not one of the project's is refused."""
    known = set(pc.project_geos(db, project))
    unknown = [g for g in geos if str(g or "").strip().upper() not in known]
    if unknown:
        raise HTTPException(400, f"Not a GEO of this project: {', '.join(map(str, unknown[:5]))}")
    return pc.clean_geos(geos)


@router.get("/projects/{project_id}/direct-check")
def get_direct_check(project_id: int, db: Session = Depends(get_db)):
    return _direct_state(db, _project(db, project_id))


@router.put("/projects/{project_id}/direct-check")
def update_direct_check(project_id: int, payload: DirectCheckIn, db: Session = Depends(get_db)):
    project = _project(db, project_id)
    if payload.hours not in pc.DIRECT_HOURS:
        raise HTTPException(400, f"hours must be one of {', '.join(map(str, pc.DIRECT_HOURS))}")
    if "domains" in payload.model_fields_set and payload.domains is not None:
        _unknown_domains(project, payload.domains)
        project.direct_check_domains = pc.direct_domains(project.domains or [], payload.domains)
    elif "domains" in payload.model_fields_set:
        project.direct_check_domains = None
    if "geos" in payload.model_fields_set:
        project.direct_check_geos = None if payload.geos is None else _known_geos(db, project, payload.geos)
    # The timer counts from when it was switched on or its interval changed;
    # choosing other domains or GEOs leaves it where it is.
    if payload.enabled and (not project.direct_check_enabled or payload.hours != project.direct_check_hours
                            or project.direct_check_since is None):
        project.direct_check_since = datetime.now(timezone.utc).replace(tzinfo=None)
    project.direct_check_enabled = payload.enabled
    project.direct_check_hours = payload.hours
    db.commit()
    db.refresh(project)
    upsert_direct_check_schedule(project)
    return _direct_state(db, project)


class DirectCheckRunIn(BaseModel):
    #: The domains and GEOs picked on the page, saved or not. null = all.
    domains: list[str] | None = None
    geos: list[str] | None = None


@router.post("/projects/{project_id}/direct-check/run")
async def run_direct_check(project_id: int, payload: DirectCheckRunIn | None = None, db: Session = Depends(get_db)):
    """"Check now": once, whether or not the timer is on — the domains and
    GEOs picked on the page (no body: the timer's choice)."""
    project = _project(db, project_id)
    if not pc.connection_status()["connected"]:
        raise HTTPException(
            409, "The Proxy Checker is not connected: add its address and token in Settings → Tools Connection.")
    domains = project.direct_check_domains if payload is None else payload.domains
    geos = project.direct_check_geos if payload is None else payload.geos
    if domains is not None:
        _unknown_domains(project, domains)
    if geos is not None:
        geos = _known_geos(db, project, geos)
    try:
        sent = await run_in_threadpool(
            lambda: pc.direct_check(project.id, "direct_manual", domains, geos, exclusive=True))
    except pc.Busy:
        raise HTTPException(409, BUSY)
    db.expire_all()
    return {"sent": [_delivery(d) for d in sent], **_direct_state(db, project)}


# --- which domains are in the SERPs, and what each proxy says of them --------

def _period(db: Session, project: Project, start: str | None, end: str | None) -> tuple[list[dict], list[dict], bool]:
    """What both views of a period are built from: (the project's domains in
    the SERPs around it, the proxies' newest answers inside it, whether the
    period reaches today). See ../blocks.py for why the SERPs are read a week
    further back than the answers."""
    since, until = _parse_stamp(start, "start"), _parse_stamp(end, "end")
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    query = db.query(DomainProxyCheckLog).filter(DomainProxyCheckLog.project_id == project.id)
    if since is not None:
        query = query.filter(DomainProxyCheckLog.checked_at >= since)
    if until is not None:
        query = query.filter(DomainProxyCheckLog.checked_at < until)
    newest: dict[tuple[str, str], DomainProxyCheckLog] = {}
    for c in query.order_by(DomainProxyCheckLog.checked_at.desc(), DomainProxyCheckLog.id.desc()).all():
        newest.setdefault((c.geo, c.domain), c)
    # Which of those answers came from a check without a SERP: such a domain
    # may stand nowhere, and the page says why it is listed all the same.
    sent_ids = list({c.delivery_id for c in newest.values() if c.delivery_id is not None})
    direct_ids: set[int] = set()
    for i in range(0, len(sent_ids), 400):
        direct_ids |= {d for (d,) in db.query(ToolDelivery.id).filter(
            ToolDelivery.id.in_(sent_ids[i:i + 400]), ToolDelivery.trigger.in_(pc.DIRECT_TRIGGERS)).all()}
    checks = [
        {"geo": c.geo, "domain": c.domain, "main_domain": c.main_domain, "statuses": c.statuses,
         "checked_at": c.checked_at, "direct": c.delivery_id in direct_ids}
        for c in newest.values()
    ]

    upto = until or now
    back = (since or upto) - timedelta(days=blocks.STANDING_DAYS)
    standing = blocks.in_serps(
        project_positions(project.id, back.isoformat(), upto.isoformat(), db), pc.project_geos(db, project))
    return standing, checks, until is None or until > now


def _with_amp_dates(db: Session, project: Project, amp_rows: list[dict]) -> None:
    """When each AMP domain was the AMP domain of its site, as far as the
    rotators' answers go (user, 2026-10-14: "give the date when the domain was
    AMP for the main domain"): {"from", "to"}, `to` null while it still is."""
    periods = amp_periods(db, project)
    for r in amp_rows:
        r["amp_period"] = as_dates(periods.get(r["domain"]))


@router.get("/projects/{project_id}/blocks")
def project_blocks(
    project_id: int,
    start: str | None = Query(None, description="ISO-8601, inclusive"),
    end: str | None = Query(None, description="ISO-8601, exclusive"),
    demo: bool = Query(False, description="Made-up proxy statuses over the real rows, to preview the table"),
    db: Session = Depends(get_db),
):
    """The Blocks tab for a period: one row per (country, domain) — where it
    ranks, and the status each proxy gave it in that period — and the same for
    the AMP domains. See blocks.period_rows."""
    project = _project(db, project_id)
    standing, checks, reaches_today = _period(db, project, start, end)
    # Today's AMP domains can only be added to a period that includes today:
    # yesterday's are known only where they were checked.
    amp_map = pc.amp_of(db, project.id) if reaches_today else {}
    rows, amp_rows = blocks.period_rows(standing, checks, amp_map)
    _with_amp_dates(db, project, amp_rows)

    sending = set(pc.send_geos(db, project))
    # The last time each domain went to the Proxy Checker for each country, and
    # how that went — the reason behind a row no proxy has reported on.
    last_send: dict[tuple[str, str], dict] = {}
    recent = (db.query(ToolDelivery)
              .filter(ToolDelivery.tool == pc.TOOL, ToolDelivery.project_id == project.id)
              .order_by(ToolDelivery.sent_at.desc(), ToolDelivery.id.desc()).limit(500).all())
    for d in recent:
        for domain in d.domains or []:
            last_send.setdefault((d.geo, domain), {"at": d.sent_at, "ok": d.ok, "status_code": d.status_code})

    everything = rows + amp_rows
    for r in everything:
        r["sending"] = r["geo"] in sending
        r["last_send"] = last_send.get((r["geo"], r["domain"]))
    has_real = any(r["proxies"] for r in everything)
    if demo:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        for r in everything:
            r["proxies"], r["checked_at"] = blocks.demo_statuses(r["geo"], r["domain"], now)
            r["kind"] = blocks.kind_of(r["proxies"])
        rows, amp_rows = blocks.ordered(rows), blocks.ordered(amp_rows)
    return {
        "demo": demo,
        # Whether any proxy answered about any of these rows in the period.
        "has_real": has_real,
        "connected": pc.connection_status()["connected"],
        "geos": sorted({r["geo"] for r in everything}),
        # The tables' columns, per country.
        "proxies": blocks.proxies_by_geo(rows),
        "counts": blocks.counts(rows),
        "rows": rows,
        # The same for the AMP domains. `has_amp`: there is an AMP side to show.
        "has_amp": bool(amp_rows) or bool(pc.amp_of(db, project.id)),
        "amp_proxies": blocks.proxies_by_geo(amp_rows),
        "amp_counts": blocks.counts(amp_rows),
        "amp_rows": amp_rows,
    }


@router.get("/projects/{project_id}/blocks/failing")
def project_blocks_failing(
    project_id: int,
    start: str | None = Query(None, description="ISO-8601, inclusive"),
    end: str | None = Query(None, description="ISO-8601, exclusive"),
    db: Session = Depends(get_db),
):
    """The Overview's list: what some proxy did not pass in a period — the
    project's own domains, and the AMP domains sent with them, each by its
    newest answer INSIDE the period. See blocks.not_passing."""
    project = _project(db, project_id)
    standing, checks, _reaches_today = _period(db, project, start, end)
    by_key = {(r["geo"], r["domain"]): r for r in standing}
    main, amp = blocks.not_passing(checks, by_key)
    _with_amp_dates(db, project, amp)
    checked = {(c["geo"], c["domain"]) for c in checks}
    checked_main = {(c["geo"], c["domain"]) for c in checks if not c["main_domain"]}
    return {
        # How many of the project's domains some proxy reported on inside the
        # period, and how many AMP domains.
        "checked": len(checked_main),
        "amp_checked": sum(1 for c in checks if c["main_domain"]),
        # In the SERPs around then — a project domain or an AMP domain — and
        # not reported on inside the period.
        "unchecked": sum(1 for key in by_key if key not in checked),
        "has_amp": any(c["main_domain"] for c in checks) or bool(pc.amp_of(db, project.id)),
        "rows": main,
        "amp_rows": amp,
    }
