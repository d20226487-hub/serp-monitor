"""Upload a SERP export (CSV) to a project: it becomes a run of the project,
like any other. See ../serp_csv.py for the file and the rules."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import serp_csv
from ..db import get_db
from ..models import Job, JobRun, Project, Result
from ..proxy_checker import after_run as proxy_checker_after_run

router = APIRouter(tags=["projects"])

PROVIDER = "csv"
MAX_BYTES = 20 * 1024 * 1024


def _countries() -> tuple[dict[str, str], dict[str, str]]:
    """(name or code → ISO code, ISO code → the name to show). Google's list
    of countries when it is mirrored, and the time-zone database's — two
    spellings of the same countries are better than one."""
    pairs: list[tuple[str, str]] = []
    try:
        import pytz
        pairs += [(name, code) for code, name in pytz.country_names.items()]
    except Exception:  # noqa: BLE001 - names from one list are still names
        pass
    try:
        from ..provider_locations import MirrorSession, ProviderLocation
        with MirrorSession() as m:
            pairs += [(n, c) for n, c in m.query(ProviderLocation.name, ProviderLocation.country_code).filter(
                ProviderLocation.provider == "google", ProviderLocation.location_type == "Country").all()]
    except Exception:  # noqa: BLE001 - no mirror yet: the other list stands in
        pass
    names = {code.upper(): name for name, code in pairs if name and code}
    return serp_csv.countries_index(pairs), names


def _checked_at(checked_on: str | None, tz: int) -> datetime:
    """When the SERPs were read, as naive UTC. Today means now; an earlier day
    means noon of that day on the uploader's clock — an export says which day
    it is of, not which minute."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    local_today = (now + timedelta(minutes=tz)).date()
    if not checked_on:
        return now
    try:
        day = date.fromisoformat(checked_on)
    except ValueError:
        raise HTTPException(400, "The date must be YYYY-MM-DD")
    if day > local_today:
        raise HTTPException(400, "The date of the check cannot be in the future.")
    if day == local_today:
        return now
    return datetime(day.year, day.month, day.day, 12, 0) - timedelta(minutes=tz)


def _job(db: Session, project: Project) -> Job:
    """The project's one job that uploads are filed under."""
    job = db.query(Job).filter(Job.project_id == project.id, Job.provider == PROVIDER).order_by(Job.id).first()
    if job is None:
        job = Job(name=f"CSV — {project.name}", project_id=project.id, provider=PROVIDER, mode="serp",
                  keywords=[], engines=[], devices=[], locations=[], languages=[], google_domains=[],
                  scrape_fields=["url"], top_n=10, schedule_enabled=False)
        db.add(job)
        db.flush()
    return job


def _union(have: list, more: list) -> list:
    return list(have or []) + [x for x in more if x not in (have or [])]


@router.post("/projects/{project_id}/serp-csv")
def upload_serp_csv(
    project_id: int,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    engine: Literal["google", "yandex"] = Form("google"),
    device: Literal["mobile", "desktop"] = Form("mobile"),
    checked_on: str | None = Form(None, description="The day the SERPs were read, YYYY-MM-DD on the uploader's clock"),
    tz: int = Form(0, ge=-840, le=840, description="The uploader's offset from UTC, minutes east"),
    db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404)
    # A plain `def`, so this runs off the event loop: reading, parsing and a
    # few thousand inserts must not stall every other request meanwhile.
    raw = file.file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "The file is larger than 20 MB.")
    countries, names = _countries()
    try:
        parsed = serp_csv.parse(serp_csv.decode(raw), countries)
    except serp_csv.MissingColumns as e:
        found = ", ".join(e.found) or "none"
        raise HTTPException(400, f"The file has no column for: {', '.join(e.missing)}. Columns found: {found}.")
    report = {
        "empty": parsed.empty,
        "unknown_geos": parsed.unknown_geos,
        "bad": [{"line": line, "why": why} for line, why in parsed.bad[:20]],
        "bad_total": len(parsed.bad),
    }
    if not parsed.rows:
        raise HTTPException(400, {"message": "No rows could be read from the file.", **report})

    when = _checked_at(checked_on, tz)
    job = _job(db, project)
    geos = sorted({r.geo for r in parsed.rows})
    queries = {(r.keyword, r.geo) for r in parsed.rows}
    # The upload's countries become GEOs of the project, as its keywords become
    # the project's keywords. Which GEOs are SENT to the Proxy Checker is a
    # separate choice and is not touched: with "all" chosen a new GEO is sent
    # too, with a narrower choice it is added switched off.
    saved_geos, geos_added = serp_csv.with_geos(project.geos, geos)
    if geos_added:
        project.geos = saved_geos
    # The job describes everything it has ever been given, so the project's
    # keywords, locations and engines include the uploaded ones.
    job.keywords = _union(job.keywords, sorted({r.keyword for r in parsed.rows}))
    job.engines = _union(job.engines, [engine])
    job.devices = _union(job.devices, [device])
    have = {(loc or {}).get("country_code") for loc in job.locations or []}
    job.locations = list(job.locations or []) + [
        {"canonical_name": names.get(g, g), "name": names.get(g, g), "country_code": g.lower(), "target_type": "Country"}
        for g in geos if g.lower() not in have
    ]
    job.top_n = max(job.top_n or 10, max(r.position for r in parsed.rows))

    run = JobRun(job_id=job.id, status="done", triggered_by="manual", phase="scrape", provider=PROVIDER,
                 started_at=when, finished_at=when,
                 # The day above is the day the SERPs were read; this is now.
                 uploaded_at=datetime.now(timezone.utc).replace(tzinfo=None),
                 queries_total=len(queries), queries_done=len(queries), queries_failed=0)
    db.add(run)
    db.flush()
    for r in parsed.rows:
        db.add(Result(
            run_id=run.id, keyword=r.keyword, engine=engine, device=device,
            # Country-level: the export names a country and nothing finer.
            location=names.get(r.geo, r.geo), country_code=r.geo.lower(), language=None, google_domain=None,
            position=r.position, url=r.url, title=None, description=None, domain=r.domain, shown_host=None,
            provider=PROVIDER))
    db.commit()
    # An upload is a run (the user: "the CSV upload will equal прогон"): the
    # Proxy Checker hears about it as it does about any other, after the
    # answer to this request — its check can take minutes.
    background.add_task(proxy_checker_after_run, run.id)
    return {
        "run_id": run.id, "job_id": job.id, "checked_at": when,
        "rows": len(parsed.rows), "queries": len(queries),
        "keywords": len({r.keyword for r in parsed.rows}),
        "geos": {g: sum(1 for r in parsed.rows if r.geo == g) for g in geos},
        "engine": engine, "device": device,
        # Whether this project sends to the Proxy Checker after a run.
        "proxy_checker_after": project.proxy_checker_mode == "after_run",
        # Countries of this file that were not GEOs of the project and are now.
        "geos_added": geos_added,
        **report,
    }
