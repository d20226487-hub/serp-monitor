"""Yandex SERP HTML → organic results.

Used as a fallback for Bright Data zones that don't have JSON parsing for
Yandex on the user's plan ("JSON output is not supported"). Yandex's DOM
isn't perfectly stable, so we walk a few common selectors before giving up
and dump diagnostics if we find nothing.

Refuses to "guess" results from non-SERP pages: if the DOM doesn't have a
results container, returns [] and lets the caller's diagnostics surface the
real cause (captcha, IP-block, wrong URL, etc.) instead of silently filling
the run with random links scraped off the page chrome.
"""
from __future__ import annotations

import logging
from urllib.parse import parse_qs, unquote, urlparse

from selectolax.parser import HTMLParser

from .base import ProviderError, ResultRow, domain_of, shown_host

log = logging.getLogger(__name__)


# Markers Yandex puts on its anti-bot / captcha interstitial pages.
_CAPTCHA_MARKERS = (
    "showcaptcha",
    "smartcaptcha",
    "are you a robot",
    "вы не робот",          # Russian: "you are not a robot"
    "подтвердите, что запросы отправляли вы",
    "captcha-img",
    "data-captcha",
)


def _looks_like_captcha(html: str, page_title: str | None) -> bool:
    h = html.lower() if html else ""
    t = (page_title or "").lower()
    if any(m in h for m in _CAPTCHA_MARKERS):
        return True
    if "captcha" in t or "ой!" in t:
        return True
    return False

# Yandex serves several layouts (desktop, mobile, "new" SERP). These selectors
# cover the desktop layout most commonly returned to Bright Data.
ITEM_SELECTORS = [
    "li.serp-item",                 # classic desktop
    "div.serp-item",                # newer
    "div.organic",                  # rare
    "li[data-cid]",                 # variant with data-cid
]


def _resolve_yandex_redirect(href: str | None) -> str | None:
    """Yandex sometimes wraps URLs in /redir/ or /url/ trackers with the
    real destination in a query param. Unwrap to the underlying URL."""
    if not href:
        return None
    try:
        parsed = urlparse(href)
    except Exception:
        return href
    host = (parsed.hostname or "").lower()
    if any(yh in host for yh in ("yandex.", "ya.ru", "yabs.yandex")):
        qs = parse_qs(parsed.query)
        for key in ("url", "u", "to", "destination"):
            v = qs.get(key)
            if v and v[0]:
                return unquote(v[0])
    return href


def _text(node) -> str | None:
    if node is None:
        return None
    t = node.text(separator=" ", strip=True)
    return t or None


def _extract_one(item) -> ResultRow | None:
    # Title link: most layouts use <h2 class="organic__title-wrapper"> with an <a>
    link = (
        item.css_first("h2 a[href]")
        or item.css_first("a.OrganicTitle-Link")
        or item.css_first("a.organic__url")
        or item.css_first("a.Link[href]")
        or item.css_first("a[href]")
    )
    if link is None:
        return None
    href = _resolve_yandex_redirect(link.attributes.get("href"))
    if not href or href.startswith("#") or href.startswith("javascript:"):
        return None

    title = _text(link)
    # Description / snippet
    desc_node = (
        item.css_first(".organic__content-wrapper")
        or item.css_first(".OrganicTextContent")
        or item.css_first(".text-container")
        or item.css_first(".extended-text")
    )
    description = _text(desc_node)

    # The address Yandex PRINTS above the title. The API providers hand this
    # over as a field; here it has to come out of the markup, which makes it
    # the one source that can break quietly when Yandex reshuffles its class
    # names — hence three selectors and a None when none of them match.
    path_node = (
        item.css_first(".Path-Item")
        or item.css_first(".OrganicUrl-Path")
        or item.css_first(".organic__path")
    )

    return {
        "position": 0,  # filled in by caller
        "url": href,
        "title": title,
        "description": description,
        "domain": domain_of(href),
        "shown_host": shown_host(_text(path_node)) if path_node is not None else None,
    }


def parse_yandex_html(html: str, top_n: int) -> list[ResultRow]:
    """Strict organic extraction from a Yandex SERP page.

    Raises ProviderError if the page is a captcha/anti-bot interstitial
    (so the run fails clearly instead of returning random links). Returns
    [] if the page is otherwise structured but has no recognizable
    organic items — caller logs that case for further diagnosis.
    """
    if not html:
        log.warning(
            "yandex html parser: empty input — upstream returned 0 bytes. "
            "If this is Bright Data, the zone is likely Full-JSON; create a "
            "Raw-HTML zone and configure it as `zone_raw` for Bright Data."
        )
        return []
    tree = HTMLParser(html)
    page_title = _text(tree.css_first("title"))

    # Bail early on captcha/anti-bot pages — better to fail the variant than
    # to scrape random links from the chrome of an interstitial.
    if _looks_like_captcha(html, page_title):
        raise ProviderError(
            f"Yandex returned a captcha/anti-bot page (title='{page_title}'). "
            "The proxy IP is likely flagged. For Oxylabs, this often means "
            "the geo_location proxy pool is shared and rate-limited; consider "
            "switching this engine to SerpAPI or Bright Data, or enabling "
            "Oxylabs' render mode (browser rendering) on a slower-but-reliable "
            "tier."
        )

    items = []
    matched_selector = None
    for sel in ITEM_SELECTORS:
        items = tree.css(sel)
        if items:
            matched_selector = sel
            break

    rows: list[ResultRow] = []
    for it in items:
        row = _extract_one(it)
        if row and row["url"]:
            row["position"] = len(rows) + 1
            rows.append(row)
            if len(rows) >= top_n:
                break

    if not rows:
        # No permissive fallback — better an empty run than results scraped
        # from page chrome. The caller logs this with enough context to diagnose.
        log.warning(
            "yandex html parser: 0 results. html_len=%d, title=%r, "
            "matched_selector=%r — page is not a recognizable Yandex SERP. "
            "Likely causes: (1) anti-bot soft block (homepage instead of SERP), "
            "(2) DOM changed (paste 200 chars of html so we can update selectors), "
            "(3) wrong URL/params.",
            len(html), page_title, matched_selector,
        )

    return rows
