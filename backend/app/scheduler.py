"""APScheduler glue. Cron schedules persist to a SQLAlchemy job store so they
survive process restarts."""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from datetime import datetime, timezone

from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.orm import Session

from .config import settings
from .crontab import to_apscheduler
from .db import SessionLocal
from .models import AmpEndpoint, Job, JobRun, Project
from .proxy_checker import DIRECT_HOURS, daily_send, direct_check_tick, valid_time
from .amp_rotator import daily_refresh as amp_daily_refresh
from .amp_rotator import endpoint_time as amp_endpoint_time
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
    the API layer to surface a clear error to the user before persisting.
    Weekday numbers are read as crontab means them (see crontab.py)."""
    CronTrigger.from_crontab(to_apscheduler(expr))


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
        trigger = CronTrigger.from_crontab(to_apscheduler(job.cron))
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


# --- Connected tools: the Proxy Checker's once-a-day send, per project -------

def _tool_ap_id(project_id: int) -> str:
    return f"proxy-checker-{project_id}"


def upsert_proxy_checker_schedule(project: Project) -> None:
    """A project on "daily" gets one tick a day at its time (UTC, like every
    cron here); any other mode has none."""
    sched = get_scheduler()
    ap_id = _tool_ap_id(project.id)
    if project.proxy_checker_mode != "daily" or not valid_time(project.proxy_checker_time):
        try:
            sched.remove_job(ap_id)
        except Exception:
            pass
        return
    hour, minute = (int(x) for x in project.proxy_checker_time.split(":"))
    sched.add_job(
        daily_send,
        trigger=CronTrigger(hour=hour, minute=minute, timezone="UTC"),
        id=ap_id,
        name=f"proxy-checker-{project.id}-{project.name}",
        args=[project.id],
        replace_existing=True,
        # A send missed while the host slept still goes out when it wakes, once.
        misfire_grace_time=None,
        coalesce=True,
        max_instances=1,
    )


def proxy_checker_next_run(project_id: int) -> str | None:
    ap = get_scheduler().get_job(_tool_ap_id(project_id))
    return ap.next_run_time.isoformat() if ap and ap.next_run_time else None


def _direct_ap_id(project_id: int) -> str:
    return f"direct-check-{project_id}"


def direct_check_trigger(hours: int, since: datetime) -> IntervalTrigger:
    """Every `hours`, at `since` (naive UTC) plus whole intervals."""
    return IntervalTrigger(hours=hours, start_date=since.replace(tzinfo=timezone.utc), timezone="UTC")


def upsert_direct_check_schedule(project: Project) -> None:
    """A project checking its domains without a SERP gets a tick every
    `direct_check_hours`, counted from when that was set — the same moments
    after every restart, which re-adds the tick. Otherwise it has none."""
    sched = get_scheduler()
    ap_id = _direct_ap_id(project.id)
    if not project.direct_check_enabled or project.direct_check_hours not in DIRECT_HOURS:
        try:
            sched.remove_job(ap_id)
        except Exception:
            pass
        return
    since = project.direct_check_since or datetime.now(timezone.utc).replace(tzinfo=None)
    sched.add_job(
        direct_check_tick,
        trigger=direct_check_trigger(project.direct_check_hours, since),
        id=ap_id,
        name=f"direct-check-{project.id}-{project.name}",
        args=[project.id],
        replace_existing=True,
        # A check missed while the host slept still goes out when it wakes, once.
        misfire_grace_time=None,
        coalesce=True,
        max_instances=1,
    )


def direct_check_next_run(project_id: int) -> str | None:
    ap = get_scheduler().get_job(_direct_ap_id(project_id))
    return ap.next_run_time.isoformat() if ap and ap.next_run_time else None


def remove_project_schedules(project_id: int) -> None:
    """A deleted project's ticks: its daily send and its checks without a SERP."""
    for ap_id in (_tool_ap_id(project_id), _direct_ap_id(project_id)):
        try:
            get_scheduler().remove_job(ap_id)
        except Exception:
            pass


def prune_project_schedules(db: Session) -> int:
    """Take off the scheduler every project tick whose project is gone (the
    job store is the database, so one left behind outlives a restart). Call
    AFTER the scheduler has started, like prune_amp_rotator_schedules."""
    ids = [p for (p,) in db.query(Project.id).all()]
    keep = {_tool_ap_id(p) for p in ids} | {_direct_ap_id(p) for p in ids}
    gone = [j.id for j in get_scheduler().get_jobs()
            if j.id.startswith(("proxy-checker-", "direct-check-")) and j.id not in keep]
    for ap_id in gone:
        try:
            get_scheduler().remove_job(ap_id)
        except Exception:
            pass
    return len(gone)


def _amp_ap_id(endpoint_id: int) -> str:
    return f"amp-rotator-{endpoint_id}"


def upsert_amp_rotator_schedule(endpoint_id: int, time_utc: str) -> None:
    """One tick a day per AMP Rotator endpoint, at that endpoint's own time
    (UTC, like every cron here). See amp_rotator.py."""
    hour, minute = (int(x) for x in time_utc.split(":"))
    get_scheduler().add_job(
        amp_daily_refresh,
        trigger=CronTrigger(hour=hour, minute=minute, timezone="UTC"),
        id=_amp_ap_id(endpoint_id),
        name=_amp_ap_id(endpoint_id),
        args=[endpoint_id],
        replace_existing=True,
        # A fetch missed while the host slept still happens when it wakes, once.
        misfire_grace_time=None,
        coalesce=True,
        max_instances=1,
    )


def remove_amp_rotator_schedule(endpoint_id: int) -> None:
    try:
        get_scheduler().remove_job(_amp_ap_id(endpoint_id))
    except Exception:
        pass


def amp_rotator_next_run(endpoint_id: int) -> str | None:
    ap = get_scheduler().get_job(_amp_ap_id(endpoint_id))
    return ap.next_run_time.isoformat() if ap and ap.next_run_time else None


def reload_tool_schedules(db: Session) -> None:
    for project in db.query(Project).all():
        upsert_proxy_checker_schedule(project)
        upsert_direct_check_schedule(project)
    for endpoint in db.query(AmpEndpoint).all():
        upsert_amp_rotator_schedule(endpoint.id, amp_endpoint_time(endpoint))


def prune_amp_rotator_schedules(db: Session) -> int:
    """Take off the scheduler every AMP Rotator tick whose endpoint is gone.

    The job store is the database, so a tick outlives a restart; one left
    behind would fire every day for nothing. Call AFTER the scheduler has
    started: before that it cannot list what the store holds.
    """
    keep = {_amp_ap_id(e.id) for e in db.query(AmpEndpoint.id).all()}
    gone = [j.id for j in get_scheduler().get_jobs() if j.id.startswith("amp-rotator-") and j.id not in keep]
    for ap_id in gone:
        try:
            get_scheduler().remove_job(ap_id)
        except Exception:
            pass
    return len(gone)


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
