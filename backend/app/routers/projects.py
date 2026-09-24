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

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Job, Project
from ..providers.domain_paste import clean_domain_list
from ..schemas import ProjectCreate, ProjectOut, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["projects"])


def _job_counts(db: Session, project_ids: list[int]) -> dict[int, int]:
    """Jobs per project, in one query rather than one per row."""
    if not project_ids:
        return {}
    rows = (
        db.query(Job.project_id, func.count(Job.id))
        .filter(Job.project_id.in_(project_ids))
        .group_by(Job.project_id)
        .all()
    )
    return {pid: n for pid, n in rows if pid is not None}


def _out(project: Project, job_count: int) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        name=project.name,
        domains=project.domains or [],
        notes=project.notes,
        created_at=project.created_at,
        updated_at=project.updated_at,
        job_count=job_count,
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
    counts = _job_counts(db, [p.id for p in projects])
    return [_out(p, counts.get(p.id, 0)) for p in projects]


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
    return _out(project, 0)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404)
    return _out(project, _job_counts(db, [project_id]).get(project_id, 0))


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
    return _out(project, _job_counts(db, [project_id]).get(project_id, 0))


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
    db.delete(project)
    db.commit()
    return {"ok": True, "jobs_ungrouped": freed}
