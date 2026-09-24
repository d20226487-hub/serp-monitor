"""Turning a pasted block of domains into a clean host list.

People paste what they have: a column out of a spreadsheet, a list of URLs
copied from a browser, a comma-separated line from an email. All three mean the
same thing, so the parser accepts any of them rather than asking for a format.

Normalisation matches what the SERP side already does, because these hosts will
be compared against result URLs: lowercase, scheme and path removed, leading
"www." dropped. Subdomains are KEPT — kz.example.com and example.com are
different targets and position tracking has to tell them apart.
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit

# Split on anything that cannot appear inside a host: whitespace, commas,
# semicolons, pipes. Tabs and newlines are the spreadsheet cases.
_SEPARATORS = re.compile(r"[\s,;|]+")

# A host is labels joined by dots. Deliberately permissive about the TLD — new
# gTLDs keep appearing and rejecting an unknown one would silently drop exactly
# the doorway domains this tool exists to watch.
_HOST = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$")


def normalize_domain(raw: str) -> str | None:
    """One pasted token as a bare host, or None when it is not one."""
    s = (raw or "").strip().strip('"\'').lower()
    if not s:
        return None
    # A URL, or something with a path glued on: let urlsplit find the host.
    # It only populates .netloc when a scheme is present, hence the prefix.
    if "/" in s or "://" in s:
        s = urlsplit(s if "://" in s else f"//{s}").netloc or s
    # Credentials and port are not part of the identity we compare on.
    s = s.rsplit("@", 1)[-1].split(":", 1)[0]
    if s.startswith("www."):
        s = s[4:]
    s = s.strip(".")
    # A trailing dot is a legal FQDN; an internal empty label is not.
    return s if _HOST.match(s) else None


def parse_domains(text: str) -> tuple[list[str], list[str]]:
    """Split a paste into (clean hosts, tokens that were not hosts).

    Order is the order pasted, first occurrence wins, duplicates dropped — a
    list someone arranged by importance should come back arranged the same way.
    The rejects are returned rather than discarded so the UI can show what it
    refused instead of silently keeping fewer domains than were pasted.
    """
    seen: set[str] = set()
    out: list[str] = []
    bad: list[str] = []
    for token in _SEPARATORS.split(text or ""):
        if not token.strip():
            continue
        host = normalize_domain(token)
        if host is None:
            bad.append(token.strip())
            continue
        if host in seen:
            continue
        seen.add(host)
        out.append(host)
    return out, bad


def clean_domain_list(values: list[str] | None) -> list[str]:
    """Normalise a list that arrived as JSON rather than as a paste.

    The API is not only driven by our own form, and a domain stored with a
    scheme would never match a SERP host at tracking time.
    """
    seen: set[str] = set()
    out: list[str] = []
    for v in values or []:
        host = normalize_domain(str(v))
        if host and host not in seen:
            seen.add(host)
            out.append(host)
    return out
