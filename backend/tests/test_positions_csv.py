import csv
import io
from datetime import datetime

from app.engine_domains import yandex_domain_for
from app.positions_csv import (
    Page, PageResult, counted_host, grid_rows, list_rows, project_domain, to_csv,
)


def page(**kw):
    base = dict(
        engine="google", device="mobile", country_code="kg", location="Bishkek,Bishkek,Kyrgyzstan",
        language="ru", google_domain="google.com", keyword="casino Zazino",
        checked_at=datetime(2026, 10, 1, 11, 17), share=80.5, slots=2, slots_total=4,
        results=[
            PageResult(1, "zazinoslots.kg", True, "https://zazinoslots.kg", "Zazino slots"),
            PageResult(2, "casino.kg", False, "https://casino.kg/z", "Casino"),
            PageResult(3, "zazino.online", True, "https://zazino.online", "Zazino"),
            PageResult(4, "review.com", False, None, None),
        ],
    )
    base.update(kw)
    return Page(**base)


def parse(text, delimiter):
    assert text.startswith("﻿"), "Excel needs the BOM to read Cyrillic"
    return list(csv.reader(io.StringIO(text[1:]), delimiter=delimiter))


class TestGrid:
    def test_every_site_in_its_position_column_ours_marked(self):
        header, row = grid_rows([page()], "all", "en")
        assert header[-4:] == ["1", "2", "3", "4"]
        assert row[-4:] == ["★ zazinoslots.kg", "casino.kg", "★ zazino.online", "review.com"]

    def test_only_ours_leaves_the_other_slots_empty_and_unmarked(self):
        # Same columns either way, so "which slots do we hold" still reads
        # across the row; the mark is dropped because every filled cell is ours.
        _, row = grid_rows([page()], "ours", "en")
        assert row[-4:] == ["zazinoslots.kg", "", "zazino.online", ""]

    def test_row_carries_the_tables_figures(self):
        header, row = grid_rows([page()], "all", "en", tz_minutes=300)
        got = dict(zip(header, row))
        assert got["Engine"] == "Google" and got["Device"] == "Mobile"
        assert got["Country"] == "KG" and got["Location"] == "Bishkek"
        assert got["Monopolisation, %"] == "80.5"
        assert got["Our positions"] == "1 zazinoslots.kg, 3 zazino.online"
        assert (got["Our results"], got["Results on page"]) == ("2", "4")
        # Stored UTC, written in the reader's clock (UTC+5 here).
        assert got["Checked"] == "2026-10-01 16:17"

    def test_columns_reach_the_deepest_position_and_holes_stay_empty(self):
        # rank_absolute leaves holes where ads sat; a hole is an empty cell,
        # not a shifted row.
        short = page(keyword="a", results=[PageResult(1, "x.com", False, None, None)])
        deep = page(keyword="b", results=[PageResult(2, "y.com", False, None, None),
                                          PageResult(7, "z.com", False, None, None)])
        header, r1, r2 = grid_rows([short, deep], "all", "en")
        assert header[-1] == "7"
        assert r1[-7:] == ["x.com", "", "", "", "", "", ""]
        assert r2[-7:] == ["", "y.com", "", "", "", "", "z.com"]

    def test_a_query_we_do_not_rank_on_still_has_its_row(self):
        miss = page(share=0.0, slots=0, results=[PageResult(1, "other.com", False, None, None)])
        _, row = grid_rows([miss], "ours", "en")
        assert row[6] == "casino Zazino" and row[8] == ""


class TestList:
    def test_a_row_per_position_with_ours_flag(self):
        rows = list_rows([page()], "all", "ru")
        assert rows[0][7:10] == ["Позиция", "Сайт", "Наш сайт"]
        assert [(r[7], r[8], r[9]) for r in rows[1:]] == [
            ("1", "zazinoslots.kg", "да"), ("2", "casino.kg", "нет"),
            ("3", "zazino.online", "да"), ("4", "review.com", "нет"),
        ]

    def test_only_ours(self):
        rows = list_rows([page()], "ours", "en")
        assert [r[8] for r in rows[1:]] == ["zazinoslots.kg", "zazino.online"]


class TestFormat:
    def test_russian_file_opens_in_russian_excel(self):
        # ";" between fields and a decimal comma: with "," a Russian-locale
        # Excel puts every row in column A, and "10.1" becomes a date.
        rows = parse(to_csv(grid_rows([page()], "all", "ru"), "ru"), ";")
        assert rows[0][:2] == ["Поисковик", "Устройство"]
        assert dict(zip(rows[0], rows[1]))["Монополизация, %"] == "80,5"
        assert rows[1][0] == "Google"

    def test_english_file_uses_commas_and_points(self):
        rows = parse(to_csv(grid_rows([page()], "all", "en"), "en"), ",")
        assert dict(zip(rows[0], rows[1]))["Monopolisation, %"] == "80.5"

    def test_a_separator_inside_a_cell_is_quoted_not_split(self):
        rows = parse(to_csv(list_rows([page(keyword="казино; бонус")], "all", "ru"), "ru"), ";")
        assert rows[1][6] == "казино; бонус"

    def test_whole_numbers_print_without_a_decimal(self):
        _, row = grid_rows([page(share=100.0)], "all", "ru")
        assert row[7] == "100"

    def test_yandex_in_russian(self):
        _, row = grid_rows([page(engine="yandex", google_domain=None)], "all", "ru")
        assert row[0] == "Яндекс" and row[5] == ""


class TestYandexDomain:
    """API-provider Yandex rows store no domain; the export names the one the
    request went to, from the same table the request is built with."""

    def test_countries_with_their_own_yandex(self):
        assert yandex_domain_for("RU") == "yandex.ru"
        assert yandex_domain_for("kz") == "yandex.kz"
        assert yandex_domain_for("uz") == "yandex.uz"

    def test_a_country_without_one_is_asked_on_yandex_com(self):
        # yandex.kg has no DNS at all.
        assert yandex_domain_for("kg") == "yandex.com"
        assert yandex_domain_for(None) == "yandex.com"

    def test_the_domain_reaches_the_file(self):
        header, row = grid_rows([page(engine="yandex", google_domain="ya.ru")], "all", "ru")
        assert dict(zip(header, row))["Домен поисковика"] == "ya.ru"


class TestWhichSiteIsOurs:
    def test_counts_the_displayed_host_only_when_the_job_prefers_it(self):
        assert counted_host("d1.cloudfront.net", "by.tribuna.com", True) == "by.tribuna.com"
        assert counted_host("d1.cloudfront.net", "by.tribuna.com", False) == "d1.cloudfront.net"
        # Asked for the displayed host, engine reported none: the link it is.
        assert counted_host("Example.COM", None, True) == "example.com"

    def test_www_matches_a_subdomain_does_not(self):
        domains = ["zazino.kg"]
        assert project_domain("www.zazino.kg", domains) == "zazino.kg"
        assert project_domain("ZAZINO.kg", domains) == "zazino.kg"
        assert project_domain("kz.zazino.kg", domains) is None
