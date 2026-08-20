"""Job runner: expand a job into the cartesian product of variants and dispatch
to SerpAPI with bounded concurrency. Results are persisted as they arrive."""
from __future__ import annotations

import asyncio
import logging
from itertools import product
from typing import Iterable

from sqlalchemy.orm import Session

from ._redact import redact
from .app_settings import get_provider_rate
from .config import settings
from .db import SessionLocal
from .models import Job, JobRun, Result, RunUrlMetric, SavedLocation, utcnow
from .providers import get_provider

log = logging.getLogger(__name__)


# Map ISO country code -> default Google ccTLD when user doesn't pick one.
_COUNTRY_TO_GOOGLE_DOMAIN = {
    "kz": "google.kz", "ru": "google.ru", "ua": "google.com.ua",
    "by": "google.by", "uz": "google.co.uz", "kg": "google.kg",
    "tj": "google.com.tj", "tm": "google.com.tm", "tr": "google.com.tr",
    "az": "google.az", "am": "google.am", "ge": "google.ge",
    "us": "google.com", "gb": "google.co.uk", "de": "google.de",
    "fr": "google.fr", "es": "google.es", "it": "google.it",
    "nl": "google.nl", "pl": "google.pl", "br": "google.com.br",
    "ca": "google.ca", "au": "google.com.au", "in": "google.co.in",
    "jp": "google.co.jp", "kr": "google.co.kr", "sg": "google.com.sg",
    "mx": "google.com.mx", "ar": "google.com.ar", "ae": "google.ae",
    "sa": "google.com.sa",
}


def _yandex_lr_lookup(db, canonical_names: set[str]) -> dict[str, int]:
    """Map canonical_name → yandex_lr for any saved locations the user has
    configured with one. Used to enrich variants for Yandex queries."""
    if not canonical_names:
        return {}
    rows = (
        db.query(SavedLocation)
        .filter(SavedLocation.canonical_name.in_(list(canonical_names)))
        .filter(SavedLocation.yandex_lr.isnot(None))
        .all()
    )
    return {r.canonical_name: r.yandex_lr for r in rows if r.yandex_lr is not None}


def _expand_variants(job: Job, *, lr_map: dict[str, int] | None = None) -> list[dict]:
    """Cartesian product across keywords × engines × devices × locations × languages.

    Returns one variant dict per query to dispatch. Locations may be empty
    (no geo targeting) — represented by a single None entry.
    """
    keywords: list[str] = [k.strip() for k in (job.keywords or []) if k and k.strip()]
    engines = job.engines or ["google"]
    devices = job.devices or ["desktop"]
    locations = job.locations or [None]
    languages = job.languages or [None]
    google_domains: list[str | None] = list(job.google_domains or []) or [None]
    lr_map = lr_map or {}

    variants: list[dict] = []
    seen: set[tuple] = set()
    for kw, eng, dev, loc, lang in product(keywords, engines, devices, locations, languages):
        # Yandex doesn't use google_domain; collapse the axis to a single None.
        domain_axis: list[str | None] = google_domains if eng == "google" else [None]
        for gdom in domain_axis:
            country_code = (loc or {}).get("country_code") if loc else None
            canonical = (loc or {}).get("canonical_name") if loc else None
            effective_gdom = gdom or (
                _COUNTRY_TO_GOOGLE_DOMAIN.get((country_code or "").lower()) if eng == "google" else None
            )
            yandex_lr = lr_map.get(canonical) if (eng == "yandex" and canonical) else None
            key = (kw, eng, dev, canonical, lang, effective_gdom, yandex_lr)
            if key in seen:
                continue
            seen.add(key)
            variants.append({
                "keyword": kw,
                "engine": eng,
                "device": dev,
                "location": loc,
                "language": lang,
                "google_domain": effective_gdom,
                "country_code": country_code,
                "yandex_lr": yandex_lr,
            })
    return variants


def estimate_queries(job: Job) -> dict:
    variants = _expand_variants(job)
    by_engine: dict[str, int] = {}
    for v in variants:
        by_engine[v["engine"]] = by_engine.get(v["engine"], 0) + 1
    return {"total_queries": len(variants), "by_engine": by_engine}


async def _execute_variant(provider, v: dict, top_n: int) -> list[dict]:
    if v["engine"] == "google":
        return await provider.search_google(
            keyword=v["keyword"],
            device=v["device"],
            location=v["location"],
            language=v["language"],
            google_domain=v["google_domain"],
            country_code=v["country_code"],
            top_n=top_n,
        )
    elif v["engine"] == "yandex":
        cc = (v["country_code"] or "").lower()
        domain = {
            "ru": "yandex.ru", "by": "yandex.by", "kz": "yandex.kz",
            "uz": "yandex.uz", "tr": "yandex.com.tr",
        }.get(cc, "yandex.com")
        return await provider.search_yandex(
            keyword=v["keyword"],
            device=v["device"],
            language=v["language"],
            yandex_domain=domain,
            yandex_lr=v.get("yandex_lr"),
            country_code=v["country_code"],
            top_n=top_n,
        )
    else:
        raise ValueError(f"unsupported engine: {v['engine']}")


def _persist_results(db: Session, run_id: int, variant: dict, rows: list[dict]) -> None:
    location_name = (variant["location"] or {}).get("canonical_name") if variant["location"] else None
    for r in rows:
        db.add(Result(
            run_id=run_id,
            keyword=variant["keyword"],
            engine=variant["engine"],
            device=variant["device"],
            location=location_name,
            country_code=variant["country_code"],
            language=variant["language"],
            google_domain=variant["google_domain"],
            position=r["position"],
            url=r.get("url"),
            title=r.get("title"),
            description=r.get("description"),
            domain=r.get("domain"),
        ))
    db.commit()


async def _run_ahrefs_analysis(db: Session, run_id: int, job: Job) -> int:
    """Analyzer mode phase 2: Ahrefs /batch-analysis over this run's URLs.

    Deduplicates URLs first — the same page often ranks for several keywords in
    one run and Ahrefs bills per target, so fetching each URL once is a direct
    cost saving. Chunks are issued sequentially: a run's URL count is bounded by
    keywords x top_n (hundreds, not the 100k Drop Sherlock has to handle), and
    serial chunking keeps us well clear of Ahrefs' rate limits without needing
    a token bucket.

    Returns the total Ahrefs units billed.
    """
    import httpx

    from .app_settings import get_ahrefs_api_key
    from .providers.ahrefs_batch import (
        BATCH_SIZE,
        canonical_metrics,
        fetch_batch_chunk,
    )

    api_key = get_ahrefs_api_key()
    if not api_key:
        raise RuntimeError(
            "Ahrefs API key is not configured — set it in Settings → Ahrefs."
        )

    select = canonical_metrics(getattr(job, "ahrefs_metrics", None))

    # Unique, non-empty URLs from this run, in a stable order.
    rows = (
        db.query(Result.url)
        .filter(Result.run_id == run_id, Result.url.isnot(None))
        .all()
    )
    seen: set[str] = set()
    urls: list[str] = []
    for (u,) in rows:
        u = (u or "").strip()
        if u and u not in seen:
            seen.add(u)
            urls.append(u)
    if not urls:
        return 0

    total_units = 0
    async with httpx.AsyncClient(timeout=60) as client:
        for i in range(0, len(urls), BATCH_SIZE):
            chunk = urls[i : i + BATCH_SIZE]
            outcome = await fetch_batch_chunk(client, api_key, chunk, select)
            total_units += outcome.cost_billed or 0
            now = utcnow()
            if outcome.error:
                # Record the failure against every URL in the chunk so the UI
                # can distinguish "not analysed" from "analysed, no data".
                for u in chunk:
                    db.add(RunUrlMetric(
                        run_id=run_id, url=u, metrics={},
                        error=outcome.error[:500], fetched_at=now,
                    ))
            else:
                for u in chunk:
                    db.add(RunUrlMetric(
                        run_id=run_id, url=u,
                        metrics=outcome.metrics_by_url.get(u) or {},
                        error=None, fetched_at=now,
                    ))
            db.commit()
    return total_units


async def run_job_async(run_id: int) -> None:
    """Top-level entrypoint scheduled by the API/scheduler. Owns its own DB session."""
    db = SessionLocal()
    try:
        run = db.get(JobRun, run_id)
        if run is None:
            log.error("run %s not found", run_id)
            return
        job = db.get(Job, run.job_id)
        if job is None:
            run.status = "failed"
            run.error = "job not found"
            run.finished_at = utcnow()
            db.commit()
            return

        # Look up Yandex region IDs once for any saved locations on this job.
        canonical_names = {
            (loc or {}).get("canonical_name") for loc in (job.locations or [])
            if loc and (loc.get("canonical_name") if isinstance(loc, dict) else None)
        }
        canonical_names.discard(None)
        lr_map = _yandex_lr_lookup(db, canonical_names)

        variants = _expand_variants(job, lr_map=lr_map)
        if len(variants) > settings.max_queries_per_run:
            run.status = "failed"
            run.error = (
                f"variant count {len(variants)} exceeds MAX_QUERIES_PER_RUN="
                f"{settings.max_queries_per_run}"
            )
            run.finished_at = utcnow()
            db.commit()
            return

        run.status = "running"
        run.queries_total = len(variants)
        db.commit()

        provider_name = getattr(job, "provider", None) or "serpapi"
        async with get_provider(provider_name) as provider:
            async def worker(v: dict):
                try:
                    rows = await _execute_variant(provider, v, job.top_n or 10)
                    _persist_results(db, run.id, v, rows)
                    run.queries_done += 1
                except Exception as e:  # noqa: BLE001
                    run.queries_failed += 1
                    log.exception("variant failed: %s", v)
                    if not run.error:
                        # redact() scrubs api_key/token/password from URL or
                        # header strings before persistence — providers should
                        # already redact at the source, but this is defense
                        # in depth in case a future provider doesn't.
                        run.error = redact(f"{type(e).__name__}: {e}")
                finally:
                    db.commit()

            await asyncio.gather(*(worker(v) for v in variants))

        # Analyzer mode: enrich the SERP we just captured with Ahrefs metrics.
        # Runs AFTER the scrape because it needs the result URLs. Failures here
        # never fail the run — the SERP data is already saved and useful on its
        # own; the error is recorded so the UI can explain the empty column.
        if (getattr(job, "mode", None) or "serp") == "analyzer":
            try:
                units = await _run_ahrefs_analysis(db, run.id, job)
                if units:
                    run.ahrefs_units = units
            except Exception as e:  # noqa: BLE001
                log.exception("ahrefs analysis failed for run %s", run.id)
                if not run.error:
                    run.error = redact(f"Ahrefs analysis failed: {e}")
            db.commit()

        # Record spend for this run. Providers that report real cost (DataForSEO)
        # win over the configured rate; everyone else gets queries_done × rate.
        # We store the resulting number rather than computing it at read time so
        # that editing a rate later can't silently rewrite historical spend.
        if getattr(provider, "reports_cost", False):
            run.cost = round(provider.reported_cost, 6)
            run.cost_source = "actual"
        else:
            run.cost = round(run.queries_done * get_provider_rate(provider_name), 6)
            run.cost_source = "estimate"

        run.status = "done" if run.queries_failed == 0 else (
            "failed" if run.queries_done == 0 else "done"
        )
        run.finished_at = utcnow()
        db.commit()
    except Exception as e:  # noqa: BLE001
        log.exception("run_job_async crashed")
        run = db.get(JobRun, run_id)
        if run:
            run.status = "failed"
            run.error = redact(f"crash: {type(e).__name__}: {e}")
            run.finished_at = utcnow()
            db.commit()
    finally:
        db.close()


def run_job_sync(run_id: int) -> None:
    """Sync wrapper for APScheduler (which calls plain callables)."""
    asyncio.run(run_job_async(run_id))


def mark_orphaned_runs_failed(db: Session) -> None:
    """On startup, any run still 'running' is from a crashed process."""
    stuck = db.query(JobRun).filter(JobRun.status.in_(["running", "pending"])).all()
    for r in stuck:
        r.status = "failed"
        r.error = (r.error or "") + " | process restarted while running"
        r.finished_at = utcnow()
    if stuck:
        db.commit()


def create_run(db: Session, job_id: int, *, triggered_by: str = "manual") -> JobRun:
    run = JobRun(job_id=job_id, status="pending", triggered_by=triggered_by)
    db.add(run)
    db.commit()
    db.refresh(run)
    return run
