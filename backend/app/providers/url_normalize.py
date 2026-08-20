"""Canonicalise SERP URLs before sending them to Ahrefs.

Search engines frequently rank an AMP or parameter-decorated variant of a page.
Ahrefs treats those as DISTINCT URLs with their own (usually empty) link
profile — measured on a real SERP:

    https://www.liga.net/…/boostwin?amp   -> backlinks 0
    https://www.liga.net/…/boostwin       -> backlinks 29

Analysing the raw SERP URL therefore under-reports how strong the ranking page
really is, which is exactly the signal the difficulty score depends on.

Two side benefits: the AMP and canonical variants of one page collapse into a
single Ahrefs target (Ahrefs bills per target), and the per-keyword medians stop
being dragged down by phantom zeros.

We keep this CONSERVATIVE. Only patterns that are unambiguously AMP or pure
tracking are stripped; anything that could be a real, distinct page is left
alone. A wrong "normalisation" would silently measure the wrong page, which is
worse than measuring a weak one.
"""
from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# Query params that mark an AMP variant rather than a different page.
_AMP_QUERY_KEYS = {"amp", "amp_js_v", "amp_gsa", "outputtype", "output"}
_AMP_QUERY_VALUES = {"amp", "amp-type", "amphtml"}

# Pure tracking/analytics params — never change which page is served.
_TRACKING_PREFIXES = ("utm_",)
_TRACKING_KEYS = {
    "gclid", "gclsrc", "dclid", "fbclid", "yclid", "msclkid", "twclid",
    "igshid", "mc_cid", "mc_eid", "_openstat", "ref_src", "spm",
}


def _is_amp_query(key: str, value: str) -> bool:
    k = key.lower()
    v = (value or "").lower()
    if k == "amp":
        # `?amp`, `?amp=1`, `?amp=true` — all AMP markers.
        return True
    if k in {"outputtype", "output"} and v in _AMP_QUERY_VALUES:
        return True
    return k in _AMP_QUERY_KEYS


def _is_tracking(key: str) -> bool:
    k = key.lower()
    return k in _TRACKING_KEYS or any(k.startswith(p) for p in _TRACKING_PREFIXES)


def _strip_amp_path(path: str) -> str:
    """Remove an AMP marker from the path.

    Handles the two common shapes:
      /article/amp/  -> /article/
      /article/amp   -> /article
      /article.amp.html -> /article.html
    A LEADING /amp/ (e.g. /amp/article) is also handled.

    Never strips when it would leave an empty path segment set on a URL that
    had real segments — `/amp/` alone becomes `/`, which is the site root and
    is the correct canonical for an AMP-only homepage variant.
    """
    if not path:
        return path
    trailing_slash = path.endswith("/")
    parts = [p for p in path.split("/") if p != ""]

    # .amp.html / .amp.htm suffix on the final segment.
    if parts:
        last = parts[-1]
        for ext in (".amp.html", ".amp.htm"):
            if last.lower().endswith(ext):
                parts[-1] = last[: -len(ext)] + ext.replace(".amp", "")
                break

    # Drop any standalone "amp" segment (leading or trailing only — an "amp"
    # in the middle could plausibly be part of a real path hierarchy).
    if parts and parts[-1].lower() == "amp":
        parts = parts[:-1]
    elif parts and parts[0].lower() == "amp":
        parts = parts[1:]

    out = "/" + "/".join(parts)
    if trailing_slash and not out.endswith("/"):
        out += "/"
    if out == "//":
        out = "/"
    return out


def normalize_url(url: str) -> str:
    """Return the canonical form of a SERP URL for link-metric lookup.

    Idempotent. Returns the input unchanged if it can't be parsed — a URL we
    don't understand is safer sent as-is than mangled.
    """
    raw = (url or "").strip()
    if not raw:
        return raw
    try:
        parts = urlsplit(raw)
    except ValueError:
        return raw
    if not parts.scheme or not parts.netloc:
        return raw

    netloc = parts.netloc
    # amp.example.com -> example.com. Only when it's the leading label, and
    # only when something remains (never turn amp.com into .com).
    host = netloc.split("@")[-1]
    if host.lower().startswith("amp.") and host.count(".") >= 2:
        netloc = netloc.replace(host, host[4:], 1)

    path = _strip_amp_path(parts.path)

    kept = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not _is_amp_query(k, v) and not _is_tracking(k)
    ]
    query = urlencode(kept)

    # Fragments never affect which page Ahrefs measures.
    return urlunsplit((parts.scheme, netloc, path, query, ""))
