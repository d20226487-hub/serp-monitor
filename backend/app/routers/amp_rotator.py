"""AMP Rotator: the connection and its endpoints (Settings → Tools Connection)
and what the rotators said (each project's page). See ../amp_rotator.py for
the API and the rules."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import amp_rotator as amp
from ..db import get_db
from ..models import AmpDomain, AmpEndpoint, Project
from ..scheduler import amp_rotator_next_run, remove_amp_rotator_schedule, upsert_amp_rotator_schedule

router = APIRouter(tags=["tools"])


class CredentialsIn(BaseModel):
    #: Omitted = unchanged. An empty password also means "keep the saved one":
    #: the form never has it to send back.
    username: str | None = None
    password: str | None = None


class EndpointIn(BaseModel):
    project_id: int
    url: str
    #: When this rotator is asked each day, HH:MM in UTC. Omitted = the default.
    time: str | None = None


class EndpointPatch(BaseModel):
    #: Omitted = unchanged.
    project_id: int | None = None
    url: str | None = None
    time: str | None = None


def _url(value: str) -> str:
    value = (value or "").strip()
    if not value.lower().startswith(("https://", "http://")):
        raise HTTPException(400, "The endpoint must start with https:// or http://")
    return value


def _time(value: str | None) -> str:
    if value is None:
        return amp.DEFAULT_TIME
    if not amp.valid_time(value):
        raise HTTPException(400, "The time must be HH:MM")
    return value


def _endpoint(e: AmpEndpoint, names: dict[int, str], counts: dict[int, int]) -> dict:
    return {
        "id": e.id, "project_id": e.project_id, "project_name": names.get(e.project_id),
        "url": e.url,
        # The daily request: its time (HH:MM, UTC) and when it happens next.
        "time": amp.endpoint_time(e), "next_run": amp_rotator_next_run(e.id),
        "fetched_at": e.fetched_at, "ok": e.ok, "status_code": e.status_code, "error": e.error,
        # How many domains were asked about, and how many the rotator named an AMP host for.
        "sent": e.sent, "amp_count": counts.get(e.id, 0),
        # The last AMP config uploaded for it, summarised.
        "config": e.config,
    }


def _endpoints(db: Session, project_id: int | None = None) -> list[dict]:
    q = db.query(AmpEndpoint)
    if project_id is not None:
        q = q.filter(AmpEndpoint.project_id == project_id)
    rows = q.order_by(AmpEndpoint.project_id, AmpEndpoint.id).all()
    names = dict(db.query(Project.id, Project.name).all())
    counts = dict(db.query(AmpDomain.endpoint_id, func.count(AmpDomain.id)).group_by(AmpDomain.endpoint_id).all())
    return [_endpoint(e, names, counts) for e in rows]


def _state(db: Session) -> dict:
    """What the browser may see: the login, whether a password is saved —
    never the password."""
    return {**amp.credentials_status(), "default_time": amp.DEFAULT_TIME, "endpoints": _endpoints(db)}


def _get_endpoint(db: Session, endpoint_id: int) -> AmpEndpoint:
    endpoint = db.get(AmpEndpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(404)
    return endpoint


def _no_twin(db: Session, project_id: int, url: str, but: int | None = None) -> None:
    twin = db.query(AmpEndpoint).filter(AmpEndpoint.project_id == project_id, AmpEndpoint.url == url)
    if but is not None:
        twin = twin.filter(AmpEndpoint.id != but)
    if twin.first() is not None:
        raise HTTPException(409, "This project already has this endpoint.")


# --- Settings → Tools Connection --------------------------------------------

@router.get("/settings/tools/amp-rotator")
def get_amp_rotator(db: Session = Depends(get_db)):
    return _state(db)


@router.put("/settings/tools/amp-rotator/credentials")
def set_credentials(payload: CredentialsIn, db: Session = Depends(get_db)):
    """The one login and password every rotator takes."""
    if payload.username is not None and not payload.username.strip():
        raise HTTPException(400, "The login cannot be empty.")
    amp.set_credentials(username=payload.username, password=payload.password or None)
    return _state(db)


@router.delete("/settings/tools/amp-rotator/credentials")
def clear_credentials(db: Session = Depends(get_db)):
    """Forget the login and password. The endpoints stay; nothing is asked
    until a pair is saved again."""
    amp.set_credentials(username="", password="")
    return _state(db)


@router.post("/settings/tools/amp-rotator/endpoints")
def add_endpoint(payload: EndpointIn, db: Session = Depends(get_db)):
    if db.get(Project, payload.project_id) is None:
        raise HTTPException(404, "No such project")
    url, time = _url(payload.url), _time(payload.time)
    _no_twin(db, payload.project_id, url)
    endpoint = AmpEndpoint(project_id=payload.project_id, url=url, fetch_time=time)
    db.add(endpoint)
    db.commit()
    upsert_amp_rotator_schedule(endpoint.id, time)
    return _state(db)


@router.put("/settings/tools/amp-rotator/endpoints/{endpoint_id}")
def edit_endpoint(endpoint_id: int, payload: EndpointPatch, db: Session = Depends(get_db)):
    endpoint = _get_endpoint(db, endpoint_id)
    project_id = payload.project_id if payload.project_id is not None else endpoint.project_id
    if db.get(Project, project_id) is None:
        raise HTTPException(404, "No such project")
    url = _url(payload.url) if payload.url is not None else endpoint.url
    _no_twin(db, project_id, url, but=endpoint.id)
    moved = project_id != endpoint.project_id or url != endpoint.url
    endpoint.project_id, endpoint.url = project_id, url
    if payload.time is not None:
        endpoint.fetch_time = _time(payload.time)
    if moved:
        # Another rotator, or another project's domains: what the old one said
        # is no longer this endpoint's answer.
        db.query(AmpDomain).filter(AmpDomain.endpoint_id == endpoint.id).delete(synchronize_session=False)
        endpoint.fetched_at = endpoint.ok = endpoint.status_code = endpoint.error = endpoint.sent = None
        endpoint.config = None
    db.commit()
    upsert_amp_rotator_schedule(endpoint.id, amp.endpoint_time(endpoint))
    return _state(db)


@router.delete("/settings/tools/amp-rotator/endpoints/{endpoint_id}")
def delete_endpoint(endpoint_id: int, db: Session = Depends(get_db)):
    amp.remove_endpoint(db, _get_endpoint(db, endpoint_id))
    db.commit()
    remove_amp_rotator_schedule(endpoint_id)
    return _state(db)


@router.post("/settings/tools/amp-rotator/endpoints/{endpoint_id}/config")
def upload_endpoint_config(endpoint_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """A rotator's AMP config: the past AMP domains SERP Monitor missed (user,
    2026-10-16). See amp_rotator.import_config for the rule."""
    endpoint = _get_endpoint(db, endpoint_id)
    raw = file.file.read(5 * 1024 * 1024 + 1)
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(413, "The file is larger than 5 MB.")
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise HTTPException(400, f"The file is not valid JSON: {e}")
    try:
        imported = amp.import_config(db, endpoint, data, file.filename)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {**_state(db), "imported": imported}


@router.post("/settings/tools/amp-rotator/endpoints/{endpoint_id}/fetch")
def fetch_endpoint(endpoint_id: int, db: Session = Depends(get_db)):
    """"Fetch now" — also the only test there is: the API has the one request."""
    _get_endpoint(db, endpoint_id)
    amp.refresh_endpoint(endpoint_id)
    db.expire_all()
    return _state(db)


# --- a project's page --------------------------------------------------------

def _project_amp(db: Session, project_id: int) -> dict:
    if db.get(Project, project_id) is None:
        raise HTTPException(404)
    endpoints = _endpoints(db, project_id)
    hosts = {e["id"]: amp.clean_host(e["url"]) or e["url"] for e in endpoints}
    rows = (db.query(AmpDomain).filter(AmpDomain.project_id == project_id)
            .order_by(AmpDomain.domain, AmpDomain.endpoint_id).all())
    return {
        "endpoints": endpoints,
        "rows": [
            {"domain": r.domain, "amp_domain": r.amp_domain, "since": r.since, "fetched_at": r.fetched_at,
             "endpoint_id": r.endpoint_id, "rotator": hosts.get(r.endpoint_id)}
            for r in rows
        ],
    }


@router.get("/projects/{project_id}/amp-domains")
def project_amp_domains(project_id: int, db: Session = Depends(get_db)):
    """Today's AMP domain of each of the project's domains, as last fetched."""
    return _project_amp(db, project_id)


@router.post("/projects/{project_id}/amp-domains/refresh")
def refresh_project_amp_domains(project_id: int, db: Session = Depends(get_db)):
    if db.get(Project, project_id) is None:
        raise HTTPException(404)
    amp.refresh_project(project_id)
    db.expire_all()
    return _project_amp(db, project_id)
