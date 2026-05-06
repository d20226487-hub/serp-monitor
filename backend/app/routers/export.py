"""CSV export. Long format: one row per (keyword, variant, position).
The user can cap each (keyword, variant) group to top-N positions."""
from __future__ import annotations

import csv
import io
import re
import unicodedata
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Job, JobRun, Result

router = APIRouter(prefix="/runs", tags=["export"])

_COLS = [
    "keyword", "engine", "device", "country_code", "location",
    "language", "google_domain", "position", "url", "title",
    "description", "domain",
]


def _slugify(s: str, max_len: int = 60) -> str:
    """Filesystem-safe slug. Transliterates accents, keeps a-z/0-9/-/_."""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", s)
    # Collapse runs of separators (handles em-dash → '--', preexisting '---', etc.)
    s = re.sub(r"[-_.]{2,}", "-", s).strip("-_.")
    return (s or "job")[:max_len].lower()


def _human_timestamp(dt: datetime) -> str:
    """Readable, filesystem-safe stamp.
    Date is DD-MM-YYYY, time is H.MM.SS-AM/PM (no leading zero on hour;
    colons aren't allowed on Windows so we use dots instead)."""
    date = dt.strftime("%d-%m-%Y")           # 02-05-2026
    hour12 = int(dt.strftime("%I"))          # 1..12 (no leading zero)
    rest = dt.strftime("%M.%S")              # 05.25
    ampm = dt.strftime("%p")                 # AM / PM
    return f"{date}_{hour12}.{rest}-{ampm}"  # 02-05-2026_4.05.25-PM


@router.get("/{run_id}/export.csv")
def export_csv(
    run_id: int,
    top: int = Query(10, ge=1, le=100, description="Cap top-N per (keyword,variant)"),
    db: Session = Depends(get_db),
):
    run = db.get(JobRun, run_id)
    if not run:
        raise HTTPException(404)
    job = db.get(Job, run.job_id)

    rows = (
        db.query(Result)
        .filter(Result.run_id == run_id)
        .filter(Result.position <= top)
        .order_by(
            Result.keyword, Result.engine, Result.device,
            Result.country_code, Result.language, Result.position,
        )
        .all()
    )

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_COLS)
    for r in rows:
        writer.writerow([getattr(r, c) for c in _COLS])
    buf.seek(0)

    job_slug = _slugify(job.name) if job else "job"
    ts_source = run.started_at or datetime.utcnow()
    ts = _human_timestamp(ts_source)
    filename = f"{job_slug}_{ts}_run{run_id}_top{top}.csv"

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            # ASCII-safe `filename` for legacy + RFC 5987 `filename*` for unicode.
            "Content-Disposition": (
                f'attachment; filename="{filename}"; '
                f"filename*=UTF-8''{filename}"
            ),
        },
    )
