"""Host -> registrable domain (eTLD+1).

The reduction WHOIS lookups depend on. Getting it wrong does not raise — it
queries a domain that cannot exist, and the age silently goes missing.
"""
import pytest

from app.providers.registrable import is_subdomain_of_registrable, registrable_domain


@pytest.mark.parametrize("host,expected", [
    ("kzboostwin.net", "kzboostwin.net"),
    ("by.tribuna.com", "tribuna.com"),
    ("boostwin.sarm.am", "sarm.am"),
    ("www.liga.net", "liga.net"),
    ("WWW.Liga.NET", "liga.net"),
    ("liga.net.", "liga.net"),
    ("  liga.net  ", "liga.net"),
])
def test_ordinary_hosts(host, expected):
    assert registrable_domain(host) == expected


@pytest.mark.parametrize("host,expected", [
    # "Last two labels" would give com.tr / co.uk / com.br here, none of which
    # is a real registration. These are the markets this tool actually targets.
    ("shop.example.com.tr", "example.com.tr"),
    ("a.b.example.co.uk", "example.co.uk"),
    ("x.example.com.br", "example.com.br"),
    ("deep.a.b.example.com", "example.com"),
])
def test_multi_label_suffixes(host, expected):
    assert registrable_domain(host) == expected


@pytest.mark.parametrize("host", [
    "spam.blogspot.com",
    "evil.github.io",
])
def test_free_hosting_does_not_inherit_the_platform(host):
    """A new spam blog must not report blogspot.com's 1999 registration.

    PSL private domains stop the reduction at the user's own subdomain, so
    WHOIS finds nothing and the age reads "unknown" — which is true. Inheriting
    the platform's date would say 27 years old, which is the opposite.
    """
    assert registrable_domain(host) == host


@pytest.mark.parametrize("host", ["192.168.1.1", "localhost", "", "   ", "no-suffix"])
def test_hosts_with_no_registration(host):
    assert registrable_domain(host) is None


def test_subdomain_detection():
    assert is_subdomain_of_registrable("by.tribuna.com") is True
    assert is_subdomain_of_registrable("tribuna.com") is False
    # www is stripped before comparing, so it is not treated as a subdomain.
    assert is_subdomain_of_registrable("www.liga.net") is False
    assert is_subdomain_of_registrable("192.168.1.1") is False
