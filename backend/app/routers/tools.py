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
from ..db import get_db
from ..models import DomainProxyCheckLog, Project, ToolDelivery
from ..scheduler import proxy_checker_next_run, upsert_proxy_checker_schedule
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


@router.get("/settings/tools/proxy-checker")
def get_proxy_checker(db: Session = Depends(get_db)):
    projects = [
        {"id": p.id, "name": p.name, "mode": p.proxy_checker_mode, "time": p.proxy_checker_time}
        for p in db.query(Project).order_by(Project.name).all()
    ]
    return {**pc.connection_status(), "projects": projects, "deliveries": _recent(db)}


@router.put("/settings/tools/proxy-checker")
def update_proxy_checker(payload: ProxyCheckerConnectionIn, db: Session = Depends(get_db)):
    url = payload.url
    if url is not None and url.strip() and not url.strip().lower().startswith(("https://", "http://")):
        raise HTTPException(400, "The API address must start with https:// or http://")
    pc.set_connection(url=url, token=payload.token)
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
    amp_hosts = {host for hosts in pc.amp_of(db, project.id).values() for host in hosts}
    preview = pc.to_send(db, project, since=pc.recent_window(), geos=project_geos)
    return {
        "mode": project.proxy_checker_mode or "off",
        "time": project.proxy_checker_time,
        "next_run": proxy_checker_next_run(project.id),
        "connected": pc.connection_status()["connected"],
        "window_hours": pc.WINDOW_HOURS,
        # The project's GEOs to choose among, and the choice (null = all).
        "project_geos": project_geos,
        "geos": pc.clean_geos(project.proxy_checker_geos) if project.proxy_checker_geos is not None else None,
        # What a send would carry: the project's domains its checks found in
        # the last 24 hours, each followed by its AMP domain of the day, by
        # country, for EVERY project GEO — the page narrows it to the chosen
        # ones as they are toggled, so the effect of a choice shows before saving.
        "preview": preview,
        # Which of those are AMP domains — sent because their main domain was
        # found in that country.
        "preview_amp": {geo: [d for d in domains if d in amp_hosts] for geo, domains in preview.items()},
        "deliveries": _recent(db, project.id),
    }


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
    sent = await run_in_threadpool(pc.send_recent, project.id, "manual")
    return {"sent": [_delivery(d) for d in sent], **_project_state(db, project)}


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
    checks = [
        {"geo": c.geo, "domain": c.domain, "main_domain": c.main_domain, "statuses": c.statuses, "checked_at": c.checked_at}
        for c in newest.values()
    ]

    upto = until or now
    back = (since or upto) - timedelta(days=blocks.STANDING_DAYS)
    standing = blocks.in_serps(
        project_positions(project.id, back.isoformat(), upto.isoformat(), db), pc.project_geos(db, project))
    return standing, checks, until is None or until > now


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
    checked_main = {(c["geo"], c["domain"]) for c in checks if not c["main_domain"]}
    return {
        # How many of the project's domains some proxy reported on inside the
        # period, and how many AMP domains.
        "checked": len(checked_main),
        "amp_checked": sum(1 for c in checks if c["main_domain"]),
        # In the SERPs around then, and not reported on inside the period.
        "unchecked": sum(1 for key in by_key if key not in checked_main),
        "has_amp": any(c["main_domain"] for c in checks) or bool(pc.amp_of(db, project.id)),
        "rows": main,
        "amp_rows": amp,
    }
