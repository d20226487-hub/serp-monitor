"""Searchable dropdown source for locations + ship-with-app lists for languages
and Google ccTLDs."""
from __future__ import annotations

import json
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Job, SavedLocation, utcnow
from ..schemas import BulkLocationsImport, SavedLocationCreate, SavedLocationOut
from ..providers.serpapi import search_serpapi_locations

router = APIRouter(prefix="/lookup", tags=["lookup"])

_DATA = Path(__file__).resolve().parent.parent / "data"

_locations_cache: dict[str, tuple[float, list[dict]]] = {}
_CACHE_TTL = 60 * 60  # 1h


@router.get("/languages")
def list_languages():
    return json.loads((_DATA / "languages.json").read_text(encoding="utf-8"))


@router.get("/google-domains")
def list_google_domains():
    return json.loads((_DATA / "google_domains.json").read_text(encoding="utf-8"))


@router.get("/locations")
async def search_locations(q: str = Query(..., min_length=1), limit: int = 20):
    if not q.strip():
        raise HTTPException(400, "q required")
    key = f"{q.lower()}::{limit}"
    now = time.time()
    cached = _locations_cache.get(key)
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]
    rows = await search_serpapi_locations(q, limit=limit)
    # Trim to fields we use to keep the wire small.
    trimmed = [
        {
            "canonical_name": r.get("canonical_name"),
            "name": r.get("name"),
            "country_code": r.get("country_code"),
            "target_type": r.get("target_type"),
            "reach": r.get("reach"),
        }
        for r in rows
        if r.get("canonical_name")
    ]
    _locations_cache[key] = (now, trimmed)
    return trimmed


# --- Saved (manual) locations -----------------------------------------------

@router.get("/saved-locations", response_model=list[SavedLocationOut])
def list_saved_locations(
    q: str | None = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(SavedLocation)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(
            SavedLocation.canonical_name.ilike(like),
            SavedLocation.name.ilike(like),
            SavedLocation.country_code.ilike(like),
        ))
    return query.order_by(SavedLocation.canonical_name).all()


@router.post("/saved-locations", response_model=SavedLocationOut)
def create_saved_location(payload: SavedLocationCreate, db: Session = Depends(get_db)):
    existing = db.query(SavedLocation).filter(
        SavedLocation.canonical_name == payload.canonical_name
    ).first()
    if existing:
        raise HTTPException(409, "canonical_name already exists")
    loc = SavedLocation(**payload.model_dump())
    db.add(loc)
    db.commit()
    db.refresh(loc)
    return loc


def _cascade_rename_jobs(
    db: Session,
    *,
    old_canonical: str,
    new_canonical: str,
    new_country_code: str | None,
    new_name: str | None,
    new_target_type: str | None,
) -> int:
    """When a saved location is renamed (or its country / display fields change),
    rewrite the matching entries in every Job.locations JSON array.

    Job.locations is a JSON column with no FK to SavedLocation — the soft link
    is the string `canonical_name`. Without this cascade, jobs keep snapshots
    of the OLD value forever, so renaming in Settings has no effect on actual
    runs (and silently re-fails them with the old, broken canonical_name).

    Returns: number of Job rows actually modified.
    """
    if not old_canonical:
        return 0
    rows = db.query(Job).all()
    modified = 0
    now = utcnow()
    for job in rows:
        if not job.locations:
            continue
        changed = False
        # Build a new list — SQLAlchemy's default JSON type doesn't track
        # in-place mutations of a Python list, so we always reassign.
        rebuilt: list = []
        for entry in job.locations:
            if isinstance(entry, dict) and entry.get("canonical_name") == old_canonical:
                rebuilt.append({
                    **entry,
                    "canonical_name": new_canonical,
                    "country_code": new_country_code,
                    "name": new_name,
                    "target_type": new_target_type,
                })
                changed = True
            else:
                rebuilt.append(entry)
        if changed:
            job.locations = rebuilt
            job.updated_at = now
            modified += 1
    return modified


@router.patch("/saved-locations/{loc_id}", response_model=SavedLocationOut)
def update_saved_location(
    loc_id: int,
    payload: SavedLocationCreate,
    db: Session = Depends(get_db),
):
    loc = db.get(SavedLocation, loc_id)
    if not loc:
        raise HTTPException(404)

    # Snapshot the old canonical_name BEFORE the patch so we can find affected
    # job rows even when canonical_name itself is the field being changed.
    old_canonical = loc.canonical_name

    for k, v in payload.model_dump().items():
        setattr(loc, k, v)

    # Cascade to job rows. We propagate canonical_name + country_code + name +
    # target_type — not yandex_lr, because that's looked up at run time from
    # the saved_locations table directly (see tasks._yandex_lr_lookup).
    _cascade_rename_jobs(
        db,
        old_canonical=old_canonical,
        new_canonical=loc.canonical_name,
        new_country_code=loc.country_code,
        new_name=loc.name,
        new_target_type=loc.target_type,
    )
    db.commit()
    db.refresh(loc)
    return loc


@router.delete("/saved-locations/{loc_id}")
def delete_saved_location(loc_id: int, db: Session = Depends(get_db)):
    loc = db.get(SavedLocation, loc_id)
    if not loc:
        raise HTTPException(404)
    db.delete(loc)
    db.commit()
    return {"ok": True}


@router.post("/saved-locations/import")
def bulk_import(payload: BulkLocationsImport, db: Session = Depends(get_db)):
    """Idempotent bulk insert. Existing canonical_names are skipped."""
    existing = {
        cn for (cn,) in db.query(SavedLocation.canonical_name).all()
    }
    added = 0
    for item in payload.items:
        if item.canonical_name in existing:
            continue
        db.add(SavedLocation(**item.model_dump()))
        existing.add(item.canonical_name)
        added += 1
    db.commit()
    return {"added": added, "skipped": len(payload.items) - added}
