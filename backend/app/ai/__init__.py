"""LLM provider registry.

Separate from `app/providers/` (SERP providers) on purpose — same word,
different job.
"""
from __future__ import annotations

from ..app_settings import get_ai_provider_config
from .ai_studio import AIStudioProvider
from .base import (
    AIProvider,
    AIProviderConfigError,
    AIProviderError,
    GenerationParams,
    GenerationResult,
    is_truncated,
)
from .vertex import VertexAIProvider

AI_PROVIDERS: dict[str, type[AIProvider]] = {
    "ai_studio": AIStudioProvider,
    "vertex": VertexAIProvider,
}


def get_ai_provider(code: str) -> AIProvider:
    """Build a provider from its stored settings. Raises if the code is unknown."""
    cls = AI_PROVIDERS.get(code)
    if cls is None:
        raise AIProviderConfigError(f"unknown AI provider: {code!r}")
    return cls(config=get_ai_provider_config(code))


__all__ = [
    "AI_PROVIDERS",
    "AIProvider",
    "AIProviderConfigError",
    "AIProviderError",
    "GenerationParams",
    "GenerationResult",
    "get_ai_provider",
    "is_truncated",
]
