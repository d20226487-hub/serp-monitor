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
    "refdomains_nofollow": "Ref domains (nofollow)",
    "refips_subnets": "Ref IP subnets",
    "org_traffic": "Organic traffic",
    "org_keywords": "Organic keywords",
    "org_keywords_1_3": "Organic keywords 1-3",
    "org_keywords_4_10": "Organic keywords 4-10",
    "org_keywords_11_20": "Organic keywords 11-20",
    "ahrefs_rank": "Ahrefs Rank",
}

# url_rating is only populated in exact/URL mode, so it's pointless (and still
# billable) on a domain target. Everything else is valid in both modes.
URL_ONLY_METRICS = frozenset({"url_rating"})

# Defaults when a job doesn't specify.
#   URL level: the two page-strength signals the feature exists for (2 units).
#   Domain level: how much weight sits behind the page — the parasite-page vs
#   standalone-doorway distinction that page metrics alone cannot make.
DEFAULT_METRICS: list[str] = ["url_rating", "domain_rating"]
DEFAULT_DOMAIN_METRICS: list[str] = ["refdomains_dofollow", "org_keywords"]

# Ahrefs mode for the DOMAIN-level pass.
#
# MUST be "subdomains", not "domain". "domain" scopes to the bare apex only, and
# most real sites serve their content from www or another subdomain — measured:
#   liga.net  mode=domain      ->     9 organic keywords,      0 in top 3
#   liga.net  mode=subdomains  -> 51,345 organic keywords, 13,196 in top 3
# The second matches what the Ahrefs UI shows (its Batch Analysis defaults to
# Subdomains). Since we also normalise www. away when deriving the host, using
# "domain" measured an almost-empty apex and reported real sites as having no
# organic presence — inverting the authority-vs-PBN signal this pass exists for.
DOMAIN_MODE = "subdomains"

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


def canonical_domain_metrics(requested: list[str] | None) -> list[str]:
    """Same, for the domain-level pass. Drops url_rating — Ahrefs returns it
    empty outside exact mode, so paying for it on a domain target is waste.
    An explicit empty list means "domain enrichment off"; None means default.
    """
    if requested is None:
        return list(DEFAULT_DOMAIN_METRICS)
    wanted = set(requested) - URL_ONLY_METRICS
    return [m for m in BATCH_METRICS if m in wanted]


# Per-field unit cost. Ahrefs bills most columns at 1 unit per row but puts
# some on 5- and 10-unit tiers. The referring-domain family costs 5 (confirmed
# by the user against the Ahrefs dashboard) and org_traffic costs 10, which is
# consistent with BOTH billing observations:
#   6 rows x [url_rating, domain_rating, backlinks_dofollow, refdomains_dofollow,
#             org_keywords, org_traffic]  -> 114 == 6 x 19 == 6 x (1+1+1+5+1+10)
#   4 rows x [url_rating, domain_rating, refdomains, backlinks, org_traffic]
#                                        ->  72 ==  4 x 18 == 4 x (1+1+5+1+10)
# refips_subnets is grouped with the refdomains family (same class of data);
# that one is inferred rather than measured, and inferring HIGH is the safe
# direction for a cost estimate.
FIELD_UNIT_COST: dict[str, int] = {
    "url_rating": 1,
    "domain_rating": 1,
    "backlinks": 1,
    "backlinks_dofollow": 1,
    "refdomains": 5,
    "refdomains_dofollow": 5,
    "refdomains_nofollow": 5,
    "refips_subnets": 5,
    "org_traffic": 10,
    "org_keywords": 1,
    "org_keywords_1_3": 1,
    "org_keywords_4_10": 1,
    "org_keywords_11_20": 1,
    "ahrefs_rank": 1,
}

# Every request costs at least this, regardless of how little you ask for.
# Measured: a 1-target/1-field call reports x-api-units-cost-total = 50, and a
# 3-target/3-field call bills 50. Billing behaves as max(floor, data cost) —
# NOT floor + data — since the 6x19=114 run billed exactly 114, not 164.
BASE_REQUEST_UNITS = 50


def per_url_units(metrics: list[str]) -> int:
    """Unit cost of one URL for the given field selection."""
    return sum(FIELD_UNIT_COST.get(m, 1) for m in metrics)


def estimate_units(url_count: int, metrics: list[str]) -> int:
    """Estimated Ahrefs units for a whole analyzer run.

    Model: per request, billed = max(BASE_REQUEST_UNITS, rows x per-row cost);
    a run is ceil(urls / BATCH_SIZE) requests. Ahrefs may bill LESS when it
    serves cached data (observed: repeat lookups bill 0), so treat this as an
    upper bound. The authoritative figure comes back in
    `x-api-units-cost-total-actual`, which the runner records per run.
    """
    urls = max(0, url_count)
    if not urls or not metrics:
        return 0
    per_row = per_url_units(metrics)
    chunks = (urls + BATCH_SIZE - 1) // BATCH_SIZE
    total = 0
    remaining = urls
    for _ in range(chunks):
        rows = min(remaining, BATCH_SIZE)
        remaining -= rows
        total += max(BASE_REQUEST_UNITS, rows * per_row)
    return total


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
    mode: str = "exact",
) -> ChunkOutcome:
    """POST one chunk (<=100 targets). Pure I/O — no DB. Never raises: transport,
    HTTP and shape errors all come back on `ChunkOutcome.error`.

    `mode` is per-target in the API, so exact and domain targets CAN share one
    request. We don't, because `select` is per-REQUEST: mixing modes would force
    the union of both field sets onto every target. With different URL/domain
    selections two requests bill less, even paying the 50-unit floor twice —
    e.g. 100 URLs x 2 fields + 35 domains x 2 other fields is 270 units split,
    vs 540 combined.
    """
    payload: dict = {
        # mode=exact is what makes url_rating meaningful; protocol=both lets
        # Ahrefs match the target whether it indexed http or https.
        "targets": [{"url": u, "mode": mode, "protocol": "both"} for u in urls],
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
