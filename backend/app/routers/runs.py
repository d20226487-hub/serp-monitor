from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    Job, JobRun, Result, RunDomainMetric, RunKeywordAnalysis, RunUrlMetric,
)
from ..providers.ahrefs_batch import canonical_domain_metrics, canonical_metrics
from ..providers.url_normalize import normalize_url
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


def _host_of(url: str) -> str:
    from urllib.parse import urlsplit
    host = (urlsplit(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def _domain_rows(pairs, by_domain: dict, fields: list[str]) -> list[dict]:
    """Distinct domains behind this keyword's results, with their metrics."""
    if not fields:
        return []
    out, seen = [], set()
    for _original, canonical in pairs:
        host = _host_of(canonical)
        if not host or host in seen:
            continue
        seen.add(host)
        out.append({
            "domain": host,
            "metrics": by_domain.get(host) or {},
            "analysed": host in by_domain,
        })
    return out


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
    domain_selected = (
        canonical_domain_metrics(getattr(job, "ahrefs_domain_metrics", None)) if job else []
    )

    if mode != "analyzer":
        return {
            "mode": mode, "metrics": [], "domain_metrics": [],
            "rows": [], "ahrefs_units": None,
        }

    # url -> metrics, for this run only.
    by_url: dict[str, dict] = {}
    errored: set[str] = set()
    for m in db.query(RunUrlMetric).filter(RunUrlMetric.run_id == run_id).all():
        by_url[m.url] = m.metrics or {}
        if m.error:
            errored.add(m.url)

    by_domain = {
        d.domain: (d.metrics or {})
        for d in db.query(RunDomainMetric).filter(RunDomainMetric.run_id == run_id).all()
    }

    ai = {
        a.keyword: {
            "difficulty": a.difficulty,
            "comment": a.comment,
            "error": a.error,
        }
        for a in db.query(RunKeywordAnalysis)
        .filter(RunKeywordAnalysis.run_id == run_id)
        .all()
    }

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
        # Map each SERP URL to the canonical form we actually asked Ahrefs
        # about, then dedupe on that — an AMP variant and its canonical are one
        # page. `pairs` keeps the original so the raw table can show both.
        pairs: list[tuple[str, str]] = []
        seen_c: set[str] = set()
        for u in urls:
            if not u:
                continue
            c = normalize_url(u)
            if c in seen_c:
                continue
            seen_c.add(c)
            pairs.append((u, c))
        # Runs made BEFORE normalisation stored metrics under the raw SERP URL,
        # so look up the canonical form first and fall back to the original.
        # Without this, every pre-existing analyzer run would suddenly read
        # "not analysed". We deliberately do NOT re-key the old rows: their
        # metrics describe the AMP variant, and moving them onto the canonical
        # URL would relabel wrong data as right.
        uniq = [c if c in by_url else o for o, c in pairs]
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
                    # What ranked, and what we measured — shown separately so a
                    # normalisation is always visible rather than silent.
                    # `key` is whichever URL actually holds the metrics (see the
                    # legacy fallback above).
                    "url": original,
                    "analyzed_url": (key := canonical if canonical in by_url else original),
                    "normalized": original != key,
                    "metrics": by_url.get(key) or {},
                    "error": (key in errored),
                    "analysed": key in by_url,
                }
                for original, canonical in pairs
            ],
            # One entry per distinct domain in this keyword's SERP (1:many with
            # the URLs, hence its own list rather than columns on each URL row).
            "domains": _domain_rows(pairs, by_domain, domain_selected),
            "difficulty": (ai.get(kw) or {}).get("difficulty"),
            "comment": (ai.get(kw) or {}).get("comment"),
            "ai_error": (ai.get(kw) or {}).get("error"),
        })
    rows.sort(key=lambda r: r["keyword"].lower())

    return {
        "mode": mode,
        "metrics": selected,
        "domain_metrics": domain_selected,
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
