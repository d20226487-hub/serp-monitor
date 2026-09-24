from datetime import datetime, timezone
from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    """A client or site being watched, and the domains that belong to it.

    The domains are what position tracking will look for in a SERP later; today
    they are only stored, so the list is deliberately dumb — normalised hosts,
    in the order pasted, with no per-domain metadata to migrate when tracking
    arrives.

    A project is also the folder the jobs list groups by. That grouping is
    derived from the association rather than stored anywhere: a project with no
    jobs simply shows no folder, and assigning the first job makes one appear.
    """
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("name", name="uq_project_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    # Normalised hosts: lowercase, no scheme, no path, no leading "www.".
    # Subdomains are KEPT — a doorway on kz.example.com is a different target
    # from example.com, and position tracking has to tell them apart.
    domains: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    jobs: Mapped[list["Job"]] = relationship(back_populates="project")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    # Which project's folder this job sits in. NULL = ungrouped, which is what
    # every job created before projects existed stays. ON DELETE SET NULL:
    # deleting a project must not take a year of run history with it.
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    keywords: Mapped[list] = mapped_column(JSON, default=list)
    engines: Mapped[list] = mapped_column(JSON, default=list)        # ["google", "yandex"]
    devices: Mapped[list] = mapped_column(JSON, default=list)        # ["desktop", "mobile"]
    locations: Mapped[list] = mapped_column(JSON, default=list)      # [{"canonical_name": "...", "country_code": "kz"}, ...]
    languages: Mapped[list] = mapped_column(JSON, default=list)      # ["ru", "kk", "en"]
    google_domains: Mapped[list] = mapped_column(JSON, default=list) # ["google.kz"] (optional, derived from country if empty)

    scrape_fields: Mapped[list] = mapped_column(JSON, default=list)  # ["url","title","description"]
    top_n: Mapped[int] = mapped_column(Integer, default=10)

    cron: Mapped[str | None] = mapped_column(String(64), nullable=True)
    schedule_enabled: Mapped[bool] = mapped_column(default=False)

    # Provider that runs this job's queries: "serpapi" | "brightdata" | "oxylabs".
    provider: Mapped[str] = mapped_column(String(20), default="serpapi")

    # Job mode:
    #   "serp"     — the original behaviour: scrape SERPs, show domain/URL
    #                distribution. Unchanged.
    #   "analyzer" — scrape SERPs, then run Ahrefs /batch-analysis over every
    #                unique result URL (mode=exact) and surface per-keyword
    #                median metrics as a ranking-difficulty view.
    mode: Mapped[str] = mapped_column(String(20), default="serp")
    # Ahrefs batch-analysis field ids to request in analyzer mode. Empty falls
    # back to ahrefs_batch.DEFAULT_METRICS. Each selected field bills ~1 unit
    # per URL, so this list is the cost lever.
    ahrefs_metrics: Mapped[list] = mapped_column(JSON, default=list)
    # Domain-level field selection, chosen independently of the URL-level one.
    # Empty list = domain enrichment disabled for this job.
    ahrefs_domain_metrics: Mapped[list] = mapped_column(JSON, default=list)
    # Look up domain registration dates via DataForSEO WHOIS and feed the age
    # to the AI judge. Its own switch rather than riding along with the domain
    # metrics because it bills a different provider on a different basis: ~$0.12
    # per request that needs the network, against Ahrefs units. Off by default,
    # so no existing job starts spending on it.
    whois_enabled: Mapped[bool] = mapped_column(default=False)

    runs: Mapped[list["JobRun"]] = relationship(back_populates="job", cascade="all,delete-orphan")
    project: Mapped["Project | None"] = relationship(back_populates="jobs")


class JobRun(Base):
    __tablename__ = "job_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|running|done|failed|canceled
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    queries_total: Mapped[int] = mapped_column(Integer, default=0)
    queries_done: Mapped[int] = mapped_column(Integer, default=0)
    queries_failed: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    triggered_by: Mapped[str] = mapped_column(String(20), default="manual")  # manual|schedule

    # Money spent on this run, in USD.
    #   cost_source="actual"   → reported by the provider itself (DataForSEO)
    #   cost_source="estimate" → queries_done × the per-provider rate configured
    #                            in Settings (SerpAPI/Bright Data/Oxylabs don't
    #                            report per-request cost)
    # Stored at run time so historical runs keep the rate that applied then —
    # changing a rate later must not silently rewrite past spend.
    cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Ahrefs API units billed for this run's batch-analysis phase (analyzer
    # mode only). Separate from `cost` — Ahrefs bills in units off a
    # subscription quota, not dollars per call.
    ahrefs_units: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # USD actually billed by DataForSEO for this run's WHOIS lookups. Separate
    # from `cost`, which is the SERP scrape: they are different providers on
    # different rates, and a run that answered entirely from the domain cache
    # legitimately spent 0.0 here while still costing money to scrape.
    whois_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Denominators for the per-domain cost. `whois_domains` is every registrable
    # domain the run needed; `whois_fetched` is how many of those were actually
    # bought rather than served from the cache. Both are stored because the
    # interesting figure changes with which one you divide by: cost per domain
    # BOUGHT says what the request fee amortised to, cost per domain KNOWN says
    # what the run paid for the answers it ended up with.
    whois_domains: Mapped[int | None] = mapped_column(Integer, nullable=True)
    whois_fetched: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Ahrefs targets served from the cross-run cache versus actually bought.
    # Reported so the units figure can be read against how much of the run was
    # paid for — a cheap run and a cached run look identical otherwise.
    ahrefs_cached: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ahrefs_fetched: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Per-run override of the opportunity formula, as JSON. NULL means "use the
    # global one", which is not the same as storing a copy of it: a run left on
    # the default follows Settings when the global changes, while a run that was
    # tuned deliberately keeps what it was tuned to.
    opportunity_formula: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # The phase this run most recently ENTERED: scrape | ahrefs | whois | ai.
    # A running run's status alone cannot say which of four phases it is in, and
    # the table fills in so unevenly — nothing visible for minutes while Ahrefs
    # and WHOIS work, then one verdict at a time — that a healthy run and a
    # stalled one look identical. Deliberately NOT cleared when the run ends: on
    # a failed run it is the answer to "where did it stop?".
    phase: Mapped[str | None] = mapped_column(String(20), nullable=True)

    job: Mapped[Job] = relationship(back_populates="runs")
    results: Mapped[list["Result"]] = relationship(back_populates="run", cascade="all,delete-orphan")


class AppSetting(Base):
    """Tiny key-value store for runtime-mutable settings (e.g. SerpAPI key)
    that the user can change from the UI without restarting the container."""
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class SavedLocation(Base):
    """User-curated locations. Used in the job form alongside live SerpAPI
    location search — SerpAPI's locations endpoint has thin coverage for some
    countries (notably CIS), so this lets the user maintain their own list.

    yandex_lr is Yandex's numeric region ID (Moscow=213, SPB=2, Almaty=162,
    Tashkent=11353, …). When set on a location and Yandex is the engine, we
    pass it as `lr=` to SerpAPI for true city-level Yandex targeting.
    """
    __tablename__ = "saved_locations"

    id: Mapped[int] = mapped_column(primary_key=True)
    canonical_name: Mapped[str] = mapped_column(String(300), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    target_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    yandex_lr: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class RunUrlMetric(Base):
    """Ahrefs metrics for one unique URL within one run (analyzer mode).

    Deduped per (run_id, url): the same URL can appear in several keyword SERPs
    in a run, and Ahrefs bills per target, so we fetch each URL once and join
    back to `results` on the URL when aggregating per keyword.
    """
    __tablename__ = "run_url_metrics"
    __table_args__ = (
        UniqueConstraint("run_id", "url", name="uq_run_url_metrics_run_url"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("job_runs.id", ondelete="CASCADE"), index=True
    )
    url: Mapped[str] = mapped_column(Text, index=True)
    # {field_id: value|None} exactly as returned by /batch-analysis. Stored raw
    # so adding a metric to the UI later needs no re-fetch for existing runs.
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    # Populated when this URL's chunk failed; metrics is then empty.
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class RunDomainMetric(Base):
    """Ahrefs domain-level metrics for one domain within one run.

    Separate from RunUrlMetric because the relationship is 1:many — one domain
    backs many result URLs — and because the two are fetched with different
    field sets in different Ahrefs modes.
    """
    __tablename__ = "run_domain_metrics"
    __table_args__ = (
        UniqueConstraint("run_id", "domain", name="uq_run_domain_metrics"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("job_runs.id", ondelete="CASCADE"), index=True
    )
    domain: Mapped[str] = mapped_column(String(255), index=True)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class KeywordVolume(Base):
    """Monthly search volume for one keyword in one country — cached globally.

    Global rather than per-run for the same reason DomainWhois is: a volume is
    a fact about the keyword, not about the run that happened to need it. A
    scheduled job would otherwise demand the numbers be re-entered every time
    it fires.

    `source` records where a figure came from. Today everything is "manual";
    the column exists so an automated fill later can be told apart from a hand
    -entered number, and so a later import never silently overwrites a figure
    the user typed on purpose.

    country_code is NULL for a figure that applies regardless of market, which
    is the fallback when no row matches the run's own country.
    """
    __tablename__ = "keyword_volumes"
    __table_args__ = (
        UniqueConstraint("keyword", "country_code", name="uq_keyword_volume"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    keyword: Mapped[str] = mapped_column(String(500), index=True)
    country_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    volume: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(20), default="manual")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class AhrefsMetricCache(Base):
    """Ahrefs metrics for one target, cached ACROSS runs.

    Distinct from RunUrlMetric/RunDomainMetric, which stay per-run on purpose:
    those are the historical record of what a run measured, and rewriting them
    from a later fetch would rewrite history. This table only exists to avoid
    re-buying a figure we already hold.

    Unlike the WHOIS cache, the TTL here is a real trade-off rather than a free
    win. DR, UR and backlink counts move daily, so caching too long makes a
    monitoring run report stale numbers — which is the thing re-running the job
    was meant to reveal. Hence a setting, defaulting to a week.

    Keyed on (target, mode) because Ahrefs answers differently per mode: the
    same host returns 9 organic keywords under mode=domain and 51,345 under
    mode=subdomains. Mixing them would be silently wrong.
    """
    __tablename__ = "ahrefs_metric_cache"
    __table_args__ = (
        UniqueConstraint("target", "mode", name="uq_ahrefs_cache_target_mode"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    target: Mapped[str] = mapped_column(Text, index=True)
    # "exact" for URL-level, "subdomains" for domain-level.
    mode: Mapped[str] = mapped_column(String(20))
    # Whatever fields were requested when this row was filled. A cached row can
    # serve a later request only if it holds EVERY field that request needs —
    # a run asking for six metrics cannot be answered from a four-metric row.
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class DomainWhois(Base):
    """WHOIS registration facts for one registrable domain — cached globally.

    Deliberately NOT scoped to a run. A registration date is a fact about the
    domain, not about when we looked: caching it across runs is what makes the
    feature affordable, because DataForSEO bills ~$0.12 per REQUEST regardless
    of how many domains it carries. A daily scheduled job therefore pays once
    and then answers from here until an unseen domain enters its SERPs.

    Keyed on the registrable domain (eTLD+1). Subdomains resolve to their
    parent's row — `by.tribuna.com` and `ua.tribuna.com` are one registration.
    """
    __tablename__ = "domain_whois"

    domain: Mapped[str] = mapped_column(String(255), primary_key=True)
    created_datetime: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    changed_datetime: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expiration_datetime: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    registrar: Mapped[str | None] = mapped_column(String(255), nullable=True)
    epp_status_codes: Mapped[list] = mapped_column(JSON, default=list)
    # False when DataForSEO's database simply has no row for this domain. Cached
    # as a real answer rather than left absent, because otherwise every run would
    # re-pay the request fee to be told "no" again. Refreshed sooner than a hit
    # (see WHOIS_MISS_TTL) since a domain missing today can appear later.
    found: Mapped[bool] = mapped_column(default=False)
    # Which lookup answered: "rdap" (free, registry-direct) or "dataforseo"
    # (paid fallback for the ccTLDs RDAP does not serve). Recorded because the
    # two disagree on coverage, and knowing which one produced a date is what
    # makes a surprising age checkable.
    source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class RunKeywordAnalysis(Base):
    """AI SERP-difficulty verdict for one keyword within one run."""
    __tablename__ = "run_keyword_analysis"
    __table_args__ = (
        UniqueConstraint("run_id", "keyword", name="uq_run_keyword_analysis"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("job_runs.id", ondelete="CASCADE"), index=True
    )
    keyword: Mapped[str] = mapped_column(String(500), index=True)
    # "low" | "medium" | "hard" | "too hard". NULL when the call failed.
    difficulty: Mapped[str | None] = mapped_column(String(20), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The exact text sent to the model, and the exact JSON it sent back.
    # Stored rather than rebuilt on demand: the prompt template, the metric
    # selection and the model itself can all change afterwards, so a
    # reconstruction would show what we WOULD send today, not what produced
    # this verdict. Written before the call, so a failed verdict still has its
    # prompt to look at — which is when you most want it.
    prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # Sampling temperature in force for this verdict. Without it, two runs of
    # the same SERP that disagree are indistinguishable from a settings change.
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Result(Base):
    __tablename__ = "results"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("job_runs.id", ondelete="CASCADE"), index=True)

    keyword: Mapped[str] = mapped_column(String(500), index=True)
    engine: Mapped[str] = mapped_column(String(20), index=True)
    device: Mapped[str] = mapped_column(String(20))
    location: Mapped[str | None] = mapped_column(String(300), nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    google_domain: Mapped[str | None] = mapped_column(String(64), nullable=True)

    position: Mapped[int] = mapped_column(Integer)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    domain: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)

    run: Mapped[JobRun] = relationship(back_populates="results")
