"""Google AI Studio provider (generativelanguage.googleapis.com).

Auth: a single API key from https://aistudio.google.com/apikey, passed as a
`?key=` query param. That means the key CAN end up inside httpx error strings,
so every error here goes through redact() — the same leak that exposed the
SerpAPI key on a run page.

Endpoint:
  POST {BASE}/models/{model}:generateContent?key={KEY}
"""
from __future__ import annotations

from typing import Any

import httpx

from .._redact import redact
from .base import (
    AIProvider,
    AIProviderConfigError,
    AIProviderError,
    GenerationParams,
    GenerationResult,
    gemini_completion_tokens,
)

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

DEFAULT_MODEL = "gemini-2.5-flash"


def _safe_int(v: object) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def build_gemini_body(prompt: str, params: GenerationParams | None) -> dict[str, Any]:
    """Assemble a generateContent request body.

    Shared with the Vertex provider — both speak the identical Gemini shape, and
    keeping one builder stops the two drifting apart.
    """
    body: dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
    }
    gen_config: dict[str, Any] = {}
    if params:
        if params.temperature is not None:
            gen_config["temperature"] = params.temperature
        if params.max_output_tokens is not None:
            gen_config["maxOutputTokens"] = params.max_output_tokens
        if params.top_p is not None:
            gen_config["topP"] = params.top_p
        # On Gemini 2.5+, thinking tokens are billed against maxOutputTokens, so
        # leaving thinking dynamic can silently eat the answer's whole
        # allowance. Only emitted when explicitly configured — never guessed —
        # because the thinking knobs differ across Gemini generations.
        if params.thinking_budget is not None:
            gen_config["thinkingConfig"] = {"thinkingBudget": params.thinking_budget}
        if params.system:
            body["systemInstruction"] = {"parts": [{"text": params.system}]}
    if gen_config:
        body["generationConfig"] = gen_config
    return body


def parse_gemini_response(data: dict, model: str, *, who: str) -> GenerationResult:
    """Turn a generateContent response into a GenerationResult.

    Shared by both providers. `who` names the provider in error messages.
    """
    try:
        candidate = data["candidates"][0]
        finish = candidate.get("finishReason")
        # `parts` is absent when the model produced no text at all — e.g. it
        # spent the entire budget on thinking, or the reply was safety-blocked.
        # That's a real outcome, not a malformed payload, so return empty text
        # with the finish reason intact rather than raising.
        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
    except (KeyError, IndexError, TypeError) as e:
        raise AIProviderError(
            f"Unexpected {who} response shape: {e}", raw=data
        ) from e

    usage = data.get("usageMetadata") or {}
    return GenerationResult(
        text=text,
        model=model,
        finish_reason=finish,
        raw=data,
        prompt_tokens=_safe_int(usage.get("promptTokenCount")),
        completion_tokens=gemini_completion_tokens(usage),
    )


class AIStudioProvider(AIProvider):
    code = "ai_studio"
    label = "Google AI Studio"

    async def generate(
        self,
        prompt: str,
        *,
        model: str | None = None,
        params: GenerationParams | None = None,
    ) -> GenerationResult:
        api_key = self._cfg("api_key")
        if not api_key:
            raise AIProviderConfigError(
                "Google AI Studio needs an API key. Add one in Settings → AI "
                "providers (get it at aistudio.google.com/apikey)."
            )
        chosen = (model or self.default_model or DEFAULT_MODEL).strip()

        url = f"{BASE_URL}/models/{chosen}:generateContent"
        body = build_gemini_body(prompt, params)

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(url, params={"key": api_key}, json=body)
        except httpx.HTTPError as e:
            # str(e) can embed the full URL including ?key= — always redact.
            raise AIProviderError(
                redact(f"Network error calling Google AI Studio: {e}")
            ) from e

        if resp.status_code in (401, 403):
            raise AIProviderConfigError(
                redact(f"Google AI Studio rejected the API key: {resp.text[:300]}")
            )
        if resp.status_code >= 400:
            raise AIProviderError(
                redact(f"Google AI Studio returned HTTP {resp.status_code}: {resp.text[:600]}"),
                status_code=resp.status_code,
                headers={k.lower(): v for k, v in resp.headers.items()},
            )

        return parse_gemini_response(resp.json(), chosen, who="Google AI Studio")
