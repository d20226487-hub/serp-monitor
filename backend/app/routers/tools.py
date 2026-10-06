"""Connected tools (Settings → Tools Connection, and each project's page).

Today: the Proxy Checker — see ../proxy_checker.py for what is sent and why.
The connection is global; WHEN a project's domains are sent is the project's
own setting, as the user asked. AMP Rotator comes later.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import proxy_checker as pc
from ..db import get_db
from ..models import Project, ToolDelivery
from ..scheduler import proxy_checker_next_run, upsert_proxy_checker_schedule

router = APIRouter(tags=["tools"])


def _delivery(d: ToolDelivery, names: dict[int, str] | None = None) -> dict:
    return {
        "id": d.id, "project_id": d.project_id,
        "project_name": (names or {}).get(d.project_id) if d.project_id else None,
        "run_id": d.run_id, "trigger": d.trigger, "geo": d.geo, "domains": d.domains or [],
        "ok": d.ok, "status_code": d.status_code, "response": d.response, "sent_at": d.sent_at,
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
    return {
        "mode": project.proxy_checker_mode or "off",
        "time": project.proxy_checker_time,
        "next_run": proxy_checker_next_run(project.id),
        "connected": pc.connection_status()["connected"],
        "window_hours": pc.WINDOW_HOURS,
        # The project's GEOs to choose among, and the choice (null = all).
        "project_geos": project_geos,
        "geos": pc.clean_geos(project.proxy_checker_geos) if project.proxy_checker_geos is not None else None,
        # The project's domains its checks found in the last 24 hours, by
        # country, for EVERY project GEO: the page narrows it to the chosen
        # ones as they are toggled, so the effect of a choice shows before saving.
        "preview": pc.keep_geos(pc.found_by_geo(db, project, since=pc.recent_window()), project_geos),
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
