"""The domain table sent to the AI judge.

This is the payload the difficulty verdict is formed from, so what it does and
does not say matters more than most rendering code.
"""
from app.ai.serp_difficulty import build_domain_table

METRICS = ["refdomains_dofollow"]

ROWS = [
    {"domain": "liga.net", "metrics": {"refdomains_dofollow": 11820},
     "age": "25.9 y", "registrar": "Internet Invest, Ltd."},
    {"domain": "kzboostwin.net", "metrics": {"refdomains_dofollow": 390},
     "age": "1.3 y", "registrar": "NameCheap, Inc."},
    {"domain": "unknown.io", "metrics": {"refdomains_dofollow": 5}},
]


def test_renders_age_and_registrar_when_known():
    t = build_domain_table(ROWS, METRICS)
    assert "| Age | Registrar |" in t
    assert "| 1.3 y | NameCheap, Inc. |" in t


def test_missing_age_is_a_dash_and_the_dash_is_explained():
    """A bare dash reads as "brand new" to a model, which inverts the signal."""
    t = build_domain_table(ROWS, METRICS)
    assert "| unknown.io | 5 | - | - |" in t
    assert "not that the domain is new" in t


def test_age_alone_still_reaches_the_model():
    # Domain metrics and domain age are separate job switches; requiring both
    # would make age silently do nothing when enabled on its own.
    t = build_domain_table([{"domain": "a.com", "age": "2.0 y"}], [])
    assert "| Domain | Age | Registrar |" in t


def test_nothing_to_say_renders_nothing():
    assert build_domain_table([{"domain": "a.com"}], []) == ""
    assert build_domain_table([], METRICS) == ""


def test_subdomain_age_names_whose_registration_it_is():
    """Without this the model reads uptodown.com's 23 years as the age of a
    throwaway subdomain parked on it."""
    t = build_domain_table([{
        "domain": "melbet.ru.uptodown.com",
        "metrics": {"refdomains_dofollow": 1},
        "age": "23.7 y",
        "age_of": "uptodown.com",
    }], METRICS)
    assert "23.7 y (of uptodown.com)" in t


def test_parent_rows_are_marked_as_such():
    """The registrable parent is listed under its subdomain, not beside it as
    though the two were unrelated competitors."""
    t = build_domain_table([
        {"domain": "melbet.ru.uptodown.com", "metrics": {"refdomains_dofollow": 1},
         "age": "23.7 y", "age_of": "uptodown.com"},
        {"domain": "uptodown.com", "metrics": {"refdomains_dofollow": 84102},
         "indent": True},
    ], METRICS)
    assert "| |_ uptodown.com | 84102 |" in t


def test_pipes_in_a_domain_cannot_break_the_table():
    t = build_domain_table([{"domain": "we|rd.com", "metrics": {}, "age": "1 y"}], METRICS)
    assert "we/rd.com" in t
