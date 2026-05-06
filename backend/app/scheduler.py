"""APScheduler glue. Cron schedules persist to a SQLAlchemy job store so they
survive process restarts."""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import Session

from .config import settings
from .db import SessionLocal
from .models import Job, JobRun
from .tasks import create_run, run_job_sync

log = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


def get_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(
            jobstores={
                "default": SQLAlchemyJobStore(url=settings.database_url),
            },
            timezone="UTC",
        )
    return _scheduler


def _scheduled_callable(job_id: int) -> None:
    """Top-level (picklable) callable APScheduler invokes on tick."""
    db = SessionLocal()
    try:
        run = create_run(db, job_id, triggered_by="schedule")
        run_id = run.id
    finally:
        db.close()
    run_job_sync(run_id)


def _ap_id(job_id: int) -> str:
    return f"job-{job_id}"


def validate_cron(expr: str) -> None:
    """Raise ValueError if the cron expression is invalid. Cheap to call from
    the API layer to surface a clear error to the user before persisting."""
    CronTrigger.from_crontab(expr)


def upsert_schedule(job: Job) -> None:
    sched = get_scheduler()
    ap_id = _ap_id(job.id)
    if not (job.cron and job.schedule_enabled):
        try:
            sched.remove_job(ap_id)
        except Exception:
            pass
        return
    try:
        trigger = CronTrigger.from_crontab(job.cron)
    except ValueError as e:
        # Drop any stale AP entry so we don't keep firing the previous cron.
        log.warning("bad cron for job %s (%r): %s", job.id, job.cron, e)
        try:
            sched.remove_job(ap_id)
        except Exception:
            pass
        return
    sched.add_job(
        _scheduled_callable,
        trigger=trigger,
        id=ap_id,
        name=f"job-{job.id}-{job.name}",
        args=[job.id],
        replace_existing=True,
        # None = no time limit on missed runs. When the host wakes up after
        # being asleep, missed schedules execute immediately. coalesce
        # collapses multiple misses (e.g. an overnight sleep) into one run.
        misfire_grace_time=None,
        coalesce=True,
        max_instances=1,
    )


def remove_schedule(job_id: int) -> None:
    try:
        get_scheduler().remove_job(_ap_id(job_id))
    except Exception:
        pass


def reload_all_schedules(db: Session) -> None:
    for job in db.query(Job).filter(Job.schedule_enabled.is_(True)).all():
        upsert_schedule(job)


def schedule_info(job_id: int) -> dict:
    """Inspect APScheduler's view of a job: is it registered, and when next?"""
    sched = get_scheduler()
    tz = str(sched.timezone)
    ap = sched.get_job(_ap_id(job_id))
    if ap is None:
        return {"registered": False, "next_run_time": None, "timezone": tz}
    return {
        "registered": True,
        "next_run_time": ap.next_run_time.isoformat() if ap.next_run_time else None,
        "timezone": tz,
    }


def scheduler_timezone() -> str:
    return str(get_scheduler().timezone)
