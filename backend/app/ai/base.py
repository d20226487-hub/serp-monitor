"""Shared contract for LLM providers (Google AI Studio, Vertex AI).

Deliberately a SEPARATE package from `app/providers/`, which holds the SERP
providers (SerpAPI, Bright Data, Oxylabs, DataForSEO). Same word, different
job — keeping them apart avoids a confusing `providers.providers` mess.

Ported from the AI Content Machine integration, keeping the accounting logic
that took real debugging to get right (see `gemini_completion_tokens`).
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

# Finish reasons meaning "the model was cut off at its output ceiling".
# Gemini shouts MAX_TOKENS; OpenAI-compatible APIs say "length". We only speak
# Gemini here today, but the set is cheap to keep general.
TRUNCATION_FINISH_REASONS = frozenset({"max_tokens", "length"})


def is_truncated(finish_reason: str | None) -> bool:
    """True when the provider says the reply hit the output ceiling."""
    if not finish_reason:
        return False
    return finish_reason.strip().lower() in TRUNCATION_FINISH_REASONS


def _coerce_int(v: object) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def gemini_completion_tokens(usage: dict) -> int | None:
    """Billable output tokens from a Gemini ``usageMetadata`` block.

    Gemini reports the answer and the reasoning SEPARATELY:
    ``candidatesTokenCount`` EXCLUDES ``thoughtsTokenCount``, while
    ``totalTokenCount`` is prompt + candidates + thoughts. Google bills
    thinking at the output rate, so counting only ``candidatesTokenCount``
    understates real cost — badly on reasoning-heavy calls (ACM measured 3
    answer tokens against 346 thinking tokens on one gemini-2.5-flash request).

    Shared by both providers so the two can't drift; AI Studio and Vertex
    return the same generateContent response shape.
    """
    answer = _coerce_int(usage.get("candidatesTokenCount"))
    if answer is None:
        # Vertex has historically also spelled it outputTokenCount.
        answer = _coerce_int(usage.get("outputTokenCount"))
    thoughts = _coerce_int(usage.get("thoughtsTokenCount"))
    if answer is None and thoughts is None:
        return None
    known = (answer or 0) + (thoughts or 0)

    # Reconcile against the provider's own total: if a future model bills a
    # bucket under a key we don't read (a renamed thinking field, say), then
    # total - prompt exceeds what we summed — trust the larger figure so new
    # models can't silently undercount. Never take the smaller: a total that
    # omits a bucket we DID read would understate it.
    total = _coerce_int(usage.get("totalTokenCount"))
    prompt = _coerce_int(usage.get("promptTokenCount"))
    if total is not None and prompt is not None:
        return max(known, total - prompt)
    return known


class AIProviderError(RuntimeError):
    """Any provider-side failure (HTTP, auth, quota, malformed response)."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        raw: object = None,
        headers: dict[str, str] | None = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.raw = raw
        self.headers = headers or {}

    @property
    def retry_after_seconds(self) -> float | None:
        """Retry-After in seconds, when the upstream sent one (429/503)."""
        v = self.headers.get("retry-after")
        if not v:
            return None
        try:
            return float(v)
        except ValueError:
            # The HTTP-date form is rare for these APIs; ignore it.
            return None


class AIProviderConfigError(AIProviderError):
    """Missing/invalid credentials or configuration. Not retriable."""


@dataclass
class GenerationParams:
    """Common subset; implementations ignore fields they don't support."""

    temperature: float | None = None
    max_output_tokens: int | None = None
    top_p: float | None = None
    system: str | None = None
    # Reasoning-token allowance for models that bill thinking against the same
    # budget as the answer (Gemini 2.5+).
    #   None -> send nothing, use the model default
    #   0    -> disable thinking (thinkingBudget=0)
    #   >0   -> that many thinking tokens
    # Left unset by default so a model whose thinking API we haven't verified
    # is never sent a field it might reject.
    thinking_budget: int | None = None
    # Gemini structured output. When set, the model is constrained to this JSON
    # schema and responseMimeType is forced to application/json — which removes
    # the "parse the model's prose" failure mode rather than mitigating it.
    response_schema: dict | None = None


@dataclass
class GenerationResult:
    text: str
    model: str
    finish_reason: str | None = None
    raw: dict | None = None
    prompt_tokens: int | None = None
    # Includes thinking tokens — see gemini_completion_tokens().
    completion_tokens: int | None = None

    @property
    def truncated(self) -> bool:
        return is_truncated(self.finish_reason)


class AIProvider(ABC):
    """One configured LLM backend. Instantiated per call from stored settings."""

    code: str = "abstract"
    #: Human-readable name for error messages and the Settings UI.
    label: str = "abstract"

    def __init__(self, *, config: dict[str, str] | None = None):
        # Flat credential/config dict straight from app_settings, e.g.
        # {"api_key": ..., "model": ...} or Vertex's SA-JSON trio.
        self.config = config or {}

    def _cfg(self, key: str) -> str:
        return (self.config.get(key) or "").strip()

    @property
    def default_model(self) -> str:
        return self._cfg("model")

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        *,
        model: str | None = None,
        params: GenerationParams | None = None,
    ) -> GenerationResult:
        ...

    async def test_credentials(self) -> dict:
        """Cheapest possible round-trip that proves auth works.

        Deliberately a real generate() call: unlike the SERP providers, neither
        Google API offers a free account/balance endpoint, so the only honest
        check is a tiny generation. Costs a handful of tokens.
        """
        result = await self.generate(
            "Reply with the single word: OK",
            params=GenerationParams(max_output_tokens=16, thinking_budget=0),
        )
        return {
            "ok": True,
            "model": result.model,
            "text": (result.text or "").strip()[:80],
            "prompt_tokens": result.prompt_tokens,
            "completion_tokens": result.completion_tokens,
        }
