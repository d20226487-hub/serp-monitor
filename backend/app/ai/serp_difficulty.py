"""AI SERP-difficulty scoring for analyzer-mode runs.

Sends the model ONE UNITED TABLE per keyword: each row is a ranking result with
its position, title, URL and that URL's Ahrefs metrics side by side.

Why united rather than two tables (SERP + metrics joined by URL):
  * It's a clean 1:1 join — every result has exactly one metrics row — so
    there's nothing for the model to reconcile.
  * Making the model join on long URLs itself invites mismatches; pre-joining
    removes a whole class of error.
  * Two tables repeat every URL, and URLs are the longest cells in the payload.
  * Difficulty depends on WHICH position holds WHICH strength, so position and
    metrics belong on the same row.
"""
from __future__ import annotations

import json
import logging

from . import GenerationParams, get_ai_provider
from .base import AIProviderError
from .prompts import get_domain_prompt, get_serp_difficulty_prompt

log = logging.getLogger(__name__)

VALID_DIFFICULTIES = ("low", "medium", "hard", "too hard")

# Room the answer needs once thinking has taken its share. A verdict plus a
# 1-3 sentence comment fits in a few hundred tokens; 600 is the value this ran
# on for its whole life before thinking was an option.
ANSWER_HEADROOM_TOKENS = 600

# Column headers for the metric ids we may send.
_METRIC_HEADERS = {
    "url_rating": "UR",
    "domain_rating": "DR",
    "backlinks": "Backlinks",
    "backlinks_dofollow": "Backlinks(f)",
    "refdomains": "RefDomains",
    "refdomains_dofollow": "RefDomains(f)",
    "org_traffic": "OrgTraffic",
    "org_keywords": "OrgKeywords",
    "org_keywords_1_3": "OrgKw 1-3",
    "org_keywords_4_10": "OrgKw 4-10",
    "org_keywords_11_20": "OrgKw 11-20",
    "refdomains_nofollow": "RefDomains(nf)",
    "refips_subnets": "RefIPSubnets",
    "ahrefs_rank": "AhrefsRank",
}

# Descriptions add real signal about what KIND of page ranks, but they're the
# most token-hungry cell. Truncated rather than dropped.
_DESC_LIMIT = 110
_TITLE_LIMIT = 90


def _fmt(v) -> str:
    if v is None:
        return "-"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _clip(s: str | None, n: int) -> str:
    s = (s or "").replace("|", "/").replace("\n", " ").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def build_serp_table(rows: list[dict], metrics: list[str], *, multi_variant: bool) -> str:
    """Markdown table: one row per SERP result, metrics inline.

    `rows` items: {position, url, title, description, engine, device, location,
    metrics: {field: value|None}}. Engine/device/location columns are included
    only when the keyword actually spans more than one variant — otherwise
    they'd be the same value on every row, wasting tokens for no signal.
    """
    headers = ["#"]
    if multi_variant:
        headers += ["Engine", "Device", "Location"]
    headers += ["Title", "URL"] + [_METRIC_HEADERS.get(m, m) for m in metrics]

    lines = ["| " + " | ".join(headers) + " |",
             "|" + "|".join("---" for _ in headers) + "|"]
    for r in rows:
        cells = [str(r.get("position") or "")]
        if multi_variant:
            cells += [
                r.get("engine") or "-",
                r.get("device") or "-",
                _clip(r.get("location"), 40) or "-",
            ]
        cells += [
            _clip(r.get("title"), _TITLE_LIMIT) or "-",
            _clip(r.get("url"), 120) or "-",
        ]
        m = r.get("metrics") or {}
        cells += [_fmt(m.get(f)) for f in metrics]
        lines.append("| " + " | ".join(cells) + " |")

    # Snippets go below the table rather than as another column: they're long
    # and would blow out the row width, but they're what tells the model whether
    # these are affiliates, forums or brand pages.
    snippets = [
        f"{r.get('position')}. {_clip(r.get('description'), _DESC_LIMIT)}"
        for r in rows
        if (r.get("description") or "").strip()
    ]
    if snippets:
        lines.append("")
        lines.append("Snippets:")
        lines.extend(snippets)
    return "\n".join(lines)


def build_domain_table(domains: list[dict], metrics: list[str]) -> str:
    """Separate table for domain-level facts: Ahrefs metrics and registration age.

    Separate rather than merged into the SERP table because the relationship is
    1:many - one domain backs several result URLs - so merging would repeat the
    same domain figures on every row and imply they were per-page.

    Age earns its place beside the link metrics because the two only mean
    something together: 300 referring domains is unremarkable on a ten-year-old
    site and a red flag on one registered four months ago. Registrar rides along
    for the same reason - a cluster of doorways registered within days of each
    other at one registrar is a network, not a coincidence.

    Renders when there is EITHER a metric selected or an age known, so turning
    on domain age without Ahrefs domain metrics still reaches the model.
    """
    if not domains:
        return ""
    has_age = any(d.get("age") for d in domains)
    if not metrics and not has_age:
        return ""
    headers = ["Domain"] + [_METRIC_HEADERS.get(m, m) for m in metrics]
    if has_age:
        headers += ["Age", "Registrar"]
    lines = ["| " + " | ".join(headers) + " |",
             "|" + "|".join("---" for _ in headers) + "|"]
    for d in domains:
        m = d.get("metrics") or {}
        # A parent row is the registrable domain under a subdomain listed above
        # it; the prefix keeps the two from reading as unrelated competitors.
        name = ("|_ " if d.get("indent") else "") + _clip(d.get("domain"), 60)
        cells = [name] + [_fmt(m.get(f)) for f in metrics]
        if has_age:
            age = d.get("age") or "-"
            if d.get("age_of"):
                age = f"{age} (of {_clip(d.get('age_of'), 40)})"
            cells += [age, _clip(d.get("registrar"), 40) or "-"]
        lines.append("| " + " | ".join(cells) + " |")
    if has_age:
        # Spelled out because a bare dash is ambiguous: without this the model
        # cannot tell "we did not look" from "the registration is genuinely
        # unlisted", and reads a blank as brand-new - the opposite of the truth.
        lines.append("")
        lines.append(
            "Age is time since the domain's current WHOIS registration date. "
            "A dash means the date is UNKNOWN, not that the domain is new. "
            "Subdomains are shown against their parent registration."
        )
    return "\n".join(lines)


# Gemini structured output: forcing a schema removes the "parse the model's
# prose" failure mode entirely.
RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "difficulty": {"type": "STRING", "enum": list(VALID_DIFFICULTIES)},
        "comment": {"type": "STRING"},
    },
    "required": ["difficulty", "comment"],
}


def _coerce_difficulty(value: str | None) -> str | None:
    """Map the model's answer onto our vocabulary, tolerating case and the
    common 'very hard' / 'too_hard' spellings."""
    if not value:
        return None
    v = value.strip().lower().replace("_", " ")
    if v in VALID_DIFFICULTIES:
        return v
    if v in {"very hard", "extremely hard", "impossible"}:
        return "too hard"
    if v in {"easy"}:
        return "low"
    if v in {"moderate", "mid"}:
        return "medium"
    return None


def build_prompt(keyword: str, table: str, domain_table: str = "") -> str:
    """Assemble the exact text the model will receive.

    Split out from `judge_keyword` so the caller holds the prompt BEFORE the
    call goes out and can record it whether the call succeeds or fails. A
    failed verdict is precisely when you want to read what was sent.
    """
    prompt_template = get_serp_difficulty_prompt()
    # Appended rather than a {domain_table} placeholder: a user who saved a
    # custom prompt before domain metrics existed would otherwise silently lose
    # the new data. Appending keeps every saved prompt working.
    full_table = table
    if domain_table:
        # The domain-section guidance is its own user-editable prompt, so the
        # authority-vs-PBN judgement it encodes can be tuned without touching
        # the main prompt. A {domain_table} placeholder inside it controls
        # placement; otherwise the table is appended after the text.
        guidance = get_domain_prompt()
        if "{domain_table}" in guidance:
            block = guidance.replace("{domain_table}", domain_table)
        else:
            block = guidance.rstrip() + "\n" + domain_table
        full_table = table + "\n\n" + block
    try:
        prompt = prompt_template.format(keyword=keyword, table=full_table)
    except (KeyError, IndexError):
        # A user-edited prompt with a stray brace shouldn't kill the run —
        # fall back to appending the data so the call still has context.
        log.warning("serp_difficulty prompt has bad placeholders; appending data")
        prompt = f"{prompt_template}\n\nKeyword: {keyword}\n\nSERP:\n{full_table}"
    return prompt


async def judge_keyword(
    provider_code: str,
    prompt: str,
    *,
    model: str | None = None,
    temperature: float | None = None,
    thinking_budget: int | None = None,
    max_output_tokens: int | None = None,
) -> dict:
    """One AI verdict from an already-built prompt. Raises on failure.

    `temperature` overrides the configured default, so the effect of creativity
    on a verdict can be measured against identical input rather than guessed at.
    """
    from ..app_settings import (
        get_ai_max_output_tokens, get_ai_temperature, get_ai_thinking_budget,
    )
    temp = get_ai_temperature() if temperature is None else temperature
    think = get_ai_thinking_budget() if thinking_budget is None else thinking_budget
    max_out = (
        get_ai_max_output_tokens() if max_output_tokens is None else max_output_tokens
    )
    # Thinking is billed against the SAME allowance as the answer, so a budget
    # that approaches the cap leaves nothing for the verdict and the call comes
    # back empty. Guarantee headroom rather than let that happen silently.
    if think > 0 and max_out < think + ANSWER_HEADROOM_TOKENS:
        max_out = think + ANSWER_HEADROOM_TOKENS
    provider = get_ai_provider(provider_code)
    result = await provider.generate(
        prompt,
        model=model,
        params=GenerationParams(
            max_output_tokens=max_out,
            temperature=temp,
            # Thinking is billed against max_output_tokens on Gemini 2.5+, and a
            # 1-3 sentence verdict doesn't need a reasoning budget — leaving it
            # dynamic risks the model spending the entire allowance thinking and
            # returning nothing.
            thinking_budget=think,
            response_schema=RESPONSE_SCHEMA,
        ),
    )

    raw = (result.text or "").strip()
    if not raw:
        raise AIProviderError(
            f"model returned no text (finish_reason={result.finish_reason})"
        )
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise AIProviderError(f"model did not return valid JSON: {e}; got {raw[:200]}") from e

    difficulty = _coerce_difficulty(data.get("difficulty"))
    if difficulty is None:
        raise AIProviderError(f"unrecognised difficulty value: {data.get('difficulty')!r}")
    return {
        "difficulty": difficulty,
        "temperature": temp,
        "thinking_budget": think,
        "comment": (data.get("comment") or "").strip(),
        # The model's own JSON, kept so a surprising verdict can be checked
        # against what actually came back rather than the parsed view of it.
        "raw": raw,
        "model": result.model,
        "prompt_tokens": result.prompt_tokens,
        "completion_tokens": result.completion_tokens,
    }
