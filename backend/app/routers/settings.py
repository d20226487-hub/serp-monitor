"""Runtime settings (UI-mutable). Provider credentials + scheduler info."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AhrefsMetricCache

from ..ai import AIProviderConfigError, AIProviderError, get_ai_provider
from ..ai.prompts import (
    serp_difficulty_prompt_status,
    set_domain_prompt,
    set_serp_difficulty_prompt,
)
from ..app_settings import (
    AI_PROVIDER_FIELDS,
    DEFAULT_OPPORTUNITY_FORMULA,
    DEFAULT_VISIBILITY_WEIGHTS,
    DEFAULT_RATES,
    PROVIDER_FIELDS,
    ahrefs_status,
    ai_provider_status,
    clear_ai_provider_config,
    clear_provider_creds,
    DEFAULT_AHREFS_CACHE_TTL_DAYS,
    DEFAULT_AI_MAX_OUTPUT_TOKENS,
    DEFAULT_AI_TEMPERATURE,
    DEFAULT_AI_THINKING_BUDGET,
    MAX_AI_TEMPERATURE,
    MAX_AI_THINKING_BUDGET,
    MAX_AHREFS_CACHE_TTL_DAYS,
    get_ahrefs_api_key,
    get_ahrefs_cache_ttl_days,
    get_ai_analysis_provider,
    get_ai_max_output_tokens,
    get_ai_temperature,
    get_ai_thinking_budget,
    get_opportunity_formula,
    get_visibility_weights,
    get_provider_creds,
    get_provider_rates,
    provider_status,
    serpapi_key_status,
    set_ahrefs_api_key,
    set_ai_analysis_provider,
    set_ai_provider_config,
    set_provider_creds,
    set_ahrefs_cache_ttl_days,
    set_ai_max_output_tokens,
    set_ai_temperature,
    set_ai_thinking_budget,
    set_opportunity_formula,
    set_visibility_weights,
    set_provider_rates,
    set_serpapi_key,
)
from ..providers import ProviderConfigError, ProviderError, get_provider
from ..providers.ahrefs_batch import (
    BASE_REQUEST_UNITS,
    BATCH_METRICS,
    BATCH_SIZE,
    DEFAULT_DOMAIN_METRICS,
    DEFAULT_METRICS,
    FIELD_UNIT_COST,
    URL_ONLY_METRICS,
    verify_api_key,
)
from ..scheduler import scheduler_timezone
from ..visibility import cumulative

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


# --- AI SERP-difficulty prompt + provider choice -------------------------------

class PromptIn(BaseModel):
    # None / "" resets to the built-in default rather than storing an empty
    # prompt — matching the "never destructive" rule for user-tuned prompts.
    prompt: str | None = None


class AIAnalysisProviderIn(BaseModel):
    provider: str | None = None  # "ai_studio" | "vertex" | "off" | null = auto


@router.get("/ai-analysis")
def get_ai_analysis_settings():
    return {
        **serp_difficulty_prompt_status(),
        "provider": get_ai_analysis_provider(),
        "available": list(AI_PROVIDER_FIELDS.keys()),
        "temperature": get_ai_temperature(),
        "temperature_default": DEFAULT_AI_TEMPERATURE,
        "temperature_max": MAX_AI_TEMPERATURE,
        "thinking_budget": get_ai_thinking_budget(),
        "thinking_budget_default": DEFAULT_AI_THINKING_BUDGET,
        "thinking_budget_max": MAX_AI_THINKING_BUDGET,
        "max_output_tokens": get_ai_max_output_tokens(),
        "max_output_tokens_default": DEFAULT_AI_MAX_OUTPUT_TOKENS,
    }


@router.put("/ai-analysis/prompt")
def update_prompt(payload: PromptIn):
    set_serp_difficulty_prompt(payload.prompt)
    return serp_difficulty_prompt_status()


@router.put("/ai-analysis/domain-prompt")
def update_domain_prompt(payload: PromptIn):
    """Guidance shown above the domain-level table. Empty resets to default."""
    set_domain_prompt(payload.prompt)
    return serp_difficulty_prompt_status()


class AITuningIn(BaseModel):
    temperature: float | None = None
    thinking_budget: int | None = None
    max_output_tokens: int | None = None


@router.put("/ai-analysis/tuning")
def update_ai_tuning(payload: AITuningIn):
    """Sampling and reasoning parameters for the difficulty judge.

    A field left null resets that parameter to its default rather than being
    ignored, so the form can clear one without touching the others.
    """
    return {
        "temperature": set_ai_temperature(payload.temperature),
        "thinking_budget": set_ai_thinking_budget(payload.thinking_budget),
        "max_output_tokens": set_ai_max_output_tokens(payload.max_output_tokens),
    }


@router.put("/ai-analysis/provider")
def update_ai_analysis_provider(payload: AIAnalysisProviderIn):
    try:
        set_ai_analysis_provider(payload.provider)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"provider": get_ai_analysis_provider()}


# --- Ahrefs (analyzer mode) ----------------------------------------------------

class AhrefsKeyIn(BaseModel):
    api_key: str


@router.get("/ahrefs")
def get_ahrefs():
    """Key status plus the metric catalogue, so the job form can render the
    picker without hardcoding Ahrefs field ids in the frontend."""
    return {
        **ahrefs_status(),
        "metrics": [
            {"id": k, "label": v, "units": FIELD_UNIT_COST.get(k, 1)}
            for k, v in BATCH_METRICS.items()
        ],
        "default_metrics": DEFAULT_METRICS,
        "default_domain_metrics": DEFAULT_DOMAIN_METRICS,
        "url_only_metrics": sorted(URL_ONLY_METRICS),
        "batch_size": BATCH_SIZE,
        "base_request_units": BASE_REQUEST_UNITS,
        "cache_ttl_days": get_ahrefs_cache_ttl_days(),
        "cache_ttl_default": DEFAULT_AHREFS_CACHE_TTL_DAYS,
        "cache_ttl_max": MAX_AHREFS_CACHE_TTL_DAYS,
    }


class AhrefsCacheTtlIn(BaseModel):
    days: int | None = None


@router.put("/ahrefs/cache-ttl")
def update_ahrefs_cache_ttl(payload: AhrefsCacheTtlIn):
    """How long a fetched Ahrefs metric may be reused across runs.
    0 turns the cross-run cache off; null resets to the default."""
    return {"cache_ttl_days": set_ahrefs_cache_ttl_days(payload.days)}


@router.delete("/ahrefs/cache")
def clear_ahrefs_cache(db: Session = Depends(get_db)):
    """Drop every cached metric, forcing the next run to re-measure."""
    n = db.query(AhrefsMetricCache).delete()
    db.commit()
    return {"cleared": n}


@router.put("/ahrefs")
def update_ahrefs(payload: AhrefsKeyIn):
    if not payload.api_key.strip():
        raise HTTPException(400, "api_key cannot be empty (use DELETE to clear)")
    set_ahrefs_api_key(payload.api_key.strip())
    return ahrefs_status()


@router.delete("/ahrefs")
def clear_ahrefs():
    set_ahrefs_api_key(None)
    return ahrefs_status()


@router.post("/ahrefs/test")
async def test_ahrefs():
    """Verify the Ahrefs key. Costs ~1 unit — Ahrefs has no free auth probe."""
    key = get_ahrefs_api_key()
    if not key:
        raise HTTPException(401, "Ahrefs API key is not configured")
    try:
        return await verify_api_key(key)
    except Exception as e:  # noqa: BLE001
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

# --- Opportunity formula -------------------------------------------------------

@router.get("/opportunity")
def get_opportunity():
    """The global formula, alongside the built-in defaults.

    Defaults ship with the response so the UI can show what each field would
    revert to without duplicating the numbers in the frontend — one definition,
    on the server.
    """
    return {
        "formula": get_opportunity_formula(),
        "defaults": dict(DEFAULT_OPPORTUNITY_FORMULA),
    }


@router.put("/opportunity")
def update_opportunity(payload: dict):
    """Save the global formula. Unknown or out-of-range fields fall back to
    their default rather than 400-ing the whole save — see
    coerce_opportunity_formula."""
    saved = set_opportunity_formula(payload or {})
    return {"formula": saved, "defaults": dict(DEFAULT_OPPORTUNITY_FORMULA)}


@router.delete("/opportunity")
def reset_opportunity():
    """Drop the global override, reverting to the built-in defaults."""
    saved = set_opportunity_formula(None)
    return {"formula": saved, "defaults": dict(DEFAULT_OPPORTUNITY_FORMULA)}


# --- Visibility weights --------------------------------------------------------

def _visibility_payload(weights: list[float]) -> dict:
    """The curve, its running totals, and what it would revert to.

    The running totals ship with it because they are what a reader checks the
    curve against — "positions 1-3 hold 80% of the page" — and computing them
    on the server keeps one definition of the arithmetic rather than a second
    copy in the UI that can drift.
    """
    return {
        "weights": weights,
        "cumulative": cumulative(weights),
        "defaults": list(DEFAULT_VISIBILITY_WEIGHTS),
    }


@router.get("/visibility")
def get_visibility():
    return _visibility_payload(get_visibility_weights())


@router.put("/visibility")
def update_visibility(payload: dict):
    """Save the global curve. A list that cannot be read as weights falls back
    to the defaults whole rather than being repaired entry by entry — position
    is carried by order, so a partial repair changes what every weight means."""
    return _visibility_payload(set_visibility_weights((payload or {}).get("weights")))


@router.delete("/visibility")
def reset_visibility():
    """Drop the global override, reverting to the built-in curve."""
    return _visibility_payload(set_visibility_weights(None))
