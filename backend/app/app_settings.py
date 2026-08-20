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


# --- Per-provider cost rates (USD per search) --------------------------------
#
# Rates are plan-specific — SerpAPI's per-search price in particular swings a
# lot by tier — so these are user-editable in Settings. The defaults below are
# reasonable list prices, NOT a promise about the user's actual bill.
_RATE_KEY_PREFIX = "rate_"

DEFAULT_RATES: dict[str, float] = {
    "serpapi": 0.010,      # ~$50 / 5,000 searches on common tiers
    "brightdata": 0.0015,  # SERP API list price ~$1.50 / 1,000
    "oxylabs": 0.002,      # ~$2 / 1,000 on entry tiers
    "dataforseo": 0.002,   # Live mode list price
}


def get_provider_rates() -> dict[str, float]:
    """Effective $/search per provider: DB override if set, else the default."""
    db = SessionLocal()
    try:
        out: dict[str, float] = {}
        for provider, default in DEFAULT_RATES.items():
            raw = _get(db, f"{_RATE_KEY_PREFIX}{provider}")
            try:
                # Guard against a malformed stored value silently zeroing costs.
                out[provider] = float(raw) if raw is not None else default
            except (TypeError, ValueError):
                out[provider] = default
        return out
    finally:
        db.close()


def get_provider_rate(provider: str) -> float:
    return get_provider_rates().get(provider, 0.0)


def set_provider_rates(values: dict[str, float | str | None]) -> None:
    """Persist rate overrides. Passing None/"" for a provider resets it to the
    built-in default (we delete the row rather than storing 0)."""
    db = SessionLocal()
    try:
        for provider, v in values.items():
            if provider not in DEFAULT_RATES:
                continue
            key = f"{_RATE_KEY_PREFIX}{provider}"
            if v is None or (isinstance(v, str) and not v.strip()):
                _set(db, key, None)
                continue
            rate = float(v)
            if rate < 0:
                raise ValueError(f"rate for {provider} must be >= 0")
            _set(db, key, str(rate))
    finally:
        db.close()


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
