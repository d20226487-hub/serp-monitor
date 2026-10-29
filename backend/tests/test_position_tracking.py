"""Position Tracking (user, 2026-10-29: "more granular position tracking like
in rank trackers"): the distribution of the project's positions by top N per
SERP against the previous period, and a row per ranking URL."""
from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import Job, JobRun, Project, Result
from app.routers import project_positions as pp
from app.visibility import DEFAULT_WEIGHTS

MON, TUE, WED, THU = (datetime(2026, 10, d, 7, 0) for d in (5, 6, 7, 8))
SITE, OTHER, STRANGER = "site-one.example", "site-two.example", "stranger.example"


@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    monkeypatch.setattr(pp, "get_visibility_weights", lambda: DEFAULT_WEIGHTS)
    with sessionmaker(bind=engine)() as session:
        yield session


def project(db):
    p = Project(name="Example", domains=[SITE, OTHER])
    db.add(p)
    db.flush()
    job = Job(name="job", project_id=p.id, keywords=["casino"])
    db.add(job)
    db.commit()
    return p, job


def run(db, job, when, results, country="kz", depth=10):
    """A finished run: `results` are (keyword, position, url). The page is
    filled to `depth` with a stranger, so it reads as that deep."""
    r = JobRun(job_id=job.id, status="done", started_at=when, provider="csv")
    db.add(r)
    db.flush()
    taken = {(k, pos) for k, pos, _url in results}
    for keyword, position, url in results:
        db.add(Result(run_id=r.id, keyword=keyword, engine="google", device="mobile", country_code=country,
                      language="ru", google_domain="google.kz", position=position, url=url,
                      domain=url.split("/")[2]))
    for keyword in {k for k, _p, _u in results}:
        for position in range(1, depth + 1):
            if (keyword, position) not in taken:
                db.add(Result(run_id=r.id, keyword=keyword, engine="google", device="mobile",
                              country_code=country, language="ru", google_domain="google.kz",
                              position=position, url=f"https://{STRANGER}/{position}", domain=STRANGER))
    db.commit()
    return r


def track(db, p, start=TUE, end=THU, prev=(MON, TUE)):
    return pp.project_position_tracking(
        p.id, start.isoformat(), end.isoformat(),
        prev[0].isoformat() if prev else None, prev[1].isoformat() if prev else None, db)


def row(data, url, keyword="casino"):
    return next(r for r in data["rows"] if r["url"] == url and r["keyword"] == keyword)


A, B, O = f"https://{SITE}/a", f"https://{SITE}/b", f"https://{OTHER}/"


class TestDistribution:
    def test_every_position_counts_in_every_top_it_is_in(self):
        assert pp.distribution([1, 4, 9]) == {"1": 1, "3": 1, "5": 2, "10": 3, "20": 3, "30": 3, "50": 3, "100": 3}
        assert pp.TOP_N[0] == 1
        assert pp.distribution([]) == {str(n): 0 for n in pp.TOP_N}

    def test_by_the_latest_check_of_each_keyword_against_the_previous_period(self, db):
        p, job = project(db)
        run(db, job, MON, [("casino", 5, A)])
        run(db, job, TUE, [("casino", 3, A), ("casino", 8, O)])
        run(db, job, WED, [("casino", 1, A), ("casino", 9, B)])
        serp = track(db, p)["serps"][0]
        # Wednesday's page: #1 and #9, both the project's — two positions.
        assert (serp["engine"], serp["country_code"], serp["keywords"], serp["depth"]) == ("google", "kz", 1, 10)
        assert serp["now"] == {"1": 1, "3": 1, "5": 1, "10": 2, "20": 2, "30": 2, "50": 2, "100": 2}
        # Monday — the previous period — had #5.
        assert serp["before"] == {"1": 0, "3": 0, "5": 1, "10": 1, "20": 1, "30": 1, "50": 1, "100": 1}
        # Tuesday — the check before the latest — had #3 and #8.
        assert serp["before_check"] == {"1": 0, "3": 1, "5": 1, "10": 2, "20": 2, "30": 2, "50": 2, "100": 2}
        # The keyword's best place: #1 now, #3 at the previous check, #5 in
        # the previous period.
        assert serp["keywords_best"] == [{"keyword": "casino", "now": 1, "had_check": True, "check": 3,
                                          "had_period": True, "period": 5}]

    def test_no_check_in_the_previous_period_is_nothing_to_compare_with(self, db):
        p, job = project(db)
        run(db, job, WED, [("casino", 2, A)])
        data = track(db, p)
        assert data["serps"][0]["before"] is None and data["has_previous_period"] is False
        # Nor an earlier check: nothing to compare with that way either.
        assert data["serps"][0]["before_check"] is None

    def test_one_table_row_per_serp(self, db):
        p, job = project(db)
        run(db, job, WED, [("casino", 2, A)], country="kz")
        run(db, job, WED, [("casino", 4, A)], country="kg")
        assert [(s["country_code"], s["now"]["3"]) for s in track(db, p)["serps"]] == [("kg", 0), ("kz", 1)]


class TestRows:
    @pytest.fixture
    def data(self, db):
        p, job = project(db)
        run(db, job, MON, [("casino", 5, A)])
        run(db, job, TUE, [("casino", 3, A), ("casino", 8, O)])
        run(db, job, WED, [("casino", 1, A), ("casino", 9, B)])
        return track(db, p)

    def test_one_per_url_of_the_project_and_none_for_others(self, data):
        assert sorted(r["url"] for r in data["rows"]) == sorted([A, B, O])

    def test_best_and_average_over_the_period_latest_as_the_position(self, data):
        a = row(data, A)
        assert (a["position"], a["best"], a["average"], a["checks"], a["ranked_in"]) == (1, 1, 2.0, 2, 2)
        assert a["position_sum"] == 4
        assert [x["position"] for x in a["readings"]] == [3, 1]
        assert (a["domain"], a["amp_of"]) == (SITE, None)

    def test_compared_with_the_previous_check_and_the_previous_period(self, data):
        a = row(data, A)
        assert (a["previous_check"]["at"], a["previous_check"]["position"]) == (TUE, 3)
        assert (a["previous_period"]["at"], a["previous_period"]["position"]) == (MON, 5)

    def test_a_url_new_since_the_previous_check(self, data):
        b = row(data, B)
        assert b["position"] == 9 and b["previous_check"] == {"at": TUE, "position": None}

    def test_a_url_gone_since_the_previous_check_is_still_a_row(self, data):
        o = row(data, O)
        assert (o["position"], o["best"]) == (None, 8)
        assert [x["position"] for x in o["readings"]] == [8, None]
        assert o["previous_check"]["position"] == 8


class TestThePreviousCheck:
    def test_from_before_the_period_when_the_period_has_one_check(self, db):
        p, job = project(db)
        run(db, job, MON, [("casino", 4, A)])
        run(db, job, WED, [("casino", 2, A)])
        a = row(track(db, p, start=WED, prev=None), A)
        assert a["previous_check"] == {"at": MON, "position": 4} and a["previous_period"] is None

    def test_none_for_a_keyword_never_checked_before(self, db):
        p, job = project(db)
        run(db, job, WED, [("casino", 2, A)])
        assert row(track(db, p), A)["previous_check"] is None

    def test_a_url_only_at_the_previous_period_is_a_row_that_dropped_out(self, db):
        p, job = project(db)
        run(db, job, MON, [("casino", 6, O)])
        run(db, job, WED, [("casino", 2, A)])
        o = row(track(db, p), O)
        assert (o["position"], o["best"], o["previous_period"]["position"]) == (None, None, 6)


def test_nothing_in_the_period(db):
    p, _job = project(db)
    data = track(db, p)
    assert (data["serps"], data["rows"], data["thresholds"]) == ([], [], list(pp.TOP_N))


class TestOnePagePerRow:
    def test_a_front_page_with_and_without_its_slash_is_one_page(self):
        assert pp.page_url("https://Site-One.example") == pp.page_url("https://site-one.example/") == "https://site-one.example/"
        assert pp.page_url("https://site-one.example/a?x=1#top") == "https://site-one.example/a?x=1"
        assert pp.page_url("not a url") == "not a url"

    def test_two_spellings_from_two_checks_are_one_row(self, db):
        p, job = project(db)
        run(db, job, TUE, [("casino", 4, f"https://{SITE}")])
        run(db, job, WED, [("casino", 2, f"https://{SITE}/")])
        rows = track(db, p)["rows"]
        assert [(r["url"], [x["position"] for x in r["readings"]]) for r in rows] == [(f"https://{SITE}/", [4, 2])]


class TestKeywordsBest:
    def test_a_keyword_gone_from_the_page_and_one_never_checked_before(self, db):
        p, job = project(db)
        run(db, job, TUE, [("casino", 2, A)])
        run(db, job, WED, [("casino", 1, f"https://{STRANGER}/x"), ("bonus", 4, A)])
        best = {k["keyword"]: k for k in track(db, p, prev=None)["serps"][0]["keywords_best"]}
        # casino: #2 at the previous check, none of the project's on the page now.
        assert best["casino"] == {"keyword": "casino", "now": None, "had_check": True, "check": 2,
                                  "had_period": False, "period": None}
        # bonus: first checked on Wednesday — nothing to compare with.
        assert (best["bonus"]["now"], best["bonus"]["had_check"]) == (4, False)


class TestClusters:
    def test_rows_carry_their_keywords_cluster(self, db):
        p, job = project(db)
        p.keyword_clusters = {"casino": "Brand"}
        db.commit()
        run(db, job, WED, [("casino", 2, A), ("bonus", 3, A)])
        data = track(db, p)
        assert data["has_clusters"] is True and data["clusters"] == ["Brand"]
        assert {r["keyword"]: r["cluster"] for r in data["rows"]} == {"casino": "Brand", "bonus": None}

    def test_a_project_with_clusters_has_them_whatever_the_period_checked(self, db):
        p, job = project(db)
        p.keyword_clusters = {"slots": "Games", "casino": "brand"}
        db.commit()
        run(db, job, WED, [("bonus", 3, A)])
        data = track(db, p)
        assert (data["has_clusters"], data["clusters"]) == (True, ["brand", "Games"])
        assert pp.project_position_tracking(p.id, THU.isoformat(), None, None, None, db)["has_clusters"] is True

    def test_none_without_clusters(self, db):
        p, job = project(db)
        run(db, job, WED, [("casino", 2, A)])
        assert track(db, p)["has_clusters"] is False


class TestLetterCase:
    """User, 2026-10-29: "lower and upper cases should be counted as one"."""

    def test_a_url_in_two_cases_is_one_page(self):
        assert pp.page_url("https://Site-One.example/Casino") == pp.page_url("https://site-one.example/casino")

    def test_a_keyword_in_two_cases_is_one_row_named_as_its_latest_check_spelled_it(self, db):
        p, job = project(db)
        run(db, job, TUE, [("Casino Online", 4, A)])
        run(db, job, WED, [("casino online", 2, A)])
        rows = track(db, p)["rows"]
        assert [(r["keyword"], [x["position"] for x in r["readings"]]) for r in rows] == [("casino online", [4, 2])]

    def test_both_spellings_in_one_run_are_counted_once(self, db):
        p, job = project(db)
        run(db, job, WED, [("Casino", 2, A), ("casino", 2, A)])
        serp = track(db, p)["serps"][0]
        assert (serp["keywords"], serp["now"]["3"]) == (1, 1)
