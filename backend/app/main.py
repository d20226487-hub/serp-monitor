import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import Base, SessionLocal, engine
from .models import SavedLocation
from .routers import (
    export, jobs, keyword_volumes, locations, runs, settings as settings_router,
)
from .scheduler import get_scheduler, reload_all_schedules
from .tasks import mark_orphaned_runs_failed


def _seed_saved_locations(db) -> None:
    """First-boot only: load CIS/Eurasia defaults if the table is empty."""
    if db.query(SavedLocation).first():
        return
    seed_path = Path(__file__).resolve().parent / "data" / "seed_locations.json"
    if not seed_path.exists():
        return
    items = json.loads(seed_path.read_text(encoding="utf-8"))
    for item in items:
        db.add(SavedLocation(**item))
    db.commit()


def _backfill_yandex_lr_from_seed(db) -> None:
    """Populate `yandex_lr` from the seed file ONLY for rows where it's NULL.
    Existing non-NULL values are never touched — the UI is authoritative.

    Use case: a location was inserted before yandex_lr was tracked (NULL) →
    we set it from seed if known. If you want to *correct* a wrong value,
    edit it in the Settings UI; we won't fight you.
    """
    seed_path = Path(__file__).resolve().parent / "data" / "seed_locations.json"
    if not seed_path.exists():
        return
    items = json.loads(seed_path.read_text(encoding="utf-8"))
    seed_lr = {
        item["canonical_name"]: item["yandex_lr"]
        for item in items
        if item.get("yandex_lr") is not None
    }
    if not seed_lr:
        return
    rows = (
        db.query(SavedLocation)
        .filter(SavedLocation.yandex_lr.is_(None))
        .all()
    )
    updated = 0
    for r in rows:
        target = seed_lr.get(r.canonical_name)
        if target is not None:
            r.yandex_lr = target
            updated += 1
    if updated:
        db.commit()


def _migrate_sqlite_columns() -> None:
    """Idempotent additive migrations for SQLite. SQLAlchemy's create_all
    doesn't add columns to an existing table, so we ALTER TABLE manually
    for new optional columns. Safe to run on every boot."""
    from sqlalchemy import text
    additions = [
        # (table, column_name, ddl)
        ("saved_locations", "yandex_lr", "INTEGER"),
        ("jobs", "provider", "VARCHAR(20) NOT NULL DEFAULT 'serpapi'"),
        # Per-run spend. NULL on runs that predate cost tracking — the UI shows
        # "—" for those rather than pretending they were free.
        ("job_runs", "cost", "FLOAT"),
        ("job_runs", "cost_source", "VARCHAR(16)"),
        # Analyzer mode. Existing jobs default to "serp" so behaviour is
        # unchanged for everything created before this.
        ("jobs", "mode", "VARCHAR(20) NOT NULL DEFAULT 'serp'"),
        ("jobs", "ahrefs_metrics", "JSON"),
        ("jobs", "ahrefs_domain_metrics", "JSON"),
        # Ahrefs units actually billed for the run's batch-analysis phase.
        ("job_runs", "ahrefs_units", "INTEGER"),
        # WHOIS domain-age lookups. Existing jobs default to off so nothing
        # starts billing DataForSEO without being asked to.
        ("jobs", "whois_enabled", "BOOLEAN NOT NULL DEFAULT 0"),
        ("job_runs", "whois_cost", "FLOAT"),
        ("job_runs", "whois_domains", "INTEGER"),
        ("job_runs", "whois_fetched", "INTEGER"),
        # NULL = inherit the global opportunity formula.
        ("job_runs", "opportunity_formula", "JSON"),
        # Which lookup answered a cached WHOIS row.
        ("domain_whois", "source", "VARCHAR(20)"),
    ]
    # Values to backfill into rows that predate a column. ALTER TABLE ADD COLUMN
    # without a DEFAULT leaves existing rows NULL, which then fails response
    # validation for any non-Optional field — that's exactly how `ahrefs_metrics`
    # took down GET /jobs. Idempotent: only touches rows still NULL.
    backfills = [
        ("jobs", "ahrefs_metrics", "'[]'"),
        ("jobs", "ahrefs_domain_metrics", "'[]'"),
    ]
    with engine.begin() as conn:
        for table, column, ddl in additions:
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
        for table, column, value in backfills:
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if column in existing:
                conn.execute(
                    text(f"UPDATE {table} SET {column} = {value} WHERE {column} IS NULL")
                )


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate_sqlite_columns()
    db = SessionLocal()
    try:
        mark_orphaned_runs_failed(db)
        _seed_saved_locations(db)
        _backfill_yandex_lr_from_seed(db)
        reload_all_schedules(db)
    finally:
        db.close()
    sched = get_scheduler()
    sched.start()
    try:
        yield
    finally:
        sched.shutdown(wait=False)


app = FastAPI(title="SERP Monitor", lifespan=lifespan)

# Same-origin via Caddy reverse proxy in prod; CORS open in dev for convenience.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs.router)
app.include_router(runs.router)
app.include_router(export.router)
app.include_router(locations.router)
app.include_router(keyword_volumes.router)
app.include_router(settings_router.router)


@app.get("/health")
def health():
    return {"ok": True}
