"""Opportunity formula validation.

`coerce_opportunity_formula` parses two things: what the user typed, and JSON
that has been sitting in the database since before a field existed. It is
deliberately forgiving — one bad field must not cost the caller a working
formula — so these tests pin down exactly what "forgiving" means.
"""
import pytest

from app.app_settings import (
    DEFAULT_OPPORTUNITY_FORMULA as D,
    coerce_opportunity_formula as coerce,
)


@pytest.mark.parametrize("raw", [{}, None, "nonsense", [], 42])
def test_unusable_input_yields_the_defaults(raw):
    assert coerce(raw) == dict(D)


def test_partial_input_merges_over_the_defaults():
    out = coerce({"ai_too_hard": 0.0})
    assert out["ai_too_hard"] == 0.0
    assert out["ai_low"] == D["ai_low"]
    assert set(out) == set(D)


@pytest.mark.parametrize("field,value", [
    ("ai_too_hard", 99),        # above max
    ("soft_floor", -1),         # below min
    ("bar_dr_ceiling", 0),      # would divide by zero
    ("min_weight", 0.9),        # would make both exponents equal, disabling the slider
    ("balance", float("nan")),  # NaN fails every comparison
    ("ai_medium", "abc"),       # not a number
    ("shortlist", 0),           # a shortlist of nothing
])
def test_out_of_range_falls_back_rather_than_raising(field, value):
    assert coerce({field: value})[field] == D[field]


def test_boundaries_are_inclusive():
    assert coerce({"ai_too_hard": 0.0})["ai_too_hard"] == 0.0
    assert coerce({"ai_too_hard": 1.0})["ai_too_hard"] == 1.0
    assert coerce({"min_weight": 0.45})["min_weight"] == 0.45


def test_numeric_strings_are_accepted():
    # Form inputs arrive as strings.
    assert coerce({"ai_medium": "0.9"})["ai_medium"] == 0.9


def test_none_leaves_the_default_alone():
    # "Not supplied" and "set to nothing" are the same instruction here.
    assert coerce({"ai_low": None})["ai_low"] == D["ai_low"]


def test_volume_curve_is_an_enum():
    assert coerce({"volume_curve": "log"})["volume_curve"] == "log"
    assert coerce({"volume_curve": "bogus"})["volume_curve"] == D["volume_curve"]
    assert coerce({"volume_curve": 5})["volume_curve"] == D["volume_curve"]


def test_unknown_keys_are_dropped():
    assert "nonsense" not in coerce({"nonsense": 1})


def test_shortlist_stays_an_integer():
    out = coerce({"shortlist": 7.9})
    assert isinstance(out["shortlist"], int)
    assert out["shortlist"] == 7


def test_defaults_match_the_shape_the_frontend_expects():
    """Drift here silently drops a field from the editor, or sends one that
    gets discarded. The mirror of this assertion lives in opportunity.test.ts."""
    assert sorted(D) == [
        "ai_hard", "ai_low", "ai_medium", "ai_too_hard", "ai_unknown",
        "balance", "bar_dr_ceiling", "min_weight", "shortlist", "soft_floor",
        "volume_curve",
    ]
