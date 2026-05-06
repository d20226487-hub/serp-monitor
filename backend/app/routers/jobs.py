from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Job, JobRun
from ..scheduler import remove_schedule, schedule_info, scheduler_timezone, upsert_schedule, validate_cron
from ..schemas import CostEstimate, JobCreate, JobOut, JobRunOut, JobUpdate
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


@router.get("", response_model=list[JobOut])
def list_jobs(db: Session = Depends(get_db)):
    return db.query(Job).order_by(Job.updated_at.desc()).all()


@router.post("", response_model=JobOut)
def create_job(payload: JobCreate, db: Session = Depends(get_db)):
    _validate_cron_or_400(payload.cron)
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
