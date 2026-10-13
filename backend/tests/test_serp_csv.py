"""A SERP export uploaded to a project (user, 2026-10-13: "Take only these 4 —
Keywords, GEO, Domain / URL, Position"; everything else in the file is
ignored)."""
import pytest

from app.serp_csv import MissingColumns, countries_index, decode, delimiter, fold, parse, target

COUNTRIES = countries_index([("Azerbaijan", "AZ"), ("Kazakhstan", "KZ"), ("Turkiye", "TR"), ("Kyrgyzstan", "kg")])

#: The user's example, as attached.
EXAMPLE = """Project,Keywords,GEO,Result type,Domain / URL,Tags,Position,SEO,Partner,Neutral,Position score,Quality Status
Example project,casino az,Azerbaijan,Organic,https://url1.com,Tag one,1,No,No,No,0,Bad
Example project,casino az,Azerbaijan,Organic,https://url2.com,Partner,2,No,No,No,0,Bad
Example project,casino az,Azerbaijan,Organic,https://url3.com,SEO,3,Yes,No,No,0.13,Good
Example project,casino az,Azerbaijan,Organic,–,–,7,–,–,–,–,–
Example project,casino az,Azerbaijan,Organic,–,–,8,–,–,–,–,–
"""


class TestTheUsersExample:
    def test_the_four_columns_are_read_and_the_rest_ignored(self):
        got = parse(EXAMPLE, COUNTRIES)
        assert [tuple(r) for r in got.rows] == [
            ("casino az", "AZ", "https://url1.com", "url1.com", 1),
            ("casino az", "AZ", "https://url2.com", "url2.com", 2),
            ("casino az", "AZ", "https://url3.com", "url3.com", 3),
        ]

    def test_a_position_with_nothing_on_it_is_skipped_and_counted(self):
        got = parse(EXAMPLE, COUNTRIES)
        assert got.empty == 2 and got.bad == [] and got.unknown_geos == {}


class TestColumns:
    def test_any_order_any_case_and_other_columns_in_between(self):
        text = "position;extra;DOMAIN/URL;geo;keyword\n4;x;https://a.example/page;KZ;my query\n"
        assert [tuple(r) for r in parse(text, COUNTRIES).rows] == [
            ("my query", "KZ", "https://a.example/page", "a.example", 4)]

    def test_a_missing_column_is_named_with_what_was_found(self):
        with pytest.raises(MissingColumns) as e:
            parse("Keywords,GEO,Position\nq,AZ,1\n", COUNTRIES)
        assert e.value.missing == ["domain/url"] and e.value.found == ["Keywords", "GEO", "Position"]

    def test_an_empty_file_has_no_columns(self):
        with pytest.raises(MissingColumns):
            parse("", COUNTRIES)

    def test_the_delimiter_is_the_one_the_header_uses(self):
        assert delimiter("a,b,c") == "," and delimiter("a;b;c") == ";" and delimiter("a\tb\tc") == "\t"

    def test_a_byte_order_mark_and_quoted_cells(self):
        text = '﻿Keywords,GEO,Domain / URL,Position\n"casino, online",Azerbaijan,"https://a.example",2\n'
        assert parse(text, COUNTRIES).rows[0].keyword == "casino, online"


class TestCountries:
    def test_by_name_by_code_and_whatever_the_case_or_accents(self):
        for geo in ("Azerbaijan", "azerbaijan", " AZERBAIJAN ", "AZ", "az"):
            assert parse(f"Keywords,GEO,Domain / URL,Position\nq,{geo},a.example,1\n", COUNTRIES).rows[0].geo == "AZ"
        for geo in ("Turkiye", "Türkiye", "Turkey"):          # today's spelling, with its accent, and the old one
            assert parse(f"Keywords,GEO,Domain / URL,Position\nq,{geo},a.example,1\n", COUNTRIES).rows[0].geo == "TR"

    def test_a_country_that_is_not_recognised_is_left_out_and_reported_not_guessed(self):
        text = "Keywords,GEO,Domain / URL,Position\nq,Atlantis,a.example,1\nq,Atlantis,b.example,2\nq,,c.example,3\nq,AZ,d.example,4\n"
        got = parse(text, COUNTRIES)
        assert [r.domain for r in got.rows] == ["d.example"]
        assert got.unknown_geos == {"Atlantis": 2, "(empty)": 1}

    def test_codes_are_upper_case_whatever_the_list_had(self):
        assert COUNTRIES[fold("Kyrgyzstan")] == "KG" and COUNTRIES["kg"] == "KG"


class TestTheAddress:
    def test_a_full_address_or_a_bare_domain(self):
        assert target("https://A.example/Path?x=1") == ("https://A.example/Path?x=1", "a.example")
        assert target("a.example") == ("https://a.example", "a.example")
        assert target("www.a.example/page") == ("https://www.a.example/page", "www.a.example")

    def test_what_is_not_one(self):
        for value in ("", "–", "-", "—", "n/a", "two words", "nodot"):
            assert target(value) is None, value


class TestBadRows:
    HEAD = "Keywords,GEO,Domain / URL,Position\n"

    def test_a_position_that_is_not_a_number_from_one_up(self):
        got = parse(self.HEAD + "q,AZ,a.example,first\nq,AZ,b.example,0\nq,AZ,c.example,3\n", COUNTRIES)
        assert [r.domain for r in got.rows] == ["c.example"]
        assert [line for line, _why in got.bad] == [2, 3]

    def test_a_position_written_as_a_decimal(self):
        assert parse(self.HEAD + "q,AZ,a.example,3.0\n", COUNTRIES).rows[0].position == 3

    def test_a_row_without_a_keyword_and_a_cell_that_is_not_an_address(self):
        got = parse(self.HEAD + ",AZ,a.example,1\nq,AZ,not an address,2\n", COUNTRIES)
        assert got.rows == [] and len(got.bad) == 2 and got.empty == 0

    def test_blank_lines_and_short_rows_do_not_stop_the_file(self):
        got = parse(self.HEAD + "\n\nq,AZ\nq,AZ,a.example,1\n", COUNTRIES)
        assert [r.domain for r in got.rows] == ["a.example"]


class TestDecoding:
    def test_utf8_with_or_without_a_mark_and_windows_1251(self):
        text = "Keywords,GEO\nказино,AZ\n"
        assert decode(text.encode("utf-8")) == text
        assert decode(text.encode("utf-8-sig")) == text
        assert decode(text.encode("cp1251")) == text
