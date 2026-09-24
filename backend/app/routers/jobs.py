from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import String, func, or_
from sqlalchemy.orm import Session

from ..db import IS_SQLITE, get_db
from ..models import Job, JobRun, Project
from ..scheduler import remove_schedule, schedule_info, scheduler_timezone, upsert_schedule, validate_cron
from ..schemas import CostEstimate, JobCreate, JobOut, JobPage, JobRunOut, JobUpdate
from ..search import CONTAINS_CI
from ..tasks import create_run, estimate_queries, run_job_async

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _to_orm_data(payload: dict) -> dict:
    """Pydantic LocationRef[] -> plain dict[] for JSON column."""
    if "locations" in payload and payload["locations"] is not None:
        payload["locations"] = [
            l.model_dump() if hasattr(l, "model_dump") else dict(l) for l in payload["locations"]
        ]
    return payload


def _validate_cron_or_400(cron: str | None) -> None:
    if cron is None or not cron.strip():
        return
    try:
        validate_cron(cron.strip())
    except ValueError as e:
        raise HTTPException(
            400,
            f"Invalid cron expression: {e}. "
            "Format is `minute hour day month dow` (e.g. `30 9 3 5 *` = May 3 at 09:30).",
        )


def _check_project(db: Session, project_id: int | None) -> None:
    """A job may only be filed in a project that exists.

    Without this a typo in the id files the job into a folder the jobs list
    will never draw, and the job disappears from the UI while still running on
    its schedule.
    """
    if project_id is not None and not db.get(Project, project_id):
        raise HTTPException(400, f"project {project_id} does not exist")


@router.get("", response_model=JobPage)
def list_jobs(
    q: str | None = Query(None, description="Substring of the name or a keyword"),
    project_id: int | None = Query(None, description="Only this project's folder"),
    ungrouped: bool = Query(False, description="Only jobs in no project"),
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """One page of jobs, newest edit first.

    Searching covers the name AND the keywords, because a job is as often
    remembered by what it watches ("melbet") as by what it was called. A search
    for "kz" therefore also matches a keyword containing it, which for finding
    a job is a feature.

    The match runs through app.search.contains_ci rather than LOWER()/LIKE.
    Keywords live in a JSON column that SQLAlchemy stores ASCII-escaped, so
    "буствин" is on disk as бу..., and SQLite's own lower() does not
    fold Cyrillic anyway — between them, no LIKE written in Russian could ever
    match. See that module for the details.
    """
    query = db.query(Job)
    if project_id is not None:
        query = query.filter(Job.project_id == project_id)
    elif ungrouped:
        query = query.filter(Job.project_id.is_(None))
    term = (q or "").strip()
    if term:
        if IS_SQLITE:
            match = getattr(func, CONTAINS_CI)
            query = query.filter(or_(
                match(Job.name, term) == 1,
                match(func.cast(Job.keywords, String), term) == 1,
            ))
        else:
            # Other backends fold Unicode correctly in LOWER() and are not
            # required by this app; keep the plain form for them rather than
            # shipping a function only SQLite can run.
            like = f"%{term.lower()}%"
            query = query.filter(or_(
                func.lower(Job.name).like(like),
                func.lower(func.cast(Job.keywords, String)).like(like),
            ))
    total = query.with_entities(func.count(Job.id)).scalar() or 0
    items = (
        query.order_by(Job.updated_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return JobPage(items=items, total=total, limit=limit, offset=offset)


@router.post("", response_model=JobOut)
def create_job(payload: JobCreate, db: Session = Depends(get_db)):
    _validate_cron_or_400(payload.cron)
    _check_project(db, payload.project_id)
    data = _to_orm_data(payload.model_dump())
    job = Job(**data)
    db.add(job)
    db.commit()
    db.refresh(job)
    upsert_schedule(job)
    return job


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404)
    return job


@router.patch("/{job_id}", response_model=JobOut)
def update_job(job_id: int, payload: JobUpdate, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404)
    if "cron" in payload.model_fields_set:
        _validate_cron_or_400(payload.cron)
    if "project_id" in payload.model_fields_set:
        _check_project(db, payload.project_id)
    data = _to_orm_data(payload.model_dump(exclude_unset=True))
    for k, v in data.items():
        setattr(job, k, v)
    db.commit()
    db.refresh(job)
    upsert_schedule(job)
    return job


@router.delete("/{job_id}")
def delete_job(job_id: int, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404)
    remove_schedule(job_id)
    db.delete(job)
    db.commit()
    return {"ok": True}


@router.get("/{job_id}/estimate", response_model=CostEstimate)
def cost_estimate(job_id: int, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404)
    return estimate_queries(job)


@router.post("/{job_id}/run", response_model=JobRunOut)
async def run_now(job_id: int, bg: BackgroundTasks, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404)
    run = create_run(db, job_id, triggered_by="manual")
    bg.add_task(run_job_async, run.id)
    return run


@router.get("/{job_id}/runs", response_model=list[JobRunOut])
def list_runs(job_id: int, db: Session = Depends(get_db)):
    return (
        db.query(JobRun)
        .filter(JobRun.job_id == job_id)
        .order_by(JobRun.started_at.desc())
        .all()
    )


@router.get("/{job_id}/schedule-info")
def get_schedule_info(job_id: int, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404)
    return schedule_info(job_id)
