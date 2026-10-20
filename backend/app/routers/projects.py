"""Projects — a client or site, and the domains being watched for it.

The domains are stored for position tracking to use later. Nothing reads them
yet, which is the point of keeping the shape minimal: a plain list of hosts has
no schema to migrate once tracking exists.

A project is also the folder the jobs list groups by. There is no folder entity
and nothing to create: a job carries `project_id`, and the jobs list groups on
it. So "the folder already exists" is never a case that needs handling — the
grouping appears the moment a job points at the project and disappears when the
last one stops.
"""
from __future__ import annotations

from typing import NamedTuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..amp_rotator import remove_project as remove_amp_endpoints
from ..db import get_db
from ..models import Job, Project
from ..providers.domain_paste import clean_domain_list
from ..scheduler import remove_amp_rotator_schedule
from ..schemas import ProjectCreate, ProjectOut, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["projects"])


class _Summary(NamedTuple):
    """What a project's jobs add up to: how many, how many distinct keywords,
    and where and on what they are measured.

    Derived rather than stored, because the jobs are the only thing that
    decides any of it — a copy kept on the project would drift the moment a
    job changed. Keywords are COUNTED here rather than returned: a project can
    hold thousands, and the list page needs the number, not the words.
    """
    jobs: int = 0
    keywords: int = 0
    geos: list[str] = []
    engines: list[str] = []


def _summaries(db: Session, project_ids: list[int]) -> dict[int, _Summary]:
    """One query for every listed project, not one per row."""
    if not project_ids:
        return {}
    rows = (
        db.query(Job.project_id, Job.keywords, Job.locations, Job.engines)
        .filter(Job.project_id.in_(project_ids))
        .all()
    )
    acc: dict[int, dict] = {}
    for pid, keywords, locations, engines in rows:
        if pid is None:
            continue
        bucket = acc.setdefault(
            pid, {"jobs": 0, "keywords": set(), "geos": {}, "engines": set()},
        )
        bucket["jobs"] += 1
        for k in keywords or []:
            # Case-insensitively: the same term entered in two jobs is one
            # thing being tracked, not two.
            term = str(k).strip().lower()
            if term:
                bucket["keywords"].add(term)
        for loc in locations or []:
            if not isinstance(loc, dict):
                continue
            name = (loc.get("name") or loc.get("canonical_name") or "").split(",")[0].strip()
            if name:
                bucket["geos"].setdefault(name.lower(), name)
        for e in engines or []:
            if e:
                bucket["engines"].add(str(e))
    return {
        pid: _Summary(
            jobs=b["jobs"],
            keywords=len(b["keywords"]),
            geos=sorted(b["geos"].values(), key=str.lower),
            engines=sorted(b["engines"]),
        )
        for pid, b in acc.items()
    }


def _out(project: Project, summary: _Summary) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        name=project.name,
        domains=project.domains or [],
        notes=project.notes,
        created_at=project.created_at,
        updated_at=project.updated_at,
        job_count=summary.jobs,
        keyword_count=summary.keywords,
        geos=summary.geos,
        engines=summary.engines,
    )


def _name_taken(db: Session, name: str, *, exclude_id: int | None = None) -> bool:
    """Case-insensitively, since two projects called "Acme" and "acme" would be
    two folders nobody could tell apart in the jobs list."""
    q = db.query(Project).filter(func.lower(Project.name) == name.strip().lower())
    if exclude_id is not None:
        q = q.filter(Project.id != exclude_id)
    return db.query(q.exists()).scalar()


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    projects = db.query(Project).order_by(func.lower(Project.name)).all()
    summaries = _summaries(db, [p.id for p in projects])
    return [_out(p, summaries.get(p.id, _Summary())) for p in projects]


@router.post("", response_model=ProjectOut)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if _name_taken(db, name):
        raise HTTPException(409, f"A project named {name!r} already exists")
    project = Project(
        name=name,
        domains=clean_domain_list(payload.domains),
        notes=(payload.notes or None),
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return _out(project, _Summary())


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404)
    return _out(project, _summaries(db, [project_id]).get(project_id, _Summary()))


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int, payload: ProjectUpdate, db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404)
    fields = payload.model_fields_set
    if "name" in fields and payload.name is not None:
        name = payload.name.strip()
        if _name_taken(db, name, exclude_id=project_id):
            raise HTTPException(409, f"A project named {name!r} already exists")
        project.name = name
    if "domains" in fields:
        project.domains = clean_domain_list(payload.domains)
    if "notes" in fields:
        project.notes = payload.notes or None
    db.commit()
    db.refresh(project)
    return _out(project, _summaries(db, [project_id]).get(project_id, _Summary()))


@router.delete("/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    """Delete the project. Its jobs survive, ungrouped.

    Deleting a folder must not delete what is filed in it: those jobs carry
    their keywords, their schedule and every run they have ever made. They come
    back as ungrouped and can be filed again.
    """
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404)
    # Explicit rather than relying on ON DELETE SET NULL: SQLite only enforces
    # foreign keys when the pragma is on, and a silently orphaned project_id
    # would point at nothing and hide those jobs from every folder.
    freed = (
        db.query(Job)
        .filter(Job.project_id == project_id)
        .update({Job.project_id: None}, synchronize_session=False)
    )
    # The project's AMP Rotator endpoints go with it, for the same reason they
    # are removed by hand: nothing cascades here.
    amp_endpoint_ids = remove_amp_endpoints(db, project_id)
    db.delete(project)
    db.commit()
    for endpoint_id in amp_endpoint_ids:
        remove_amp_rotator_schedule(endpoint_id)
    return {"ok": True, "jobs_ungrouped": freed}


# --- the project's keywords --------------------------------------------------
#
# A project's keywords are its jobs' keywords: nothing else decides what is
# measured. So the project page edits them there (user, 2026-10-20: "remove/add
# keywords from/to the project one by one like GEOs + clear all button" — for
# when the wrong CSV was uploaded and another project's keywords came in with
# it). Removing takes a keyword out of every job of the project, compared
# without regard to case or surrounding spaces, as the page lists them once.
# Adding puts new ones into the project's own list — the job its CSV uploads
# are filed under, made if it has none — so a keyword typed on the project
# page never changes what a scraping job checks (user: "the purpose of this
# box is just to show what keywords are tracked"). Positions already read for
# a removed keyword stay: deleting an upload removes those.

#: The most keywords one job takes — the job form's limit too.
MAX_KEYWORDS_PER_JOB = 1000


def _key(keyword: str) -> str:
    return keyword.strip().lower()


def drop_keywords(have: list[str], drop: set[str]) -> list[str]:
    """`have` without the keywords whose key is in `drop`."""
    return [k for k in have if _key(k) not in drop]


def add_keywords(have: list[str], new: list[str]) -> tuple[list[str], list[str]]:
    """(the job's keywords with the new ones after them, the ones that were
    new). Blank lines and keywords the job already has are left out."""
    seen = {_key(k) for k in have}
    added: list[str] = []
    for k in new:
        k = k.strip()
        if k and _key(k) not in seen:
            added.append(k)
            seen.add(_key(k))
    return list(have) + added, added


class KeywordsRemoveIn(BaseModel):
    keywords: list[str] = []
    #: Every keyword of every job of the project.
    all: bool = False


class KeywordsAddIn(BaseModel):
    keywords: list[str]
    #: Into this job of the project. Omitted = the project's own list (the job
    #: its CSV uploads are filed under).
    job_id: int | None = None


@router.post("/{project_id}/keywords/remove")
def remove_project_keywords(project_id: int, payload: KeywordsRemoveIn, db: Session = Depends(get_db)):
    if db.get(Project, project_id) is None:
        raise HTTPException(404)
    drop = {_key(k) for k in payload.keywords if k.strip()}
    jobs_changed = removed = 0
    for job in db.query(Job).filter(Job.project_id == project_id).all():
        before = list(job.keywords or [])
        after = [] if payload.all else drop_keywords(before, drop)
        if len(after) != len(before):
            job.keywords = after
            jobs_changed += 1
            removed += len(before) - len(after)
    db.commit()
    return {"jobs_changed": jobs_changed, "removed": removed}


@router.post("/{project_id}/keywords/add")
def add_project_keywords(project_id: int, payload: KeywordsAddIn, db: Session = Depends(get_db)):
    if payload.job_id is None:
        project = db.get(Project, project_id)
        if project is None:
            raise HTTPException(404)
        from .serp_upload import _job as own_list
        job = own_list(db, project)
    else:
        job = db.get(Job, payload.job_id)
    if job is None or job.project_id != project_id:
        raise HTTPException(404, "That job is not in this project.")
    keywords, added = add_keywords(list(job.keywords or []), payload.keywords)
    if len(keywords) > MAX_KEYWORDS_PER_JOB:
        raise HTTPException(
            400, f"A job holds at most {MAX_KEYWORDS_PER_JOB} keywords; {job.name!r} would have {len(keywords)}.")
    job.keywords = keywords
    db.commit()
    return {"added": len(added), "job_id": job.id}
