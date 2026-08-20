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


@router.get("/{run_id}/analysis")
def get_analysis(run_id: int, db: Session = Depends(get_db)):
    """Per-keyword SERP breakdown, position by position, for an analyzer run.

    Deliberately NOT aggregated here. The question this view answers is "which
    slot could I realistically take", and that is a per-position question: the
    bar you must clear is set by the weakest competitors inside the depth you
    are aiming for, not by any average of the whole SERP. So the API ships the
    ladder — every URL with its SERP position, domain and metrics — and the UI
    picks the cohort and averages it at whatever depth the user selects,
    without a refetch.

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

    # Group result URLs per keyword, carrying SERP position. Position is the
    # ABSOLUTE slot on the page — every provider reports rank_absolute, not the
    # organic-only rank — so a gap in the sequence means an ad or an AI block
    # sat there. That is exactly what "top 5" should mean here: the five slots a
    # searcher actually sees, not the first five organic rows.
    per_keyword: dict[str, list[tuple[int, str]]] = {}
    for kw, pos, url in (
        db.query(Result.keyword, Result.position, Result.url)
        .filter(
            Result.run_id == run_id,
            Result.url.isnot(None),
            # Position is non-nullable by the model, but a row without one
            # cannot be placed on the ladder at all — filter rather than
            # invent a slot for it.
            Result.position.isnot(None),
        )
        .all()
    ):
        per_keyword.setdefault(kw, []).append((pos, url))

    rows = []
    for kw, hits in per_keyword.items():
        # Map each SERP URL to the canonical form we actually asked Ahrefs
        # about, then dedupe on that — an AMP variant and its canonical are one
        # page. `pairs` keeps the original so the raw table can show both.
        #
        # A keyword's SERP may span engines, devices and locations, so the same
        # page can occupy several positions. We sort by position first and keep
        # the BEST one as the page's rank: if a doorway hits #2 in one city, it
        # is a top-5 competitor, and averaging that away with its #9 elsewhere
        # would hide the very thing this view exists to surface. The full spread
        # travels alongside it so the UI can show where else it landed.
        by_canonical: dict[str, dict] = {}
        for pos, u in sorted(hits, key=lambda h: h[0]):
            if not u:
                continue
            c = normalize_url(u)
            entry = by_canonical.get(c)
            if entry is None:
                by_canonical[c] = {"original": u, "canonical": c, "positions": [pos]}
            elif pos not in entry["positions"]:
                entry["positions"].append(pos)
        pairs: list[tuple[str, str]] = [
            (e["original"], e["canonical"]) for e in by_canonical.values()
        ]
        # Runs made BEFORE normalisation stored metrics under the raw SERP URL,
        # so look up the canonical form first and fall back to the original.
        # Without this, every pre-existing analyzer run would suddenly read
        # "not analysed". We deliberately do NOT re-key the old rows: their
        # metrics describe the AMP variant, and moving them onto the canonical
        # URL would relabel wrong data as right.
        uniq = [c if c in by_url else o for o, c in pairs]
        analysed = sum(1 for u in uniq if u in by_url and u not in errored)
        rows.append({
            "keyword": kw,
            "urls_total": len(uniq),
            "urls_analysed": analysed,
            # The ladder: one entry per distinct page in this keyword's SERP,
            # ordered by position. This is both the raw evidence for manual
            # verification and the input the UI reduces to the weakest-domain
            # cohort at whatever depth is selected.
            "urls": [
                {
                    # What ranked, and what we measured — shown separately so a
                    # normalisation is always visible rather than silent.
                    # `key` is whichever URL actually holds the metrics (see the
                    # legacy fallback above).
                    "url": original,
                    "analyzed_url": (key := canonical if canonical in by_url else original),
                    "normalized": original != key,
                    # Best slot this page reached anywhere in the keyword's
                    # SERPs; `positions` is every slot it held, so a page that
                    # is #2 in one city and #9 in another reads as both.
                    "position": min(by_canonical[canonical]["positions"]),
                    "positions": sorted(by_canonical[canonical]["positions"]),
                    # Same host normalisation the domain table uses, so "two
                    # pages from one site" means the same thing in both places.
                    # The UI needs it to keep one domain from occupying more
                    # than one slot in the weakest-competitors cohort.
                    "domain": _host_of(canonical),
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
