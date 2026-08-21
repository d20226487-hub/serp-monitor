from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    DomainWhois, Job, JobRun, KeywordVolume, Result, RunDomainMetric,
    RunKeywordAnalysis, RunUrlMetric,
)
from ..app_settings import (
    DEFAULT_OPPORTUNITY_FORMULA,
    coerce_opportunity_formula,
    get_opportunity_formula,
)
from ..providers.ahrefs_batch import canonical_domain_metrics, canonical_metrics
from ..providers.dataforseo_whois import domain_age_days
from ..providers.registrable import registrable_domain
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


def _domain_rows(
    pairs, by_domain: dict, fields: list[str], by_whois: dict | None = None
) -> list[dict]:
    """Distinct domains behind this keyword's results, with metrics and age.

    Renders when EITHER Ahrefs domain metrics or WHOIS ages are available —
    they are separate job switches, and requiring both would make domain age
    silently do nothing when enabled on its own.
    """
    by_whois = by_whois or {}
    if not fields and not by_whois:
        return []
    out, seen = [], set()
    for _original, canonical in pairs:
        host = _host_of(canonical)
        if not host or host in seen:
            continue
        seen.add(host)
        # WHOIS is keyed on the registration, so a subdomain reads its parent's
        # row. `registrable` travels with it so the UI can say whose date it is
        # rather than implying the subdomain itself is that old.
        registrable = registrable_domain(host)
        w = by_whois.get(registrable or "")
        # The parent's own Ahrefs figures, when this host is a subdomain and we
        # measured the parent too. Kept as a separate field rather than merged:
        # they are a different entity, and flattening them into one row is the
        # confusion this exists to remove.
        parent_metrics = (
            by_domain.get(registrable)
            if registrable and registrable != host
            else None
        )
        out.append({
            "domain": host,
            "metrics": by_domain.get(host) or {},
            "analysed": host in by_domain,
            "parent_metrics": parent_metrics or None,
            "registrable": registrable,
            "is_subdomain": bool(registrable) and registrable != host,
            "age_days": domain_age_days(w.created_datetime) if w else None,
            "created": w.created_datetime.isoformat() if w and w.created_datetime else None,
            "registrar": w.registrar if w else None,
            # Distinguishes "not looked up" from "looked up, no record": a
            # domain absent from DataForSEO's database is a fact worth showing,
            # not an empty cell that reads like a bug.
            "whois_checked": w is not None,
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
            "whois_cost": None, "whois_domains": None, "whois_fetched": None,
            "whois_enabled": False, "country": None, "countries": [],
            "sub_national": False,
            "formula": get_opportunity_formula(),
            "formula_is_override": False,
            "formula_global": get_opportunity_formula(),
            "formula_defaults": dict(DEFAULT_OPPORTUNITY_FORMULA),
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

    # Registration facts for every domain this run touched. Loaded once per
    # request rather than per keyword — the same domain shows up across
    # keywords, and the cache table is global.
    by_whois: dict[str, DomainWhois] = {}
    if getattr(job, "whois_enabled", False):
        hosts = {
            registrable_domain(d.domain or "")
            for d in db.query(RunDomainMetric.domain)
            .filter(RunDomainMetric.run_id == run_id)
            .all()
        }
        # RunDomainMetric only exists when Ahrefs domain metrics were requested,
        # so fall back to the run's result URLs when age was enabled alone.
        if not any(hosts):
            hosts = {
                registrable_domain(_host_of(normalize_url((u or "").strip())))
                for (u,) in db.query(Result.url)
                .filter(Result.run_id == run_id, Result.url.isnot(None))
                .distinct()
                .all()
            }
        wanted = sorted(h for h in hosts if h)
        if wanted:
            by_whois = {
                w.domain: w
                for w in db.query(DomainWhois)
                .filter(DomainWhois.domain.in_(wanted), DomainWhois.found.is_(True))
                .all()
            }

    # The run's primary market: the country most of its results came from.
    # A job can span countries, and the same brand term is worth different
    # traffic in each, so the score needs one deterministic market to price
    # against rather than silently mixing them.
    country_rows = (
        db.query(Result.country_code, func.count(Result.id))
        .filter(Result.run_id == run_id, Result.country_code.isnot(None))
        .group_by(Result.country_code)
        .order_by(func.count(Result.id).desc())
        .all()
    )
    primary_country = (country_rows[0][0] or "").lower() or None if country_rows else None
    # Case is inconsistent in the results table ("CA" alongside "us"), so
    # normalise before this list is compared or displayed anywhere.
    all_countries = sorted({(cc or "").lower() for cc, _ in country_rows if cc})

    # Whether this run was aimed narrower than a country. Keyword tools report
    # volume per COUNTRY, so a city-targeted run is measured from Almaty while
    # its demand figure covers all of Kazakhstan. That is usually the right
    # denominator — the city is a vantage point, not the market — but it is not
    # something the table should leave the reader to infer.
    sub_national = bool(
        db.query(Result.id)
        .filter(
            Result.run_id == run_id,
            Result.location.isnot(None),
            Result.location.like("%,%"),
        )
        .first()
    )

    # Volumes: the country-specific figure when there is one, otherwise the
    # country-agnostic row. Absent stays absent — a keyword with no volume is
    # unranked rather than scored as zero demand.
    volumes: dict[str, dict] = {}
    kw_list = [
        k for (k,) in db.query(Result.keyword)
        .filter(Result.run_id == run_id).distinct().all()
    ]
    if kw_list:
        for v in (
            db.query(KeywordVolume)
            .filter(
                KeywordVolume.keyword.in_(kw_list),
                KeywordVolume.country_code.in_([primary_country, None])
                if primary_country else KeywordVolume.country_code.is_(None),
            )
            .all()
        ):
            cur = volumes.get(v.keyword)
            # A country-specific row always beats the country-agnostic one.
            if cur is None or (v.country_code is not None and cur["country"] is None):
                volumes[v.keyword] = {
                    "volume": v.volume, "country": v.country_code, "source": v.source,
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
            "domains": _domain_rows(pairs, by_domain, domain_selected, by_whois),
            "volume": (volumes.get(kw) or {}).get("volume"),
            "volume_country": (volumes.get(kw) or {}).get("country"),
            "volume_source": (volumes.get(kw) or {}).get("source"),
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
        "whois_cost": getattr(run, "whois_cost", None),
        "whois_domains": getattr(run, "whois_domains", None),
        "whois_fetched": getattr(run, "whois_fetched", None),
        "whois_enabled": bool(getattr(job, "whois_enabled", False)) if job else False,
        # Which market the volumes are priced in, so the UI can label the column
        # and write edits back against the right country.
        "country": primary_country,
        # Every country the run touched. More than one means the score is
        # pricing demand in `country` alone and ignoring the rest.
        "countries": all_countries,
        # True when the run targeted a city or region rather than a whole
        # country, so the UI can say the volume is country-wide.
        "sub_national": sub_national,
        # The formula this run is actually scored with, already resolved: the
        # run's own override if it has one, otherwise the global. The UI never
        # has to merge these itself, so the numbers on screen and the numbers
        # the server thinks are in force cannot drift apart.
        "formula": coerce_opportunity_formula(
            getattr(run, "opportunity_formula", None) or get_opportunity_formula()
        ),
        # Whether that came from an override, so the UI can offer "reset to
        # global" only when there is something to reset.
        "formula_is_override": getattr(run, "opportunity_formula", None) is not None,
        "formula_global": get_opportunity_formula(),
        "formula_defaults": dict(DEFAULT_OPPORTUNITY_FORMULA),
    }


@router.put("/{run_id}/opportunity")
def set_run_opportunity(run_id: int, payload: dict, db: Session = Depends(get_db)):
    """Override the opportunity formula for this run only.

    Stored per run rather than per job because the tuning that makes sense is
    a property of what you are looking at right now — a run whose SERPs are all
    brand-owned wants a harsher "too hard" factor than one full of doorways.
    """
    run = db.get(JobRun, run_id)
    if not run:
        raise HTTPException(404)
    run.opportunity_formula = coerce_opportunity_formula(payload or {})
    db.commit()
    return {"formula": run.opportunity_formula, "formula_is_override": True}


@router.delete("/{run_id}/opportunity")
def clear_run_opportunity(run_id: int, db: Session = Depends(get_db)):
    """Drop this run's override so it follows the global formula again."""
    run = db.get(JobRun, run_id)
    if not run:
        raise HTTPException(404)
    run.opportunity_formula = None
    db.commit()
    return {"formula": get_opportunity_formula(), "formula_is_override": False}


@router.delete("/{run_id}")
def delete_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(JobRun, run_id)
    if not run:
        raise HTTPException(404)
    db.delete(run)
    db.commit()
    return {"ok": True}
