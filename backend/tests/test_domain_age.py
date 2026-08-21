"""Domain age: parsing registration dates and turning them into an age.

Covers both sources, since they hand back different formats — DataForSEO's
"2000-09-26 11:00:01 +00:00" and RDAP's ISO-8601 "2026-08-16T19:12:11.518Z".
"""
from datetime import datetime, timezone

import pytest

from app.providers.dataforseo_whois import (
    _parse_dt as dfs_parse,
    domain_age_days,
    format_age,
)
from app.providers.rdap import _parse_dt as rdap_parse, _registrar_of, _to_record

NOW = datetime(2026, 8, 21, tzinfo=timezone.utc)


class TestDataForSeoDates:
    def test_full_timestamp(self):
        assert dfs_parse("2000-09-26 11:00:01 +00:00") == datetime(
            2000, 9, 26, 11, 0, 1, tzinfo=timezone.utc
        )

    def test_date_only_is_salvaged(self):
        """Some registrars report no time. The date is all the age needs."""
        assert dfs_parse("2023-05-09") == datetime(2023, 5, 9, tzinfo=timezone.utc)

    @pytest.mark.parametrize("raw", ["not a date", "", None, 12345])
    def test_unparseable(self, raw):
        assert dfs_parse(raw) is None


class TestRdapDates:
    def test_iso_with_fractional_seconds(self):
        assert rdap_parse("2026-08-16T19:12:11.518Z") == datetime(
            2026, 8, 16, 19, 12, 11, 518000, tzinfo=timezone.utc
        )

    def test_numeric_offset_is_preserved(self):
        assert rdap_parse("2013-02-27T09:47:42+02:00").utcoffset().seconds == 7200

    def test_naive_date_is_assumed_utc(self):
        assert rdap_parse("2026-08-16").tzinfo is timezone.utc

    @pytest.mark.parametrize("raw", ["nope", "", None])
    def test_unparseable(self, raw):
        assert rdap_parse(raw) is None

    def test_registrar_from_jcard(self):
        assert _registrar_of({"entities": [{
            "roles": ["registrar"],
            "vcardArray": ["vcard", [
                ["version", {}, "text", "4.0"],
                ["fn", {}, "text", "NameCheap, Inc."],
            ]],
        }]}) == "NameCheap, Inc."

    def test_registrar_absent(self):
        assert _registrar_of({"entities": [{"roles": ["technical"]}]}) is None
        assert _registrar_of({}) is None

    def test_record_without_a_registration_event_is_rejected(self):
        """A 200 carrying no registration date has nothing we need.

        Returning None lets the caller fall through to the paid source rather
        than caching a hit with no age in it.
        """
        assert _to_record("x.com", {
            "events": [{"eventAction": "expiration", "eventDate": "2027-01-01T00:00:00Z"}],
        }) is None


class TestAge:
    def test_counts_whole_days(self):
        # A doorway registered 2025-04-22 19:56, measured at 2026-08-21 00:00:
        # the part-day does not count.
        created = dfs_parse("2025-04-22 19:56:44 +00:00")
        assert domain_age_days(created, NOW) == 485

    def test_unknown_stays_unknown(self):
        assert domain_age_days(None, NOW) is None

    def test_future_registration_clamps_to_zero(self):
        assert domain_age_days(dfs_parse("2027-01-01 00:00:00 +00:00"), NOW) == 0

    def test_naive_timestamps_are_treated_as_utc(self):
        # SQLite hands back naive datetimes; comparing them raw raises.
        assert domain_age_days(datetime(2025, 8, 21), NOW) == 365


class TestFormatAge:
    @pytest.mark.parametrize("days,expected", [
        (0, "0 d"),
        (12, "12 d"),
        (30, "30 d"),
        (31, "1 mo"),
        (120, "4 mo"),
        (485, "1.3 y"),      # decimal below ten years, where it changes the read
        (9470, "26 y"),      # no decimal past ten, where it is noise
        (None, ""),
    ])
    def test_compact_forms(self, days, expected):
        assert format_age(days) == expected
