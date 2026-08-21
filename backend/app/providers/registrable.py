"""Host → registrable domain (eTLD+1), for WHOIS lookups.

WHOIS is a property of a REGISTRATION, not of a hostname. DataForSEO's WHOIS
database is keyed accordingly: `tribuna.com` is in it, `by.tribuna.com` is not,
and asking for the subdomain simply returns nothing. Our Ahrefs domain pass
deliberately keeps subdomains (mode=subdomains), so hosts have to be reduced
before they can be looked up.

Why the Public Suffix List rather than "last two labels": the naive rule breaks
on exactly the markets this tool targets — `example.com.tr` would reduce to
`com.tr`, `example.co.uk` to `co.uk`, `example.com.br` to `com.br`. Each of
those is a lookup for a domain that cannot exist, so the age would silently go
missing on every Turkish, British and Brazilian result.
"""
from __future__ import annotations

from functools import lru_cache

import tldextract

# suffix_list_urls=() pins us to the snapshot bundled with the package: no HTTP
# fetch on first use, so a cold container cannot hang or fail on a network blip,
# and behaviour is identical across restarts.
#
# include_psl_private_domains=True matters more than it looks. With the private
# section OFF, `spam.blogspot.com` reduces to `blogspot.com` — registered 1999 —
# and a brand-new spam blog would be reported as a 27-year-old domain, which is
# precisely backwards for the signal this feeds. With it ON, the reduction stops
# at `spam.blogspot.com`, WHOIS has nothing, and the age reads "unknown". A
# missing age is honest; an inherited one is a lie. Ordinary domains are
# unaffected: `by.tribuna.com` → `tribuna.com` either way.
_extract = tldextract.TLDExtract(
    suffix_list_urls=(),
    include_psl_private_domains=True,
)


@lru_cache(maxsize=4096)
def registrable_domain(host: str) -> str | None:
    """The registrable domain for `host`, or None when there isn't one.

    Returns None for hosts with no recognised public suffix (bare hostnames,
    IP addresses, junk) — callers should skip those rather than look them up.
    """
    h = (host or "").strip().lower().rstrip(".")
    if not h:
        return None
    if h.startswith("www."):
        h = h[4:]
    result = _extract(h)
    # `top_domain_under_public_suffix` is empty when either half is missing,
    # which is the case for an IP literal or a suffix-less hostname.
    return result.top_domain_under_public_suffix or None


def is_subdomain_of_registrable(host: str) -> bool:
    """True when `host` sits below its registrable domain rather than being it.

    The UI uses this to say whose registration an age actually describes — two
    subdomains of one site share a single WHOIS record, and presenting that as
    each subdomain's own age would overstate what we know.
    """
    reg = registrable_domain(host)
    if not reg:
        return False
    h = (host or "").strip().lower().rstrip(".")
    if h.startswith("www."):
        h = h[4:]
    return h != reg
