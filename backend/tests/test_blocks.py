"""The Blocks tab: which domains are in the SERPs, and the status each proxy
gives them (user, 2026-10-06: "understand which domains are blocked and are in
the SERPs" — and "we do not show blocked or not blocked we display the status
by each proxy")."""
from datetime import datetime

from app.blocks import (
    DEMO_NOT_PASS, NOT_PASS, PASS, UNCHECKED, counts, demo_statuses, in_serps, kind_of, ordered,
    proxies_by_geo,
)
from app.proxy_checker import read_answer


def serp(engine, country, rows):
    return {"engine": engine, "device": "mobile", "country_code": country, "rows": rows}


def row(keyword, when, *hits):
    return {"keyword": keyword, "checked_at": when,
            "hits": [{"domain": d, "position": p} for d, p in hits]}


MON, TUE = datetime(2026, 10, 5, 7, 0), datetime(2026, 10, 6, 7, 0)

POSITIONS = {"serps": [
    serp("google", "kg", [
        row("zazino", MON, ("zazino.kg", 1), ("lucky-zazino.pro", 4)),
        row("zazino вход", TUE, ("zazino.kg", 3)),
        row("zazino бонус", TUE),                              # checked, none of ours on it
    ]),
    serp("yandex", "kg", [row("Zazino", TUE, ("zazino.kg", 2))]),
    serp("google", "kz", [row("zazino", MON, ("zazino.kg", 7))]),
    serp("google", "ru", [row("zazino", MON, ("zazino.kg", 1))]),
    serp("google", None, [row("zazino", MON, ("zazino.kg", 1))]),
]}


class TestInSerps:
    def by_key(self, geos=("KG", "KZ")):
        return {(r["geo"], r["domain"]): r for r in in_serps(POSITIONS, list(geos))}

    def test_one_row_per_country_and_domain(self):
        assert set(self.by_key()) == {("KG", "zazino.kg"), ("KG", "lucky-zazino.pro"), ("KZ", "zazino.kg")}

    def test_a_country_that_is_not_one_of_the_projects_is_left_out(self):
        assert not any(geo == "RU" for geo, _ in self.by_key())
        assert ("RU", "zazino.kg") in self.by_key(geos=("KG", "KZ", "RU"))

    def test_a_serp_without_a_country_has_no_geo(self):
        assert all(geo for geo, _ in self.by_key(geos=("KG", "KZ", "RU", "")))

    def test_keywords_are_counted_once_whatever_the_engine_or_the_case(self):
        kg = self.by_key()[("KG", "zazino.kg")]
        # "zazino" on Google and "Zazino" on Yandex are one keyword; "zazino вход" is another.
        assert kg["keywords"] == 2
        assert kg["engines"] == ["google", "yandex"]

    def test_the_best_position_and_where_it_was(self):
        kg = self.by_key()[("KG", "zazino.kg")]
        assert (kg["best_position"], kg["best_keyword"], kg["best_engine"]) == (1, "zazino", "google")
        assert self.by_key()[("KZ", "zazino.kg")]["best_position"] == 7

    def test_last_seen_is_the_newest_page_it_was_on(self):
        assert self.by_key()[("KG", "zazino.kg")]["last_seen"] == TUE
        assert self.by_key()[("KG", "lucky-zazino.pro")]["last_seen"] == MON

    def test_nothing_found_is_no_rows(self):
        assert in_serps({"serps": []}, ["KG"]) == []
        assert in_serps(POSITIONS, []) == []


#: The Proxy Checker's answer, as the user gave it (2026-10-06).
ANSWER = {
    "example1.com": {"KG - Provider A": "PASS", "KG - Provider B": "PASS", "KG - Provider C": "PASS"},
    "example2.com": {"KG - Provider A": "PASS", "KG - Provider B": "PASS", "KG - Provider C": "PASS"},
}


class TestReadingAnAnswer:
    def test_the_users_example_a_status_per_proxy_per_domain(self):
        assert read_answer(ANSWER, ["example1.com", "example2.com"]) == ANSWER

    def test_proxy_names_and_statuses_are_kept_as_given(self):
        data = {"example1.com": {"KG - Provider A": "PASS", "KG - Provider B": "Some New Status "}}
        assert read_answer(data, ["example1.com"]) == {
            "example1.com": {"KG - Provider A": "PASS", "KG - Provider B": "Some New Status"}}

    def test_any_number_of_proxies(self):
        one = {"example1.com": {"KG - Provider B": "PASS"}}
        many = {"example1.com": {f"KG - Proxy {i}": "PASS" for i in range(12)}}
        assert read_answer(one, ["example1.com"]) == one
        assert len(read_answer(many, ["example1.com"])["example1.com"]) == 12

    def test_the_domain_is_matched_whatever_its_case(self):
        got = read_answer({"Example1.COM": {"KG - Provider B": "PASS"}}, ["example1.com"])
        assert got == {"example1.com": {"KG - Provider B": "PASS"}}

    def test_a_domain_that_was_not_asked_about_is_not_believed(self):
        assert read_answer(ANSWER, ["example1.com"]) == {"example1.com": ANSWER["example1.com"]}
        assert read_answer(ANSWER, ["zazino.kg"]) == {}

    def test_an_answer_of_another_shape_records_nothing(self):
        for data in (None, "ok", [], {"status": "ok"}, {"example1.com": "PASS"}, {"example1.com": {}},
                     {"example1.com": {"KG - Provider B": None}}, {"example1.com": {"KG - Provider B": {"x": 1}}}):
            assert read_answer(data, ["example1.com"]) == {}, data


class TestKinds:
    """Used to order and filter the rows — never shown as a label."""

    def test_all_pass_one_not_and_no_report(self):
        assert kind_of({"KG - Provider B": "PASS", "KG - Provider C": "pass "}) == PASS
        assert kind_of({"KG - Provider B": "PASS", "KG - Provider C": "FAIL"}) == NOT_PASS
        assert kind_of({"KG - Provider B": "anything else"}) == NOT_PASS
        assert kind_of(None) == UNCHECKED and kind_of({}) == UNCHECKED

    def test_trouble_first_most_proxies_failing_on_top_then_by_position(self):
        def r(domain, proxies, best):
            return {"geo": "KG", "domain": domain, "proxies": proxies, "kind": kind_of(proxies), "best_position": best}

        rows = [
            r("fine-1", {"a": "PASS", "b": "PASS"}, 1),
            r("one-down-9", {"a": "FAIL", "b": "PASS"}, 9),
            r("unchecked-2", None, 2),
            r("both-down-5", {"a": "FAIL", "b": "FAIL"}, 5),
            r("one-down-3", {"a": "PASS", "b": "FAIL"}, 3),
        ]
        assert [x["domain"] for x in ordered(rows)] == [
            "both-down-5", "one-down-3", "one-down-9", "unchecked-2", "fine-1"]
        assert counts(rows) == {"in_serps": 5, NOT_PASS: 3, PASS: 1, UNCHECKED: 1}

    def test_each_country_has_its_own_proxies_as_columns(self):
        rows = [
            {"geo": "KG", "proxies": {"KG - Provider B": "PASS", "KG - Provider A": "PASS"}},
            {"geo": "KG", "proxies": {"KG - Provider C": "PASS"}},
            {"geo": "KZ", "proxies": {"KZ - Provider A": "PASS"}},
            {"geo": "UZ", "proxies": None},
        ]
        assert proxies_by_geo(rows) == {
            "KG": ["KG - Provider A", "KG - Provider B", "KG - Provider C"], "KZ": ["KZ - Provider A"], "UZ": []}


class TestDemo:
    def test_demo_rows_have_the_answers_own_shape_and_are_the_same_on_every_visit(self):
        now = datetime(2026, 10, 6, 12, 0)
        first = [demo_statuses("KG", f"site-{i}.example", now) for i in range(300)]
        assert first == [demo_statuses("KG", f"site-{i}.example", now) for i in range(300)]
        kinds = {kind_of(p) for p, _ in first}
        assert kinds == {PASS, NOT_PASS, UNCHECKED}        # every kind of row shows up
        failing = set()
        for proxies, when in first:
            assert (when is None) == (proxies is None)
            if proxies:
                assert when < now
                assert list(proxies) == ["KG - Demo 1", "KG - Demo 2", "KG - Demo 3"]
                assert set(proxies.values()) <= {"PASS", DEMO_NOT_PASS}
                failing.add(sum(s != "PASS" for s in proxies.values()))
        # Rows with one proxy down and rows with all of them down both appear.
        assert {1, 3} <= failing
