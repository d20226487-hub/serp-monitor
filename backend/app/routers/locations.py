"""Searchable dropdown source for locations + ship-with-app lists for languages
and Google ccTLDs."""
from __future__ import annotations

import json
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Job, SavedLocation, utcnow
from ..provider_locations import LIST_OF, codes_present, ensure_synced, lists_for, resolve
from ..provider_locations import search as search_mirror
from ..schemas import BulkLocationsImport, LocationCheckIn, SavedLocationCreate, SavedLocationOut
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


def _providers(raw: str | None) -> list[str]:
    return [p.strip().lower() for p in (raw or "").split(",") if p.strip()]


def one_per_place(rows: list[dict]) -> list[dict]:
    """SerpAPI lists a renamed place under BOTH names — "Almaty,Almaty Region,
    Kazakhstan" and the older "…Almaty Province…" share google_id 9063099.
    Offering both invites picking the same city twice, so one stays: the entry
    carrying a `reach`, which is the current name. Order is otherwise kept."""
    best: dict[int, dict] = {}
    out: list[dict] = []
    for r in rows:
        gid = r.get("google_id")
        if gid is None:
            out.append(r)
        elif gid not in best:
            best[gid] = r
            out.append(r)
        elif best[gid].get("reach") is None and r.get("reach") is not None:
            out[out.index(best[gid])] = r
            best[gid] = r
    return out


def _ready_lists(providers: list[str]) -> list[str]:
    """The mirrored lists these providers need that are actually there to be
    checked against (a list that could not be downloaded filters nothing)."""
    return [name for name in lists_for(providers) if ensure_synced(name)]


def _row(loc) -> dict:
    return {
        "canonical_name": loc.name, "name": loc.name.split(",")[0],
        "country_code": loc.country_code, "target_type": loc.location_type,
        "reach": None, "google_id": loc.code,
    }


@router.get("/locations")
async def search_locations(
    q: str = Query(..., min_length=1),
    limit: int = 20,
    providers: str | None = Query(None, description="Comma-separated; only places ALL of them can search"),
):
    """Location search for the job form: the places every provider on the job
    can search, out of each provider's own complete list.

    * No provider on the job is SerpAPI → the search runs in the providers' own
      mirrored lists (Google's geo-targets for Bright Data and Oxylabs,
      DataForSEO's for DataForSEO; see provider_locations.py), so every place
      they support can be found, under its current name.
    * SerpAPI is on the job → SerpAPI's live search is the source, because only
      it has SerpAPI's spellings; its rows are then narrowed to the ones the
      other providers' lists also hold (same Google ID).
    * No providers given → SerpAPI's search, unfiltered, as before.
    """
    if not q.strip():
        raise HTTPException(400, "q required")
    wanted = _providers(providers)
    key = f"{q.lower()}::{limit}::{','.join(sorted(wanted))}"
    now = time.time()
    cached = _locations_cache.get(key)
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]
    lists = await run_in_threadpool(_ready_lists, wanted)
    if lists and "serpapi" not in wanted:
        # Names from Google's list when it is one of them: they are the
        # current official ones, which is what a uule has to carry.
        primary = "google" if "google" in lists else lists[0]
        # SerpAPI is asked too, only for how BIG each place is (its `reach`):
        # that is what puts Paris, France ahead of the Parises of the US. No
        # answer just means namesakes come in name order.
        try:
            reach = {r["google_id"]: r["reach"] for r in await search_serpapi_locations(q, limit=limit * 3)
                     if r.get("google_id") and r.get("reach")}
        except Exception:  # noqa: BLE001 - ordering help, never a reason to fail the search
            reach = {}
        found = search_mirror(primary, q, limit * 3, reach)
        for other in lists:
            if other != primary:
                known = codes_present(other, [f.code for f in found])
                found = [f for f in found if f.code in known]
        trimmed = [_row(f) for f in found]
    else:
        # Ask for more than we return when filtering: a narrowed list should
        # not come back nearly empty because the first twenty were the wrong ones.
        rows = await search_serpapi_locations(q, limit=limit * 3 if lists else limit)
        # Trim to fields we use to keep the wire small.
        trimmed = one_per_place([
            {
                "canonical_name": r.get("canonical_name"),
                "name": r.get("name"),
                "country_code": r.get("country_code"),
                "target_type": r.get("target_type"),
                "reach": r.get("reach"),
                "google_id": r.get("google_id"),
            }
            for r in rows
            if r.get("canonical_name")
        ])
        for name in lists:
            known = codes_present(name, [r["google_id"] for r in trimmed if r["google_id"]])
            trimmed = [r for r in trimmed if r["google_id"] in known]
    trimmed = trimmed[:limit]
    _locations_cache[key] = (now, trimmed)
    return trimmed


def _resolve_all(db: Session, ref: dict, lists: list[str]) -> dict:
    """The location's entry in each list (None where it has none)."""
    return {name: resolve(db, name, ref) for name in lists}


@router.post("/locations/check")
def check_locations(payload: LocationCheckIn, db: Session = Depends(get_db)):
    """For locations ALREADY on a job: which of the job's providers cannot
    search each one, and the entry each provider will be sent. The form asks
    this when the provider changes, so a location picked for SerpAPI is
    flagged before the run rather than failing — or quietly going
    country-wide — in it."""
    wanted = [p.lower() for p in payload.providers]
    lists = _ready_lists(wanted)
    out = []
    for ref in payload.locations:
        item: dict = {"canonical_name": ref.canonical_name, "unsupported_by": [], "resolved": {}}
        found = _resolve_all(db, ref.model_dump(), lists)
        for provider in wanted:
            name = LIST_OF.get(provider)
            if name not in found:
                continue
            if found[name] is None:
                item["unsupported_by"].append(provider)
            else:
                item["resolved"][provider] = {"code": found[name].code, "name": found[name].name}
        out.append(item)
    return out


# --- Saved (manual) locations -----------------------------------------------

@router.get("/saved-locations", response_model=list[SavedLocationOut])
def list_saved_locations(
    q: str | None = Query(None),
    providers: str | None = Query(None, description="Comma-separated; only locations ALL of them can search"),
    db: Session = Depends(get_db),
):
    """Saved locations. With `providers` (the job form passes the job's), only
    those every one of them can search; Settings asks without it and gets all.

    A saved location is matched to a provider's list the way a run matches it,
    so "Almaty,Almaty Province,Kazakhstan" stays listed (it is "Almaty,Almaty
    Region,Kazakhstan" in the current lists) and comes back with that entry's ID."""
    query = db.query(SavedLocation)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(
            SavedLocation.canonical_name.ilike(like),
            SavedLocation.name.ilike(like),
            SavedLocation.country_code.ilike(like),
        ))
    rows = query.order_by(SavedLocation.canonical_name).all()
    lists = _ready_lists(_providers(providers))
    if not lists:
        return rows
    out = []
    for row in rows:
        found = _resolve_all(db, {
            "canonical_name": row.canonical_name, "country_code": row.country_code,
            "target_type": row.target_type, "google_id": row.google_id,
        }, lists)
        if all(found.values()):
            out.append(SavedLocationOut.model_validate(row).model_copy(
                update={"google_id": next(iter(found.values())).code}))
    return out


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
                    # The ID belonged to the OLD name. A rename can point the
                    # entry at a different place, and a stale ID would send
                    # DataForSEO to the old one; without it the run matches
                    # the new name afresh.
                    "google_id": entry.get("google_id") if new_canonical == old_canonical else None,
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
    if loc.canonical_name != old_canonical:
        # The stored Google ID was the OLD name's place; the next listing asks
        # for the new name's.
        loc.google_id = None

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
