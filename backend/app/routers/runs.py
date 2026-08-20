from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Job, JobRun, Result, RunUrlMetric
from ..providers.ahrefs_batch import canonical_metrics
from ..schemas import JobRunOut, ResultOut

router = APIRouter(prefix="/runs", tags=["runs"])


@router.get("/{run_id}", response_model=JobRunOut)
def get_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(JobRun, run_id)
    if not run:
        raise HTTPException(404)
    return run


@router.get("/{run_id}/results", response_model=list[ResultOut])
def get_results(
    run_id: int,
    keyword: str | None = Query(None),
    engine: str | None = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(Result).filter(Result.run_id == run_id)
    if keyword:
        q = q.filter(Result.keyword == keyword)
    if engine:
        q = q.filter(Result.engine == engine)
    return q.order_by(Result.keyword, Result.engine, Result.device, Result.position).all()


# A result at or below this UR/DR is treated as a "weak slot" — a realistically
# displaceable position. 20 is a rule of thumb, not an Ahrefs constant.
WEAK_THRESHOLD = 20


def _median(values: list[float]) -> float | None:
    """Median of the present values, or None when nothing was measurable.

    Median rather than mean on purpose: a SERP routinely mixes one
    Wikipedia-grade result with nine ordinary ones, and a mean would let that
    single outlier dominate the difficulty read for the whole keyword.
    """
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    mid = len(vals) // 2
    if len(vals) % 2:
        return float(vals[mid])
    return (float(vals[mid - 1]) + float(vals[mid])) / 2.0


@router.get("/{run_id}/analysis")
def get_analysis(run_id: int, db: Session = Depends(get_db)):
    """Per-keyword median Ahrefs metrics for an analyzer-mode run.

    Returns the job's mode so the run page can decide which view to render
    without a second request for the job.
    """
    run = db.get(JobRun, run_id)
    if not run:
        raise HTTPException(404)
    job = db.get(Job, run.job_id)
    mode = (getattr(job, "mode", None) or "serp") if job else "serp"
    selected = canonical_metrics(getattr(job, "ahrefs_metrics", None)) if job else []

    if mode != "analyzer":
        return {"mode": mode, "metrics": [], "rows": [], "ahrefs_units": None}

    # url -> metrics, for this run only.
    by_url: dict[str, dict] = {}
    errored: set[str] = set()
    for m in db.query(RunUrlMetric).filter(RunUrlMetric.run_id == run_id).all():
        by_url[m.url] = m.metrics or {}
        if m.error:
            errored.add(m.url)

    # Group result URLs per keyword. A keyword's SERP may span engines/devices/
    # locations; we aggregate across the whole keyword, matching the "median of
    # all results in one SERP" the table is meant to show.
    per_keyword: dict[str, list[str]] = {}
    for kw, url in (
        db.query(Result.keyword, Result.url)
        .filter(Result.run_id == run_id, Result.url.isnot(None))
        .all()
    ):
        per_keyword.setdefault(kw, []).append(url)

    rows = []
    for kw, urls in per_keyword.items():
        uniq = list(dict.fromkeys(u for u in urls if u))
        medians: dict[str, float | None] = {}
        means: dict[str, float | None] = {}
        mins: dict[str, float | None] = {}
        maxes: dict[str, float | None] = {}
        for field in selected:
            vals = [(by_url.get(u) or {}).get(field) for u in uniq if u in by_url]
            present = [v for v in vals if v is not None]
            medians[field] = _median(vals)
            means[field] = (sum(present) / len(present)) if present else None
            mins[field] = min(present) if present else None
            maxes[field] = max(present) if present else None

        # "Weak slots": how many results in this SERP look displaceable. Ranking
        # top-10 means beating the WEAKEST result you can reach, not the median
        # — a SERP whose median DR is 60 but which contains three DR<20 pages is
        # far more winnable than the median alone suggests.
        weak_field = "url_rating" if "url_rating" in selected else (
            "domain_rating" if "domain_rating" in selected else None
        )
        weak_slots = None
        if weak_field:
            weak_slots = sum(
                1 for u in uniq
                if u in by_url
                and ((by_url.get(u) or {}).get(weak_field) or 0) < WEAK_THRESHOLD
            )

        analysed = sum(1 for u in uniq if u in by_url and u not in errored)
        rows.append({
            "keyword": kw,
            "urls_total": len(uniq),
            "urls_analysed": analysed,
            "medians": medians,
            "means": means,
            "mins": mins,
            "maxes": maxes,
            "weak_slots": weak_slots,
            "weak_field": weak_field,
            # Raw per-URL detail, for manual verification of what Ahrefs
            # actually returned. Ordered by SERP position.
            "urls": [
                {
                    "url": u,
                    "metrics": by_url.get(u) or {},
                    "error": (u in errored),
                    "analysed": u in by_url,
                }
                for u in uniq
            ],
            # Placeholder for phase 2 — the AI difficulty verdict.
            "difficulty": None,
        })
    rows.sort(key=lambda r: r["keyword"].lower())

    return {
        "mode": mode,
        "metrics": selected,
        "rows": rows,
        "ahrefs_units": run.ahrefs_units,
    }


@router.delete("/{run_id}")
def delete_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(JobRun, run_id)
    if not run:
        raise HTTPException(404)
    db.delete(run)
    db.commit()
    return {"ok": True}
