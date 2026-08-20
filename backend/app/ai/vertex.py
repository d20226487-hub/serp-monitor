"""Google Vertex AI provider (Gemini via publishers/google).

Two auth modes, auto-picked from whichever credentials are configured:

  1. Service-account JSON (enterprise). `service_account_json` + `project_id` +
     `location`. We mint a short-lived OAuth2 access token with google-auth and
     POST to the REGIONAL endpoint scoped to the project. This is the path with
     real production quota.

  2. Vertex Express (API key). Just `api_key`. POSTs to the GLOBAL endpoint with
     `?key=`. No project/location needed. Express quotas are tight — fine for
     trials, not bulk runs.

Service-account JSON wins when both are present, since it's the mode with the
usable quota.

Claude on Vertex (publishers/anthropic) is deliberately NOT supported here: it
speaks the Anthropic Messages API rather than generateContent and would pull in
the anthropic SDK. Scoped to Gemini on purpose — see the module docstring in
ACM's vertex_ai.py for what that path involves if it's ever wanted.

Ported from the AI Content Machine integration.
"""
from __future__ import annotations

import json
import time
from typing import Any

import httpx

from .._redact import redact
from .ai_studio import build_gemini_body, parse_gemini_response
from .base import (
    AIProvider,
    AIProviderConfigError,
    AIProviderError,
    GenerationParams,
    GenerationResult,
)

DEFAULT_MODEL = "gemini-2.5-flash"
DEFAULT_LOCATION = "us-central1"

# Process-level caches, keyed by the service account's client_email so swapping
# the SA JSON in Settings (a different identity) can't keep serving a stale
# token. Access tokens live ~1h; we refresh with a 60-second skew.
_TOKEN_CACHE: dict[str, tuple[str, float]] = {}
# Building credentials parses the SA's RSA key, so cache that too rather than
# redoing it per call.
_CREDS_CACHE: dict[str, Any] = {}


def _credentials(service_account_json: str) -> Any:
    """Build (and cache) a google-auth credentials object from the stored SA JSON."""
    try:
        info = json.loads(service_account_json)
    except json.JSONDecodeError as e:
        raise AIProviderConfigError(
            f"Vertex AI: the service-account JSON is not valid JSON: {e}"
        ) from e
    client_email = info.get("client_email") or ""
    cached = _CREDS_CACHE.get(client_email)
    if cached is not None:
        return cached
    try:
        # Imported lazily so google-auth stays optional for anyone using only
        # AI Studio or Express-key Vertex.
        from google.oauth2 import service_account
    except ImportError as e:
        raise AIProviderConfigError(
            "Vertex AI service-account mode requires google-auth — rebuild the "
            "api image so the dependency installs."
        ) from e
    try:
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
    except ValueError as e:
        # google-auth raises ValueError for shape problems ("missing fields
        # token_uri", …) — surface as a config error so the Settings Test
        # panel shows something actionable.
        raise AIProviderConfigError(
            f"Vertex AI: the service-account JSON is invalid: {e}"
        ) from e
    _CREDS_CACHE[client_email] = creds
    return creds


def _access_token(service_account_json: str) -> str:
    """Mint an OAuth2 access token, cached per service-account identity.

    Synchronous (google-auth is sync) but cheap enough to call from an async
    path — an actual refresh happens about once an hour per identity.
    """
    try:
        info = json.loads(service_account_json)
    except json.JSONDecodeError as e:
        raise AIProviderConfigError(
            f"Vertex AI: the service-account JSON is not valid JSON: {e}"
        ) from e
    client_email = info.get("client_email") or ""
    cached = _TOKEN_CACHE.get(client_email)
    now = time.time()
    if cached and cached[1] > now + 60:
        return cached[0]
    try:
        from google.auth.transport.requests import Request
    except ImportError as e:
        raise AIProviderConfigError(
            "Vertex AI service-account mode requires google-auth — rebuild the "
            "api image so the dependency installs."
        ) from e
    creds = _credentials(service_account_json)
    try:
        creds.refresh(Request())
    except Exception as e:  # noqa: BLE001 — surface OAuth2 failures readably
        raise AIProviderConfigError(
            redact(f"Vertex AI: failed to mint an access token: {e}")
        ) from e
    token = creds.token or ""
    if not token:
        raise AIProviderConfigError("Vertex AI: token mint returned an empty token")
    expiry = creds.expiry.timestamp() if creds.expiry else now + 3300
    _TOKEN_CACHE[client_email] = (token, expiry)
    return token


class VertexAIProvider(AIProvider):
    code = "vertex"
    label = "Google Vertex AI"

    async def generate(
        self,
        prompt: str,
        *,
        model: str | None = None,
        params: GenerationParams | None = None,
    ) -> GenerationResult:
        chosen = (model or self.default_model or DEFAULT_MODEL).strip()
        if chosen.lower().startswith("claude"):
            # Fail loudly rather than sending a Claude id down the Gemini path,
            # which produces a confusing "model not supported" from Vertex even
            # when the project genuinely has Claude enabled.
            raise AIProviderConfigError(
                f"Vertex AI: '{chosen}' is an Anthropic model. This integration "
                "supports Gemini models only (publishers/google). Pick a "
                "gemini-* model."
            )

        sa_json = self._cfg("service_account_json")
        api_key = self._cfg("api_key")

        if sa_json:
            url, headers, query = self._service_account_target(sa_json, chosen)
        elif api_key:
            # Vertex Express: global endpoint, no project scoping.
            url = (
                "https://aiplatform.googleapis.com/v1/"
                f"publishers/google/models/{chosen}:generateContent"
            )
            headers = {"Content-Type": "application/json"}
            query = {"key": api_key}
        else:
            raise AIProviderConfigError(
                "Vertex AI: neither a service-account JSON nor an Express API "
                "key is configured. Add one in Settings → AI providers."
            )

        body = build_gemini_body(prompt, params)

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(url, params=query, headers=headers, json=body)
        except httpx.HTTPError as e:
            # Express mode puts the key in the URL, so redact before surfacing.
            raise AIProviderError(
                redact(f"Network error calling Vertex AI: {e}")
            ) from e

        if resp.status_code in (401, 403):
            raise AIProviderConfigError(
                redact(f"Vertex AI rejected the credentials: {resp.text[:300]}")
            )
        if resp.status_code >= 400:
            raise AIProviderError(
                redact(f"Vertex AI returned HTTP {resp.status_code}: {resp.text[:600]}"),
                status_code=resp.status_code,
                headers={k.lower(): v for k, v in resp.headers.items()},
            )

        return parse_gemini_response(resp.json(), chosen, who="Vertex AI")

    def _service_account_target(
        self, sa_json: str, model: str
    ) -> tuple[str, dict[str, str], dict[str, str]]:
        project_id = self._cfg("project_id")
        if not project_id:
            raise AIProviderConfigError(
                "Vertex AI: project_id is required with service-account JSON. "
                "Set it in Settings → AI providers."
            )
        location = self._cfg("location") or DEFAULT_LOCATION
        token = _access_token(sa_json)
        url = (
            f"https://{location}-aiplatform.googleapis.com/v1/"
            f"projects/{project_id}/locations/{location}/"
            f"publishers/google/models/{model}:generateContent"
        )
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        return url, headers, {}
