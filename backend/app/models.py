from datetime import datetime, timezone
from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
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

    runs: Mapped[list["JobRun"]] = relationship(back_populates="job", cascade="all,delete-orphan")


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
