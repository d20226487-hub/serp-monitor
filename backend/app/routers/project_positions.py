"""Where a project's domains rank, for the keywords its jobs watch.

This is the first thing that reads Project.domains — until now they were only
stored. It answers one question: over some window of time, for each keyword we
track, what position does each of our domains hold?

Three decisions worth knowing, because they are what make the numbers mean
something:

* Results are split into one table per SERP, and a SERP is the whole of
  (engine, device, country, language, location, google domain) — the same tuple
  the run page and the browser-URL builder treat as one variant. Every one of
  those changes the page that comes back, so two of them sharing a row would
  average positions no single page ever held. Splitting rather than adding a
  column also means each table's keyword column reads straight down.

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

#: What makes one SERP distinct from another. Every field here changes the page
#: the engine returns, so two of them must never share a table: the same term
#: asked of google.kz in Russian from Almaty and of google.com in Kazakh from
#: Astana are two different results pages. Mirrors the tuple the run page and
#: lib/browser-urls already treat as one variant.
SERP_COLUMNS = (
    "engine", "device", "country_code", "language", "location", "google_domain",
)


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
        "serps": [],
    }
    if not runs:
        return empty

    # Every (keyword, SERP) these runs covered, and which run is newest for
    # each. Read from results rather than from the jobs' keyword lists, so a
    # keyword added to a job after a run does not appear as a row the run never
    # actually measured.
    coverage = (
        db.query(
            Result.keyword, *[getattr(Result, c) for c in SERP_COLUMNS],
            Result.run_id,
        )
        .filter(Result.run_id.in_(run_by_id.keys()))
        .distinct()
        .all()
    )
    latest: dict[tuple, int] = {}
    for row in coverage:
        key, run_id = tuple(row[:-1]), row[-1]
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
                Result.keyword, *[getattr(Result, c) for c in SERP_COLUMNS],
                Result.run_id, Result.domain, Result.position, Result.url,
            )
            .filter(
                Result.run_id.in_({rid for rid in latest.values()}),
                Result.domain.in_(wanted_hosts),
            )
            .all()
        )
        for row in hits:
            key = tuple(row[: 1 + len(SERP_COLUMNS)])
            run_id, host, position, url = row[-4:]
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

    # One table per SERP, keywords sorted inside it. The SERPs themselves are
    # ordered by engine then device then place, so a project watching the same
    # terms in two cities lists them the same way on every visit.
    serps: dict[tuple, dict] = {}
    for key, run_id in latest.items():
        keyword, serp_key = key[0], key[1:]
        run = run_by_id[run_id]
        serp = serps.get(serp_key)
        if serp is None:
            serp = {
                **dict(zip(SERP_COLUMNS, serp_key)),
                "key": "|".join("" if v is None else str(v) for v in serp_key),
                "rows": [],
            }
            serps[serp_key] = serp
        serp["rows"].append({
            "keyword": keyword,
            "run_id": run_id,
            "job_id": run.job_id,
            "job_name": job_names.get(run.job_id),
            "checked_at": run.started_at,
            "positions": {d: cells.get((*key, d)) for d in domains},
        })

    for serp in serps.values():
        serp["rows"].sort(key=lambda r: r["keyword"].lower())

    return {
        "project": {"id": project.id, "name": project.name, "domains": domains},
        "runs": [
            {
                "id": r.id, "job_id": r.job_id, "job_name": job_names.get(r.job_id),
                "status": r.status, "started_at": r.started_at,
            }
            for r in runs
        ],
        "serps": [
            serps[k] for k in sorted(
                serps,
                # None sorts before a string, and location is nullable.
                key=lambda t: tuple("" if v is None else str(v) for v in t),
            )
        ],
    }
