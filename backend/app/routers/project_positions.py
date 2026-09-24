"""Where a project's domains rank, for the keywords its jobs watch.

This is the first thing that reads Project.domains — until now they were only
stored. It answers one question: over some window of time, for each keyword we
track, what position does each of our domains hold?

Three decisions worth knowing, because they are what make the numbers mean
something:

* A row is one keyword in one SERP VARIANT (engine, device, location), not one
  keyword. The same term on google/mobile/Almaty and google/desktop/Astana are
  different SERPs with genuinely different positions, and averaging them would
  invent a number that no page ever held.

* Within the window, each row shows its LATEST run. A window is "where do we
  stand", so a newer measurement always replaces an older one; taking the best
  across the window instead would quietly hide a drop. Runs are picked per row
  rather than per project, so a job that failed halfway only supersedes the
  keywords it actually reached.

* A domain matches a result host exactly, plus the "www." spelling of it. The
  provider writes result hosts as it finds them — 1979 of 4496 rows here carry
  a leading www. — while project domains are stored normalised. Subdomains do
  NOT match their parent: kz.example.com is a different target from
  example.com, which is exactly why the project stores them separately.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Job, JobRun, Project, Result

router = APIRouter(prefix="/projects", tags=["projects"])


def _parse_stamp(value: str | None, field: str) -> datetime | None:
    """ISO-8601 in, naive UTC out.

    Run timestamps are stored naive UTC, so an aware value is converted rather
    than compared — mixing the two raises, and comparing a local wall clock
    against UTC would silently shift the window by the offset.
    """
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, f"{field} is not an ISO-8601 timestamp: {value!r}")
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _host_variants(domain: str) -> list[str]:
    """The spellings a result host might use for this domain."""
    return [domain, f"www.{domain}"]


@router.get("/{project_id}/positions")
def project_positions(
    project_id: int,
    start: str | None = Query(None, description="ISO-8601, inclusive"),
    end: str | None = Query(None, description="ISO-8601, exclusive"),
    db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404)

    domains: list[str] = list(project.domains or [])
    started_from = _parse_stamp(start, "start")
    started_to = _parse_stamp(end, "end")

    job_rows = (
        db.query(Job.id, Job.name)
        .filter(Job.project_id == project_id)
        .all()
    )
    job_names = {jid: name for jid, name in job_rows}

    runs_q = db.query(JobRun).filter(JobRun.job_id.in_(job_names.keys() or [-1]))
    if started_from is not None:
        runs_q = runs_q.filter(JobRun.started_at >= started_from)
    if started_to is not None:
        runs_q = runs_q.filter(JobRun.started_at < started_to)
    runs = runs_q.order_by(JobRun.started_at.desc()).all()
    run_by_id = {r.id: r for r in runs}

    empty = {
        "project": {"id": project.id, "name": project.name, "domains": domains},
        "runs": [],
        "rows": [],
        "multi_variant": False,
    }
    if not runs:
        return empty

    # Every (keyword, variant) these runs covered, and which run is newest for
    # each. Read from results rather than from the jobs' keyword lists, so a
    # keyword added to a job after a run does not appear as a row the run never
    # actually measured.
    coverage = (
        db.query(
            Result.keyword, Result.engine, Result.device, Result.location,
            Result.run_id,
        )
        .filter(Result.run_id.in_(run_by_id.keys()))
        .distinct()
        .all()
    )
    latest: dict[tuple, int] = {}
    for keyword, engine, device, location, run_id in coverage:
        key = (keyword, engine, device, location)
        current = latest.get(key)
        if current is None or (
            run_by_id[run_id].started_at > run_by_id[current].started_at
        ):
            latest[key] = run_id
    if not latest:
        return empty

    # Only the project's own hosts, and only from the runs that won above.
    cells: dict[tuple, dict] = {}
    if domains:
        wanted_hosts = [h for d in domains for h in _host_variants(d)]
        host_to_domain = {h: d for d in domains for h in _host_variants(d)}
        hits = (
            db.query(
                Result.keyword, Result.engine, Result.device, Result.location,
                Result.run_id, Result.domain, Result.position, Result.url,
            )
            .filter(
                Result.run_id.in_({rid for rid in latest.values()}),
                Result.domain.in_(wanted_hosts),
            )
            .all()
        )
        for keyword, engine, device, location, run_id, host, position, url in hits:
            key = (keyword, engine, device, location)
            # A result from a run this row did not pick is from an older run of
            # the same keyword; it is not this row's measurement.
            if latest.get(key) != run_id:
                continue
            domain = host_to_domain.get((host or "").lower())
            if domain is None:
                continue
            cell_key = (*key, domain)
            prior = cells.get(cell_key)
            # A site can hold several slots on one SERP. The best one is the
            # position it "has"; the rest are extra listings.
            if prior is None or position < prior["position"]:
                cells[cell_key] = {"position": position, "url": url}

    variants = {(engine, device, location) for _, engine, device, location in latest}
    rows = []
    # Sorted on a key that coerces None, because location is nullable and
    # Python refuses to order None against a string.
    def _order(item):
        (keyword, engine, device, location), _ = item
        return (keyword.lower(), engine, device, location or "")

    for (keyword, engine, device, location), run_id in sorted(latest.items(), key=_order):
        run = run_by_id[run_id]
        rows.append({
            "keyword": keyword,
            "engine": engine,
            "device": device,
            "location": location,
            "run_id": run_id,
            "job_id": run.job_id,
            "job_name": job_names.get(run.job_id),
            "checked_at": run.started_at,
            "positions": {
                d: cells.get((keyword, engine, device, location, d))
                for d in domains
            },
        })

    return {
        "project": {"id": project.id, "name": project.name, "domains": domains},
        "runs": [
            {
                "id": r.id, "job_id": r.job_id, "job_name": job_names.get(r.job_id),
                "status": r.status, "started_at": r.started_at,
            }
            for r in runs
        ],
        "rows": rows,
        # Lets the UI keep the variant columns out of the way on the common
        # case of a project tracking one engine, one device, one place.
        "multi_variant": len(variants) > 1,
    }
