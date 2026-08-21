"""Runtime-mutable settings stored in the DB. Used for things the user should
be able to change from the UI (e.g. provider credentials) without a restart.

DB value wins; env value is used as a fallback for SerpAPI only (it's the
historical default; Bright Data and Oxylabs have no env-var fallback)."""
from __future__ import annotations

import json

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


# --- Ahrefs (analyzer mode) ---------------------------------------------------
#
# Not a SERP provider and not an LLM — Ahrefs supplies the link metrics the
# analyzer job mode scores SERPs with. Kept in its own namespace so it never
# appears in the job form's Provider dropdown.
KEY_AHREFS_API_KEY = "ahrefs_api_key"


def get_ahrefs_api_key() -> str:
    db = SessionLocal()
    try:
        return _get(db, KEY_AHREFS_API_KEY) or ""
    finally:
        db.close()


def set_ahrefs_api_key(value: str | None) -> None:
    db = SessionLocal()
    try:
        _set(db, KEY_AHREFS_API_KEY, (value or "").strip() or None)
    finally:
        db.close()


def ahrefs_status() -> dict:
    v = get_ahrefs_api_key()
    return {
        "configured": bool(v),
        "last4": v[-4:] if v else "",
        "length": len(v),
    }


# --- AI (LLM) provider settings ----------------------------------------------
#
# Kept in a separate namespace from the SERP providers above: these configure
# Gemini access, not search scraping, and must never appear in the job form's
# Provider dropdown. Keys are prefixed `ai_` in the same AppSetting table.
AI_PROVIDER_FIELDS: dict[str, list[str]] = {
    "ai_studio": ["api_key", "model"],
    # Vertex takes EITHER service_account_json (+ project_id, location) for the
    # production path, OR api_key alone for Vertex Express.
    "vertex": ["api_key", "service_account_json", "project_id", "location", "model"],
}

# Fields masked in status responses. `service_account_json` contains a private
# key, so it is never echoed back — not even partially.
_AI_SECRET_FIELDS = frozenset({"api_key", "service_account_json"})


def _ai_key(provider: str, field: str) -> str:
    return f"ai_{provider}_{field}"


def get_ai_provider_config(provider: str) -> dict[str, str]:
    """Raw config for one AI provider. DB-only — no env fallback."""
    fields = AI_PROVIDER_FIELDS.get(provider, [])
    out: dict[str, str] = {}
    db = SessionLocal()
    try:
        for f in fields:
            val = _get(db, _ai_key(provider, f))
            if val:
                out[f] = val
    finally:
        db.close()
    return out


def set_ai_provider_config(provider: str, values: dict[str, str | None]) -> None:
    fields = AI_PROVIDER_FIELDS.get(provider)
    if not fields:
        raise ValueError(f"unknown AI provider: {provider}")
    db = SessionLocal()
    try:
        for f in fields:
            if f in values:
                v = values[f]
                _set(
                    db,
                    _ai_key(provider, f),
                    v.strip() if isinstance(v, str) and v.strip() else None,
                )
    finally:
        db.close()


def clear_ai_provider_config(provider: str) -> None:
    set_ai_provider_config(provider, {f: None for f in AI_PROVIDER_FIELDS.get(provider, [])})


def ai_provider_status(provider: str) -> dict:
    """Masked status — never echo a secret back to the UI."""
    fields = AI_PROVIDER_FIELDS.get(provider, [])
    cfg = get_ai_provider_config(provider)
    masked: dict[str, dict] = {}
    for f in fields:
        v = cfg.get(f, "")
        if not v:
            masked[f] = {"configured": False}
        elif f == "service_account_json":
            # Show the identity, never the key material — it's the one thing
            # that makes a pasted blob verifiable at a glance.
            masked[f] = {"configured": True, "value": _sa_identity(v), "length": len(v)}
        elif f in _AI_SECRET_FIELDS:
            masked[f] = {"configured": True, "last4": v[-4:], "length": len(v)}
        else:
            masked[f] = {"configured": True, "value": v}
    # Which auth mode Vertex will actually use, so the UI can say so plainly
    # rather than making the user infer it from which fields are filled.
    auth_mode = None
    if provider == "vertex":
        if cfg.get("service_account_json"):
            auth_mode = "service_account"
        elif cfg.get("api_key"):
            auth_mode = "express"
    return {"provider": provider, "fields": masked, "auth_mode": auth_mode}


KEY_AI_ANALYSIS_PROVIDER = "ai_analysis_provider"


def get_ai_analysis_provider() -> str | None:
    """Which AI provider scores SERP difficulty, or None to skip AI entirely.

    An explicit choice wins. With no choice saved we auto-pick the single
    configured provider — the common case is exactly one — but stay None when
    zero or both are configured, so we never silently spend on a provider the
    user didn't nominate.
    """
    db = SessionLocal()
    try:
        chosen = _get(db, KEY_AI_ANALYSIS_PROVIDER)
    finally:
        db.close()
    if chosen in AI_PROVIDER_FIELDS:
        return chosen
    if chosen == "off":
        return None
    configured = [
        p for p in AI_PROVIDER_FIELDS
        if any(get_ai_provider_config(p).get(f) for f in ("api_key", "service_account_json"))
    ]
    return configured[0] if len(configured) == 1 else None


def set_ai_analysis_provider(value: str | None) -> None:
    """Persist the choice. "off" disables AI scoring; None restores auto-pick."""
    if value not in (None, "", "off", *AI_PROVIDER_FIELDS):
        raise ValueError(f"unknown AI provider: {value}")
    db = SessionLocal()
    try:
        _set(db, KEY_AI_ANALYSIS_PROVIDER, value or None)
    finally:
        db.close()


def _sa_identity(sa_json: str) -> str:
    """client_email out of a service-account JSON, for display only."""
    try:
        import json as _json
        info = _json.loads(sa_json)
        return info.get("client_email") or "(no client_email)"
    except Exception:  # noqa: BLE001 — display helper must never raise
        return "(unparseable JSON)"


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

# ---------------------------------------------------------------------------
# Opportunity formula
#
# The score that ranks a run's keywords is a judgement call dressed as
# arithmetic, so its constants are configuration rather than code. A brand-
# protection sweep and a content-gap audit disagree about how much a "too hard"
# verdict should count, and neither answer belongs hardcoded.
#
# Stored as one JSON blob rather than a row per field: the fields are only ever
# read and written together, and a half-applied formula would silently score a
# run against a mixture of old and new constants.
# ---------------------------------------------------------------------------
KEY_OPPORTUNITY = "opportunity_formula"

DEFAULT_OPPORTUNITY_FORMULA: dict[str, float | str | int] = {
    # Slider default: 0 favours winnability, 1 favours volume.
    "balance": 0.5,
    # Neither factor's exponent may reach zero, so a hopeless keyword can never
    # top the shortlist however the slider is set.
    "min_weight": 0.2,
    # Entry-bar DR at which a SERP counts as closed.
    "bar_dr_ceiling": 60.0,
    # Floor of the soft-slot modulator: it nudges, it never vetoes.
    "soft_floor": 0.5,
    # How raw volume is compressed before comparison: sqrt | linear | log.
    "volume_curve": "sqrt",
    # What each AI verdict multiplies winnability by.
    "ai_low": 1.0,
    "ai_medium": 0.7,
    "ai_hard": 0.35,
    "ai_too_hard": 0.1,
    # Used when the AI never returned a verdict: neither trusted nor written off.
    "ai_unknown": 0.5,
    # How many top-ranked keywords are highlighted as the shortlist.
    "shortlist": 5,
}

# (minimum, maximum) per numeric field. Bounds are not cosmetic: min_weight at
# 0.5 would make both exponents equal regardless of the slider, and a
# bar_dr_ceiling of 0 divides by zero.
_OPPORTUNITY_BOUNDS: dict[str, tuple[float, float]] = {
    "balance": (0.0, 1.0),
    "min_weight": (0.0, 0.45),
    "bar_dr_ceiling": (1.0, 100.0),
    "soft_floor": (0.0, 1.0),
    "ai_low": (0.0, 1.0),
    "ai_medium": (0.0, 1.0),
    "ai_hard": (0.0, 1.0),
    "ai_too_hard": (0.0, 1.0),
    "ai_unknown": (0.0, 1.0),
    "shortlist": (1, 50),
}

_VOLUME_CURVES = ("sqrt", "linear", "log")


def coerce_opportunity_formula(raw: dict | None) -> dict:
    """Merge a partial formula over the defaults, dropping anything invalid.

    Tolerant on purpose: this parses both user input and JSON that has been
    sitting in the database since before a field existed. A single unknown or
    out-of-range value must not cost the caller a working formula, so bad
    fields fall back to their default instead of raising.
    """
    out = dict(DEFAULT_OPPORTUNITY_FORMULA)
    if not isinstance(raw, dict):
        return out
    for key, default in DEFAULT_OPPORTUNITY_FORMULA.items():
        if key not in raw or raw[key] is None:
            continue
        value = raw[key]
        if key == "volume_curve":
            if isinstance(value, str) and value in _VOLUME_CURVES:
                out[key] = value
            continue
        lo, hi = _OPPORTUNITY_BOUNDS[key]
        try:
            num = float(value)
        except (TypeError, ValueError):
            continue
        if num != num or num < lo or num > hi:  # NaN fails every comparison
            continue
        out[key] = int(num) if isinstance(default, int) and not isinstance(default, bool) else num
    return out


def get_opportunity_formula() -> dict:
    """The global formula: stored overrides merged over the built-in defaults."""
    db = SessionLocal()
    try:
        raw = _get(db, KEY_OPPORTUNITY)
    finally:
        db.close()
    if not raw:
        return dict(DEFAULT_OPPORTUNITY_FORMULA)
    try:
        return coerce_opportunity_formula(json.loads(raw))
    except (TypeError, ValueError):
        # A corrupted blob must not break every analysis view.
        return dict(DEFAULT_OPPORTUNITY_FORMULA)


def set_opportunity_formula(values: dict | None) -> dict:
    """Persist the global formula. None resets it to the built-in defaults."""
    db = SessionLocal()
    try:
        if values is None:
            _set(db, KEY_OPPORTUNITY, None)
            return dict(DEFAULT_OPPORTUNITY_FORMULA)
        merged = coerce_opportunity_formula(values)
        _set(db, KEY_OPPORTUNITY, json.dumps(merged))
        return merged
    finally:
        db.close()
