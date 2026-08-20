"""Runtime settings (UI-mutable). Provider credentials + scheduler info."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..ai import AIProviderConfigError, AIProviderError, get_ai_provider
from ..app_settings import (
    AI_PROVIDER_FIELDS,
    DEFAULT_RATES,
    PROVIDER_FIELDS,
    ai_provider_status,
    clear_ai_provider_config,
    clear_provider_creds,
    get_provider_creds,
    get_provider_rates,
    provider_status,
    serpapi_key_status,
    set_ai_provider_config,
    set_provider_creds,
    set_provider_rates,
    set_serpapi_key,
)
from ..providers import ProviderConfigError, ProviderError, get_provider
from ..scheduler import scheduler_timezone

router = APIRouter(prefix="/settings", tags=["settings"])


# --- Legacy single-key endpoints (still used by the older API-key card) ------

class ApiKeyIn(BaseModel):
    api_key: str


@router.get("/api-key")
def get_api_key_status():
    return serpapi_key_status()


@router.put("/api-key")
def update_api_key(payload: ApiKeyIn):
    if not payload.api_key.strip():
        raise HTTPException(400, "api_key cannot be empty (use DELETE to clear)")
    set_serpapi_key(payload.api_key.strip())
    return serpapi_key_status()


@router.delete("/api-key")
def clear_api_key():
    set_serpapi_key(None)
    return serpapi_key_status()


# --- Generic provider credentials -------------------------------------------

class ProviderCredsIn(BaseModel):
    # Permissive — only the fields valid for the chosen provider are stored.
    api_key: str | None = None
    token: str | None = None
    zone: str | None = None
    zone_raw: str | None = None
    username: str | None = None
    password: str | None = None
    login: str | None = None  # DataForSEO


@router.get("/providers")
def list_providers():
    """Status for all known providers."""
    return [provider_status(p) for p in PROVIDER_FIELDS.keys()]


@router.get("/providers/{provider}")
def get_provider_status(provider: str):
    if provider not in PROVIDER_FIELDS:
        raise HTTPException(404, "unknown provider")
    return provider_status(provider)


@router.put("/providers/{provider}")
def update_provider_creds(provider: str, payload: ProviderCredsIn):
    if provider not in PROVIDER_FIELDS:
        raise HTTPException(404, "unknown provider")
    raw = payload.model_dump(exclude_unset=True)
    valid = {k: v for k, v in raw.items() if k in PROVIDER_FIELDS[provider]}
    if not valid:
        raise HTTPException(
            400, f"no valid fields for {provider}; expected one of {PROVIDER_FIELDS[provider]}"
        )
    set_provider_creds(provider, valid)
    return provider_status(provider)


@router.delete("/providers/{provider}")
def clear_provider(provider: str):
    if provider not in PROVIDER_FIELDS:
        raise HTTPException(404, "unknown provider")
    clear_provider_creds(provider)
    return provider_status(provider)


@router.post("/providers/{provider}/test")
async def test_provider(provider: str):
    """Validate creds against the upstream. Bright Data and Oxylabs cost ~1
    search credit; SerpAPI's and DataForSEO's account endpoints are free."""
    if provider not in PROVIDER_FIELDS:
        raise HTTPException(404, "unknown provider")
    try:
        async with get_provider(provider) as p:
            return await p.test_credentials()
    except ProviderConfigError as e:
        raise HTTPException(401, str(e))
    except ProviderError as e:
        raise HTTPException(502, str(e))


# --- AI providers (Gemini via AI Studio / Vertex) ------------------------------

class AIProviderConfigIn(BaseModel):
    # Permissive; only fields valid for the chosen provider are stored.
    api_key: str | None = None
    service_account_json: str | None = None
    project_id: str | None = None
    location: str | None = None
    model: str | None = None


@router.get("/ai-providers")
def list_ai_providers():
    return [ai_provider_status(p) for p in AI_PROVIDER_FIELDS.keys()]


@router.put("/ai-providers/{provider}")
def update_ai_provider(provider: str, payload: AIProviderConfigIn):
    if provider not in AI_PROVIDER_FIELDS:
        raise HTTPException(404, "unknown AI provider")
    raw = payload.model_dump(exclude_unset=True)
    valid = {k: v for k, v in raw.items() if k in AI_PROVIDER_FIELDS[provider]}
    if not valid:
        raise HTTPException(
            400,
            f"no valid fields for {provider}; expected one of {AI_PROVIDER_FIELDS[provider]}",
        )
    set_ai_provider_config(provider, valid)
    return ai_provider_status(provider)


@router.delete("/ai-providers/{provider}")
def clear_ai_provider(provider: str):
    if provider not in AI_PROVIDER_FIELDS:
        raise HTTPException(404, "unknown AI provider")
    clear_ai_provider_config(provider)
    return ai_provider_status(provider)


@router.post("/ai-providers/{provider}/test")
async def test_ai_provider(provider: str):
    """Verify credentials with a tiny real generation.

    Neither Google API exposes a free account/balance probe, so unlike the SERP
    providers this genuinely calls the model — a few tokens' worth.
    """
    if provider not in AI_PROVIDER_FIELDS:
        raise HTTPException(404, "unknown AI provider")
    try:
        return await get_ai_provider(provider).test_credentials()
    except AIProviderConfigError as e:
        raise HTTPException(401, str(e))
    except AIProviderError as e:
        raise HTTPException(502, str(e))


# --- Cost rates ---------------------------------------------------------------

class RatesIn(BaseModel):
    # Per-provider USD/search. Omit a provider to leave it unchanged; send null
    # or "" to reset it back to the built-in default.
    rates: dict[str, float | str | None]


@router.get("/rates")
def get_rates():
    """Effective $/search per provider, plus the built-in defaults so the UI can
    show what a field would fall back to."""
    return {"rates": get_provider_rates(), "defaults": DEFAULT_RATES}


@router.put("/rates")
def update_rates(payload: RatesIn):
    unknown = [p for p in payload.rates if p not in DEFAULT_RATES]
    if unknown:
        raise HTTPException(400, f"unknown provider(s): {', '.join(unknown)}")
    try:
        set_provider_rates(payload.rates)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"rates": get_provider_rates(), "defaults": DEFAULT_RATES}


# --- Scheduler ---------------------------------------------------------------

@router.get("/scheduler")
def scheduler_status():
    return {"timezone": scheduler_timezone()}
