"""Job runner: expand a job into the cartesian product of variants and dispatch
to SerpAPI with bounded concurrency. Results are persisted as they arrive."""
from __future__ import annotations

import asyncio
import logging
from datetime import timezone
from urllib.parse import urlsplit
from itertools import product
from typing import Iterable, NamedTuple

from sqlalchemy.orm import Session

from ._redact import redact
from .app_settings import get_provider_rate
from .config import settings
from .db import SessionLocal
from .models import (
    DomainWhois,
    Job,
    JobRun,
    Result,
    RunDomainMetric,
    RunKeywordAnalysis,
    RunUrlMetric,
    SavedLocation,
    utcnow,
)
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
        DOMAIN_MODE,
        canonical_domain_metrics,
        canonical_metrics,
        fetch_batch_chunk,
    )
    from .providers.url_normalize import normalize_url

    api_key = get_ahrefs_api_key()
    if not api_key:
        raise RuntimeError(
            "Ahrefs API key is not configured — set it in Settings → Ahrefs."
        )

    select = canonical_metrics(getattr(job, "ahrefs_metrics", None))

    # Unique, non-empty URLs from this run, in a stable order.
    #
    # NORMALISED first: search engines often rank an AMP or parameter-decorated
    # variant, and Ahrefs treats those as separate URLs with an empty link
    # profile. Measured on a real SERP, normalising turned "0 backlinks" into
    # 298 for the same page — analysing the raw SERP URL badly under-reports how
    # strong the ranking page is. Deduping AFTER normalisation also collapses
    # amp+canonical pairs into one billed target.
    rows = (
        db.query(Result.url)
        .filter(Result.run_id == run_id, Result.url.isnot(None))
        .all()
    )
    seen: set[str] = set()
    urls: list[str] = []
    for (u,) in rows:
        canonical = normalize_url((u or "").strip())
        if canonical and canonical not in seen:
            seen.add(canonical)
            urls.append(canonical)
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

        # --- Domain-level pass -------------------------------------------
        # Answers the one question page metrics can't: is this a weak page on a
        # STRONG site (a parasite page) or a weak page on a weak site? Measured
        # example: liga.net's article had 25 referring domains, the domain had
        # 1,992. For single-page spam sites the two are identical, so this adds
        # nothing there — but distinguishing the two cases is the point.
        #
        # Separate request, not mixed into the URL one: `select` is per-request,
        # so mixing modes would force the union of both field sets onto every
        # target and cost more than paying the 50-unit floor twice.
        domain_select = canonical_domain_metrics(
            getattr(job, "ahrefs_domain_metrics", None)
        )
        if domain_select:
            domains: list[str] = []
            dseen: set[str] = set()
            for u in urls:
                host = (urlsplit(u).hostname or "").lower()
                if host.startswith("www."):
                    host = host[4:]
                if host and host not in dseen:
                    dseen.add(host)
                    domains.append(host)
            # Also measure the REGISTRABLE PARENT of every subdomain.
            #
            # Without this the two domain-level signals describe different
            # entities: Ahrefs runs in mode=subdomains, so a result on
            # melbet.ru.uptodown.com reports that subdomain's 1 referring
            # domain, while its age is uptodown.com's 23.7 years. Read as one
            # row that is nonsense. Measuring both makes the actual situation
            # legible — an empty subdomain parked on a huge platform — and
            # separates it from a doorway sitting on its own fresh domain.
            from .providers.registrable import registrable_domain
            for host in list(domains):
                parent = registrable_domain(host)
                if parent and parent != host and parent not in dseen:
                    dseen.add(parent)
                    domains.append(parent)
            for i in range(0, len(domains), BATCH_SIZE):
                chunk = domains[i : i + BATCH_SIZE]
                outcome = await fetch_batch_chunk(
                    client, api_key, chunk, domain_select, mode=DOMAIN_MODE
                )
                total_units += outcome.cost_billed or 0
                now = utcnow()
                for d in chunk:
                    db.add(RunDomainMetric(
                        run_id=run_id, domain=d,
                        metrics=({} if outcome.error else (outcome.metrics_by_url.get(d) or {})),
                        error=outcome.error[:500] if outcome.error else None,
                        fetched_at=now,
                    ))
                db.commit()
    return total_units


# How long a cached WHOIS row is trusted. Registration dates are immutable, so
# a hit could arguably be cached forever; 180 days just bounds the staleness of
# the expiry/registrar fields that ride along. A MISS expires far sooner because
# "not in DataForSEO's database" is a statement about their coverage today, and
# a domain absent this month may be present next.
WHOIS_TTL_DAYS = 180
WHOIS_MISS_TTL_DAYS = 14


class WhoisPhase(NamedTuple):
    """What one run's WHOIS phase cost, and over how many domains.

    The counts travel with the cost because the price is mostly a fixed request
    fee: $0.12 spread over two domains is $0.06 each, over two hundred it is
    $0.0018. Without a denominator the dollar figure alone says nothing about
    whether the run was efficient.
    """
    cost: float
    domains: int   # registrable domains this run needed, cached ones included
    fetched: int   # of those, how many were actually bought


async def _run_whois(db: Session, run_id: int, job: Job) -> WhoisPhase:
    """Analyzer phase 2b: registration dates for this run's domains.

    Cost is 0.0 whenever the cache covered everything — the common case for a
    scheduled job whose SERPs are stable.

    Domain age is the one thing Ahrefs cannot tell us, and it is what separates
    "small site with a lot of links" from "doorway registered last spring".
    """
    import httpx

    from .app_settings import get_provider_creds
    from .providers.dataforseo_whois import fetch_whois
    from .providers.rdap import fetch_many as rdap_fetch_many
    from .providers.registrable import registrable_domain
    from .providers.url_normalize import normalize_url

    # Every host this run touched, reduced to the registration it belongs to.
    # WHOIS has no row for a subdomain, so `by.tribuna.com` has to become
    # `tribuna.com` or the lookup silently returns nothing.
    #
    # Derived from the run's own results rather than from RunDomainMetric:
    # those rows only exist when the job also asked for Ahrefs DOMAIN metrics,
    # and domain age is its own switch. Reading them would make age silently do
    # nothing whenever it was enabled on its own.
    wanted: set[str] = set()
    for (url,) in (
        db.query(Result.url)
        .filter(Result.run_id == run_id, Result.url.isnot(None))
        .distinct()
        .all()
    ):
        # Same normalisation the Ahrefs domain pass applies, so both phases
        # agree on which host a result belongs to.
        host = (urlsplit(normalize_url((url or "").strip())).hostname or "").lower()
        reg = registrable_domain(host)
        if reg:
            wanted.add(reg)
    if not wanted:
        return WhoisPhase(0.0, 0, 0)

    now = utcnow()
    fresh: set[str] = set()
    for row in db.query(DomainWhois).filter(DomainWhois.domain.in_(sorted(wanted))).all():
        ttl = WHOIS_TTL_DAYS if row.found else WHOIS_MISS_TTL_DAYS
        # utcnow() is tz-aware, but SQLite's DateTime drops the offset on write
        # and hands back a naive value, so this subtraction has to re-attach UTC
        # or it raises. Every timestamp in this table is written as UTC.
        stamp = row.fetched_at
        if stamp is not None and stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        age = (now - stamp).days if stamp else ttl + 1
        if age > ttl:
            continue
        # A MISS recorded before RDAP existed is not evidence of anything: it
        # only means the paid database had no row, and RDAP answers most of
        # exactly those domains. Retry them rather than trusting a negative
        # cached against a source that could not have known.
        if not row.found and row.source is None:
            continue
        fresh.add(row.domain)

    stale = sorted(wanted - fresh)
    if not stale:
        # Nothing to buy. This is the steady state for a recurring job and the
        # whole reason the cache is keyed on the domain rather than the run.
        log.info("whois: run %s fully cached (%s domains)", run_id, len(wanted))
        return WhoisPhase(0.0, len(wanted), 0)

    def store(domain: str, rec, source: str | None) -> None:
        db.merge(DomainWhois(
            domain=domain,
            created_datetime=getattr(rec, "created_datetime", None),
            changed_datetime=getattr(rec, "changed_datetime", None),
            expiration_datetime=getattr(rec, "expiration_datetime", None),
            registrar=getattr(rec, "registrar", None),
            epp_status_codes=getattr(rec, "epp_status_codes", None) or [],
            found=rec is not None,
            source=source,
            fetched_at=now,
        ))

    # --- RDAP first ---------------------------------------------------------
    # Free, registry-direct, and it covers precisely what the paid database
    # cannot: on run 68 DataForSEO had no row for 17 of 63 domains, all of them
    # doorways on new gTLDs, and RDAP answered 15 of them — some a day old.
    batch = await rdap_fetch_many(stale)
    rdap_hits = batch.found
    for domain, rec in rdap_hits.items():
        store(domain, rec, "rdap")
    remaining = [d for d in stale if d not in rdap_hits]
    if rdap_hits:
        db.commit()

    if not remaining:
        log.info(
            "whois: run %s resolved %s via RDAP, %s cached, $0 spent",
            run_id, len(rdap_hits), len(fresh),
        )
        return WhoisPhase(0.0, len(wanted), len(stale))

    # --- DataForSEO for whatever RDAP could not serve ------------------------
    # Mostly ccTLDs: .kz, .ru, .by, .am and .uz have no RDAP service.
    creds = get_provider_creds("dataforseo")
    login, password = creds.get("login", ""), creds.get("password", "")
    if not login or not password:
        # Not fatal any more: RDAP may already have answered most of the run,
        # and losing a few ccTLD ages beats losing the whole phase.
        log.warning(
            "whois: run %s has %s domains RDAP could not resolve and no "
            "DataForSEO credentials — leaving them unknown",
            run_id, len(remaining),
        )
        return WhoisPhase(0.0, len(wanted), len(stale))

    async with httpx.AsyncClient(timeout=60) as client:
        outcome = await fetch_whois(client, login, password, remaining)

    if outcome.error:
        # RDAP's hits are already committed above and keep their value; only the
        # unresolved tail is lost. Nothing is written as a miss on failure —
        # that would cache a transient blip as "absent" for two weeks.
        raise RuntimeError(f"WHOIS lookup failed: {outcome.error}")

    for domain, rec in outcome.found.items():
        store(domain, rec, "dataforseo")
    for domain in outcome.missing:
        # A domain RDAP failed on TRANSIENTLY is not known to be absent — it is
        # unknown. Caching it as a miss would hide its age for two weeks over
        # what may have been one timed-out request, so leave no row at all and
        # let the next run ask again.
        if domain in batch.transient:
            continue
        # Genuinely absent from both sources. Cached so the next run does not
        # re-pay the request fee to be told the same thing.
        db.merge(DomainWhois(
            domain=domain, created_datetime=None, changed_datetime=None,
            expiration_datetime=None, registrar=None, epp_status_codes=[],
            found=False, source="dataforseo", fetched_at=now,
        ))
    db.commit()
    log.info(
        "whois: run %s — %s via RDAP (free), %s via DataForSEO, %s cached, "
        "%s absent, %s retryable, cost $%.4f",
        run_id, len(rdap_hits), len(outcome.found), len(fresh),
        len(outcome.missing) - len(batch.transient), len(batch.transient),
        outcome.cost,
    )
    return WhoisPhase(outcome.cost, len(wanted), len(stale))


async def _run_ai_difficulty(db: Session, run_id: int, job: Job) -> None:
    """Analyzer phase 3: one AI verdict per keyword.

    Sends a single united table per keyword (SERP result + that URL's Ahrefs
    metrics on the same row). Sequential: a run has a handful of keywords, and
    serial calls keep us clear of per-minute quotas without a rate limiter.

    Per-keyword failures are recorded on that keyword's row and never abort the
    phase — one bad SERP shouldn't cost you the other nine verdicts.
    """
    from .app_settings import get_ai_analysis_provider
    from .ai.serp_difficulty import build_domain_table, build_serp_table, judge_keyword
    from .providers.ahrefs_batch import canonical_domain_metrics, canonical_metrics
    from .providers.dataforseo_whois import domain_age_days, format_age
    from .providers.registrable import registrable_domain
    from .providers.url_normalize import normalize_url

    provider_code = get_ai_analysis_provider()
    if not provider_code:
        return  # no AI configured — metrics-only run, by design

    metrics = canonical_metrics(getattr(job, "ahrefs_metrics", None))
    domain_metrics = canonical_domain_metrics(getattr(job, "ahrefs_domain_metrics", None))

    by_domain = {
        d.domain: (d.metrics or {})
        for d in db.query(RunDomainMetric).filter(RunDomainMetric.run_id == run_id).all()
    }

    # Registration facts, keyed by registrable domain. Looked up per host below
    # via the same reduction the WHOIS phase used, so a subdomain picks up its
    # parent's row instead of coming back blank.
    whois_rows = {}
    if getattr(job, "whois_enabled", False):
        whois_rows = {w.domain: w for w in db.query(DomainWhois).all()}

    # url -> metrics for this run.
    by_url = {
        m.url: (m.metrics or {})
        for m in db.query(RunUrlMetric).filter(RunUrlMetric.run_id == run_id).all()
    }

    results = (
        db.query(Result)
        .filter(Result.run_id == run_id)
        .order_by(Result.keyword, Result.position)
        .all()
    )
    per_keyword: dict[str, list[Result]] = {}
    for r in results:
        per_keyword.setdefault(r.keyword, []).append(r)

    for keyword, rows in per_keyword.items():
        # Skip keywords already judged (resume-safe, and avoids paying twice).
        exists = (
            db.query(RunKeywordAnalysis)
            .filter(
                RunKeywordAnalysis.run_id == run_id,
                RunKeywordAnalysis.keyword == keyword,
                RunKeywordAnalysis.difficulty.isnot(None),
            )
            .first()
        )
        if exists:
            continue

        variants = {(r.engine, r.device, r.location) for r in rows}
        table_rows = []
        for r in rows:
            canonical = normalize_url(r.url or "")
            table_rows.append({
                "position": r.position,
                "url": r.url,
                "title": r.title,
                "description": r.description,
                "engine": r.engine,
                "device": r.device,
                "location": r.location,
                "metrics": by_url.get(canonical) or by_url.get(r.url or "") or {},
            })
        table = build_serp_table(table_rows, metrics, multi_variant=len(variants) > 1)
        # Distinct domains behind this keyword's results, in first-seen order.
        dom_rows, dseen = [], set()
        for tr in table_rows:
            host = (urlsplit(tr['url'] or '').hostname or '').lower()
            if host.startswith('www.'):
                host = host[4:]
            if host and host not in dseen:
                dseen.add(host)
                parent = registrable_domain(host)
                row_out = {'domain': host, 'metrics': by_domain.get(host) or {}}
                w = whois_rows.get(parent or '') if whois_rows else None
                if w is not None and w.found:
                    row_out['age'] = format_age(domain_age_days(w.created_datetime))
                    row_out['registrar'] = w.registrar
                    # Say whose registration the age describes. Without this the
                    # model reads uptodown.com's 23 years as the age of a
                    # throwaway subdomain parked on it.
                    if parent and parent != host:
                        row_out['age_of'] = parent
                dom_rows.append(row_out)
                # The parent's own figures, indented beneath, so "empty
                # subdomain on a huge platform" is distinguishable from
                # "doorway on its own fresh domain".
                if parent and parent != host and parent in by_domain and parent not in dseen:
                    dseen.add(parent)
                    dom_rows.append({
                        'domain': parent,
                        'metrics': by_domain.get(parent) or {},
                        'indent': True,
                    })
        domain_table = build_domain_table(dom_rows, domain_metrics)

        row = RunKeywordAnalysis(run_id=run_id, keyword=keyword)
        try:
            verdict = await judge_keyword(
                provider_code, keyword, table, domain_table=domain_table
            )
            row.difficulty = verdict["difficulty"]
            row.comment = verdict["comment"]
            row.model = verdict["model"]
            row.prompt_tokens = verdict["prompt_tokens"]
            row.completion_tokens = verdict["completion_tokens"]
        except Exception as e:  # noqa: BLE001 — recorded per keyword
            log.warning("ai difficulty failed for %r: %s", keyword, e)
            row.error = redact(str(e))[:500]
        db.add(row)
        db.commit()


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

            # Domain ages, before the AI phase so the judge can see them.
            # Gated on its own job flag: this bills DataForSEO per request, not
            # Ahrefs units, and only pays when the domain cache misses.
            if getattr(job, "whois_enabled", False):
                try:
                    phase = await _run_whois(db, run.id, job)
                    run.whois_cost = round(phase.cost, 6)
                    run.whois_domains = phase.domains
                    run.whois_fetched = phase.fetched
                except Exception as e:  # noqa: BLE001
                    log.exception("whois lookup failed for run %s", run.id)
                    if not run.error:
                        run.error = redact(f"Domain age lookup failed: {e}")
                db.commit()

            # AI difficulty scoring. Skipped silently when no AI provider is
            # configured — the metrics table is useful on its own, and this
            # phase costs tokens on every scheduled run.
            try:
                await _run_ai_difficulty(db, run.id, job)
            except Exception as e:  # noqa: BLE001
                log.exception("ai difficulty failed for run %s", run.id)
                if not run.error:
                    run.error = redact(f"AI difficulty failed: {e}")
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
