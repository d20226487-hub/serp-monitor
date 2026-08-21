"""Keyword search volumes — the demand half of the opportunity score.

Entered by hand today. The store is deliberately shaped like the answer an
Ahrefs or DataForSEO keywords endpoint would give, so filling it automatically
later is a new writer against the same table rather than a migration.

Volumes are keyed on (keyword, country) because the same brand term is worth
very different traffic in Kazakhstan and Uzbekistan, and a job may target
either. A row with country_code NULL applies anywhere and is the fallback when
no country-specific figure exists.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import KeywordVolume

router = APIRouter(prefix="/keyword-volumes", tags=["keyword-volumes"])


def _norm_country(cc: str | None) -> str | None:
    """Empty string and NULL both mean "any country" — collapse them to NULL so
    the unique constraint cannot end up holding both for one keyword."""
    c = (cc or "").strip().lower()
    return c or None


def _norm_keyword(kw: str) -> str:
    return (kw or "").strip()


class KeywordVolumeIn(BaseModel):
    keyword: str = Field(min_length=1, max_length=500)
    country_code: str | None = None
    # 0 is meaningful — "checked, and nobody searches this" — so it is allowed
    # and is not the same as having no row at all.
    volume: int = Field(ge=0)
    source: str = "manual"


class KeywordVolumeOut(BaseModel):
    keyword: str
    country_code: str | None
    volume: int
    source: str


@router.get("", response_model=list[KeywordVolumeOut])
def list_volumes(
    keywords: str | None = Query(None, description="Comma-separated keywords to filter by"),
    country: str | None = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(KeywordVolume)
    if keywords:
        wanted = [_norm_keyword(k) for k in keywords.split(",") if _norm_keyword(k)]
        if wanted:
            q = q.filter(KeywordVolume.keyword.in_(wanted))
    if country is not None:
        q = q.filter(KeywordVolume.country_code == _norm_country(country))
    return [
        KeywordVolumeOut(
            keyword=r.keyword, country_code=r.country_code,
            volume=r.volume, source=r.source,
        )
        for r in q.order_by(KeywordVolume.keyword).all()
    ]


@router.put("", response_model=list[KeywordVolumeOut])
def upsert_volumes(items: list[KeywordVolumeIn], db: Session = Depends(get_db)):
    """Insert or update a batch. Batched because the UI edits a table, and a
    per-row round trip would make pasting ten keywords ten requests."""
    if not items:
        return []
    out: list[KeywordVolumeOut] = []
    for item in items:
        kw = _norm_keyword(item.keyword)
        if not kw:
            raise HTTPException(422, "keyword cannot be blank")
        cc = _norm_country(item.country_code)
        row = (
            db.query(KeywordVolume)
            .filter(KeywordVolume.keyword == kw, KeywordVolume.country_code == cc)
            .one_or_none()
        )
        if row is None:
            row = KeywordVolume(keyword=kw, country_code=cc)
            db.add(row)
        row.volume = item.volume
        row.source = item.source or "manual"
        out.append(KeywordVolumeOut(
            keyword=kw, country_code=cc, volume=item.volume, source=row.source,
        ))
    db.commit()
    return out


@router.delete("")
def delete_volume(
    keyword: str = Query(...),
    country: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Remove a figure entirely. Distinct from setting it to 0: no row means
    "unknown", and the opportunity score leaves those keywords unranked rather
    than treating them as zero-demand."""
    row = (
        db.query(KeywordVolume)
        .filter(
            KeywordVolume.keyword == _norm_keyword(keyword),
            KeywordVolume.country_code == _norm_country(country),
        )
        .one_or_none()
    )
    if row is None:
        raise HTTPException(404)
    db.delete(row)
    db.commit()
    return {"ok": True}
