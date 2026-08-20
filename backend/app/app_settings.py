"""Runtime-mutable settings stored in the DB. Used for things the user should
be able to change from the UI (e.g. provider credentials) without a restart.

DB value wins; env value is used as a fallback for SerpAPI only (it's the
historical default; Bright Data and Oxylabs have no env-var fallback)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from .config import settings
from .db import SessionLocal
from .models import AppSetting

KEY_SERPAPI = "serpapi_key"
KEY_BRIGHTDATA_TOKEN = "brightdata_token"
KEY_BRIGHTDATA_ZONE = "brightdata_zone"
KEY_BRIGHTDATA_ZONE_RAW = "brightdata_zone_raw"
KEY_OXYLABS_USERNAME = "oxylabs_username"
KEY_OXYLABS_PASSWORD = "oxylabs_password"
KEY_DATAFORSEO_LOGIN = "dataforseo_login"
KEY_DATAFORSEO_PASSWORD = "dataforseo_password"


def _get(db: Session, key: str) -> str | None:
    row = db.get(AppSetting, key)
    return row.value if row else None


def _set(db: Session, key: str, value: str | None) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        row = AppSetting(key=key, value=value)
        db.add(row)
    else:
        row.value = value
    db.commit()


# --- SerpAPI (env fallback supported for backwards compat) -------------------

def get_serpapi_key() -> str:
    db = SessionLocal()
    try:
        v = _get(db, KEY_SERPAPI)
    finally:
        db.close()
    return v or settings.serpapi_key or ""


def set_serpapi_key(value: str | None) -> None:
    db = SessionLocal()
    try:
        _set(db, KEY_SERPAPI, value or None)
    finally:
        db.close()


def serpapi_key_status() -> dict:
    db = SessionLocal()
    try:
        db_val = _get(db, KEY_SERPAPI)
    finally:
        db.close()
    env_val = settings.serpapi_key or ""
    effective = db_val or env_val or ""
    return {
        "source": "db" if db_val else ("env" if env_val else "none"),
        "configured": bool(effective),
        "last4": effective[-4:] if effective else "",
        "length": len(effective),
    }


# --- Generic provider credentials -------------------------------------------

PROVIDER_FIELDS: dict[str, list[str]] = {
    "serpapi": ["api_key"],
    # `zone` = Full-JSON SERP zone (used for Google).
    # `zone_raw` = optional second zone configured as Raw HTML (used for Yandex,
    # which Bright Data won't parse to JSON on most plans).
    "brightdata": ["token", "zone", "zone_raw"],
    "oxylabs": ["username", "password"],
    # DataForSEO uses HTTP Basic auth. The API password is auto-generated in
    # their dashboard and differs from the account password.
    "dataforseo": ["login", "password"],
}

_FIELD_TO_KEY: dict[tuple[str, str], str] = {
    ("serpapi", "api_key"): KEY_SERPAPI,
    ("brightdata", "token"): KEY_BRIGHTDATA_TOKEN,
    ("brightdata", "zone"): KEY_BRIGHTDATA_ZONE,
    ("brightdata", "zone_raw"): KEY_BRIGHTDATA_ZONE_RAW,
    ("oxylabs", "username"): KEY_OXYLABS_USERNAME,
    ("oxylabs", "password"): KEY_OXYLABS_PASSWORD,
    ("dataforseo", "login"): KEY_DATAFORSEO_LOGIN,
    ("dataforseo", "password"): KEY_DATAFORSEO_PASSWORD,
}


def get_provider_creds(provider: str) -> dict[str, str]:
    """Return the raw credentials for a provider. SerpAPI's api_key falls
    back to env; everything else is DB-only."""
    fields = PROVIDER_FIELDS.get(provider, [])
    out: dict[str, str] = {}
    db = SessionLocal()
    try:
        for f in fields:
            key = _FIELD_TO_KEY[(provider, f)]
            val = _get(db, key)
            if not val and provider == "serpapi" and f == "api_key":
                val = settings.serpapi_key
            if val:
                out[f] = val
    finally:
        db.close()
    return out


def set_provider_creds(provider: str, values: dict[str, str | None]) -> None:
    fields = PROVIDER_FIELDS.get(provider)
    if not fields:
        raise ValueError(f"unknown provider: {provider}")
    db = SessionLocal()
    try:
        for f in fields:
            if f in values:
                key = _FIELD_TO_KEY[(provider, f)]
                v = values[f]
                _set(db, key, v.strip() if isinstance(v, str) and v.strip() else None)
    finally:
        db.close()


def clear_provider_creds(provider: str) -> None:
    set_provider_creds(provider, {f: None for f in PROVIDER_FIELDS.get(provider, [])})


def provider_status(provider: str) -> dict:
    """Masked status — never echo full secrets back to the UI."""
    fields = PROVIDER_FIELDS.get(provider, [])
    creds = get_provider_creds(provider)
    masked = {}
    for f in fields:
        v = creds.get(f, "")
        if not v:
            masked[f] = {"configured": False}
        elif f in ("api_key", "token", "password"):
            masked[f] = {"configured": True, "last4": v[-4:], "length": len(v)}
        else:
            # Non-secret fields (zone, username) — show in full.
            masked[f] = {"configured": True, "value": v}
    return {"provider": provider, "fields": masked}
