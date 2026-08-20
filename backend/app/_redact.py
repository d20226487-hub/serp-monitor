"""URL / error-message redaction for credentials.

Provider error messages, exception strings, and HTTP traces routinely leak
credentials when the provider passes them via URL query params (notably
SerpAPI's `api_key=`) or basic-auth in the URL. We redact before any string
gets persisted to the DB or shown to the user.

Be defensive — apply at every error-storage site, not just at the source.
A single missed call leaks the credential into the database forever.
"""
from __future__ import annotations

import re

# Match `api_key=…`, `token=…`, `password=…`, etc. as URL query params or
# form fields. Captures the param name so we can preserve it in the output.
# NOTE on bare `key=`: Google AI Studio authenticates with `?key=<API_KEY>` in
# the URL, so an httpx error string would leak the key the same way SerpAPI's
# `api_key=` did. `\b` prevents false hits on words ending in "key"
# (e.g. "monkey=") since both sides are word characters there.
_QUERY_SECRET_RE = re.compile(
    r"\b(api[_-]?key|access[_-]?token|api[_-]?token|token|password|secret|key)=([^&\s'\"<>]+)",
    re.IGNORECASE,
)

# Inline basic-auth in URLs:  https://user:password@host/…
_INLINE_BASIC_AUTH_RE = re.compile(
    r"(://[^/\s:@]+):([^/\s@]+)@",
)

# Authorization: Bearer xxxxxx   |   Authorization: Basic xxxxxx
_AUTH_HEADER_RE = re.compile(
    r"(Authorization:\s*(?:Bearer|Basic)\s+)([A-Za-z0-9._\-+/=]+)",
    re.IGNORECASE,
)


def redact(s: str | None) -> str | None:
    """Return s with known credential patterns replaced by <REDACTED>.

    - Preserves param names (so debugging stays readable).
    - Idempotent: redact(redact(x)) == redact(x).
    - Returns None unchanged.
    """
    if not s:
        return s
    s = _QUERY_SECRET_RE.sub(lambda m: f"{m.group(1)}=<REDACTED>", s)
    s = _INLINE_BASIC_AUTH_RE.sub(r"\1:<REDACTED>@", s)
    s = _AUTH_HEADER_RE.sub(lambda m: f"{m.group(1)}<REDACTED>", s)
    return s
