"""Ahrefs /batch-analysis client, used by the analyzer job mode.

`POST /v3/batch-analysis/batch-analysis` returns current-snapshot metrics for
up to 100 targets per call (the API's hard ceiling). Billing is roughly
1 unit per target per selected field, so the `select` list is the main cost
lever — see `estimate_units()`.

KEY DIFFERENCE FROM DROP SHERLOCK'S COPY: that one analyses domains and sends
`mode: "subdomains"`. We analyse the exact SERP URLs, so every target goes out
with `mode: "exact"`. That matters beyond precision — Ahrefs only returns
`url_rating` (UR) in exact/URL mode; in domain modes UR comes back null.

Response rows map to inputs BY ARRAY POSITION (Ahrefs preserves `targets`
order). `url` is technically selectable, which would make rows self-identifying,
but it bills as another field per target — so we keep position mapping plus a
length check instead. Ahrefs rejects the WHOLE batch when any single target is
syntactically invalid, which shows up as a row-count mismatch; that fails the
chunk with a hint rather than silently mis-assigning metrics to the wrong URL.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import httpx

from .._redact import redact

# Allowlisted metrics in canonical display order: Ahrefs field id → short label.
# Restricted to fields that are meaningful for a single URL. Verified against
# the batch-analysis response schema (2026-08-20).
#   url_rating   — URL-level authority; ONLY populated in exact mode.
#   domain_rating— domain-level; same for every URL on a host, still useful as
#                  the "how strong is the site behind this result" signal.
BATCH_METRICS: dict[str, str] = {
    "url_rating": "UR",
    "domain_rating": "DR",
    "backlinks": "Backlinks",
    "backlinks_dofollow": "Backlinks (follow)",
    "refdomains": "Ref domains",
    "refdomains_dofollow": "Ref domains (follow)",
    "org_traffic": "Organic traffic",
    "org_keywords": "Organic keywords",
    "ahrefs_rank": "Ahrefs Rank",
}

# Sensible default when a job doesn't specify: the two ranking-difficulty
# signals the whole feature exists for.
DEFAULT_METRICS: list[str] = ["url_rating", "domain_rating"]

# Ahrefs caps `targets` at 100 per call (OpenAPI maxItems).
BATCH_SIZE = 100

ENDPOINT = "https://api.ahrefs.com/v3/batch-analysis/batch-analysis"


def canonical_metrics(requested: list[str] | None) -> list[str]:
    """Filter to the allowlist, in BATCH_METRICS order. Unknown ids are dropped
    silently; an empty/None request falls back to DEFAULT_METRICS."""
    if not requested:
        return list(DEFAULT_METRICS)
    wanted = set(requested)
    out = [m for m in BATCH_METRICS if m in wanted]
    return out or list(DEFAULT_METRICS)


def estimate_units(url_count: int, metric_count: int) -> int:
    """Rough Ahrefs API unit cost: ~1 unit per target per selected field.

    Approximate on purpose — Ahrefs returns the authoritative figure in the
    `x-api-units-cost-total-actual` response header, which the runner records.
    """
    return max(0, url_count) * max(0, metric_count)


@dataclass
class ChunkOutcome:
    """Result of one <=100-target call.

    On success (`error == ""`), `metrics_by_url` has one entry per input URL
    (position-mapped) → {field_id: value|None}. On failure `error` is set and
    the mapping is empty; the caller marks every URL in the chunk as errored.
    """
    http_status: int = 0
    metrics_by_url: dict[str, dict[str, float | None]] = field(default_factory=dict)
    error: str = ""
    cost_list: int = 0
    cost_billed: int = 0


def _header_int(headers, name: str) -> int:
    try:
        v = headers.get(name)
        return int(v) if v is not None else 0
    except (TypeError, ValueError):
        return 0


async def fetch_batch_chunk(
    client: httpx.AsyncClient,
    api_key: str,
    urls: list[str],
    select: list[str],
    *,
    country: str | None = None,
    timeout: float = 60.0,
) -> ChunkOutcome:
    """POST one chunk (<=100 URLs). Pure I/O — no DB. Never raises: transport,
    HTTP and shape errors all come back on `ChunkOutcome.error`."""
    payload: dict = {
        # mode=exact is what makes url_rating meaningful; protocol=both lets
        # Ahrefs match the target whether it indexed http or https.
        "targets": [{"url": u, "mode": "exact", "protocol": "both"} for u in urls],
        "select": list(select),
    }
    if country:
        # Scopes org_traffic / org_keywords to one country (ISO alpha-2).
        payload["country"] = country

    try:
        r = await client.post(
            ENDPOINT,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=timeout,
        )
    except Exception as e:  # noqa: BLE001 — normalised onto the outcome
        return ChunkOutcome(error=redact(f"{type(e).__name__}: {e}") or "request failed")

    out = ChunkOutcome(http_status=r.status_code)
    # Cost headers are absent when Ahrefs rejects the whole batch.
    out.cost_list = _header_int(r.headers, "x-api-units-cost-total")
    out.cost_billed = _header_int(r.headers, "x-api-units-cost-total-actual")

    try:
        body = r.json()
    except Exception:  # noqa: BLE001
        body = None

    if r.status_code == 401 or r.status_code == 403:
        out.error = "Ahrefs rejected the API key (HTTP %d)" % r.status_code
        return out
    if r.status_code != 200 or not isinstance(body, dict):
        detail = ""
        if isinstance(body, dict):
            detail = str(body.get("error") or body.get("message") or "")[:200]
        elif r.text:
            detail = r.text[:200]
        out.error = redact(f"HTTP {r.status_code}{': ' + detail if detail else ''}") or ""
        return out

    rows = body.get("targets")
    if not isinstance(rows, list):
        out.error = "unexpected response shape (no `targets` array)"
        return out

    # Length mismatch => Ahrefs dropped a target (usually a syntactically
    # invalid URL). Position mapping is no longer safe, and mis-assigning
    # metrics to the wrong URL would silently corrupt the difficulty scores —
    # so fail the chunk loudly instead.
    if len(rows) != len(urls):
        out.error = (
            f"batch dropped — sent {len(urls)} targets, got {len(rows)} rows. "
            "Ahrefs rejects a whole batch when any target is invalid."
        )
        return out

    for url, row in zip(urls, rows):
        metrics: dict[str, float | None] = {}
        if isinstance(row, dict):
            for fld in select:
                v = row.get(fld)
                metrics[fld] = float(v) if isinstance(v, (int, float)) else None
        out.metrics_by_url[url] = metrics
    return out


async def verify_api_key(api_key: str, *, timeout: float = 20.0) -> dict:
    """Cheapest possible credential probe: one target, one field.

    Ahrefs has no free auth endpoint, so this costs ~1 unit. Returns the
    subscription info Ahrefs reports in the cost headers.
    """
    async with httpx.AsyncClient(timeout=timeout) as client:
        outcome = await fetch_batch_chunk(
            client, api_key, ["https://ahrefs.com/"], ["domain_rating"]
        )
    if outcome.error:
        raise RuntimeError(outcome.error)
    return {
        "ok": True,
        "units_billed": outcome.cost_billed,
        "sample_dr": (outcome.metrics_by_url.get("https://ahrefs.com/") or {}).get(
            "domain_rating"
        ),
    }
