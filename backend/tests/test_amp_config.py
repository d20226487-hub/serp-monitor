"""A rotator's AMP config reveals the past AMP domains SERP Monitor missed
(user, 2026-10-16: "The goal is to know all the past AMPs that we have missed
and mark them in Positions report + send them to the Proxy Checker IF they
appear in SERPs. The script should check which AMP is current based on daily
checks in SERP Monitor, identify the main site looking at "site", then take
only the AMPs that precede from "amps" the last daily checked AMP")."""
from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import proxy_checker as pc
from app.amp_rotator import ConfigSite, amp_hosts, amp_periods, import_config, past_from_config, read_config, remember
from app.db import Base
from app.models import AmpDomainSeen, AmpEndpoint, Job, JobRun, Project, Result
from app.routers import project_positions as pp
from app.visibility import DEFAULT_WEIGHTS

MON, TUE, WED = datetime(2026, 10, 12, 2, 0), datetime(2026, 10, 13, 2, 0), datetime(2026, 10, 14, 2, 0)
SITE, OTHER = "site-one.example", "site-two.example"

#: As a rotator exports it (shape of the user's example).
CONFIG = [
    {"site": SITE, "folder": SITE, "active-amp": "amp-now.example",
     "amps": ["amp-1.example", "amp-2.example", "amp-now.example", "amp-next.example"],
     "verification": {"ok": True, "errors": []}},
    {"site": "elsewhere.example", "folder": "elsewhere.example", "active-amp": "x.example", "amps": ["x.example"],
     "verification": {"ok": True, "errors": []}},
]


class TestReadingTheConfig:
    def test_the_sites_and_their_amp_domains_in_order(self):
        sites, problems = read_config(CONFIG)
        assert sites[0] == ConfigSite(SITE, ["amp-1.example", "amp-2.example", "amp-now.example", "amp-next.example"])
        assert problems == []

    def test_hosts_are_cleaned_and_listed_once(self):
        sites, _ = read_config([{"site": "HTTPS://Site-One.example/", "amps": ["A.example", "a.example", "", 5]}])
        assert sites == [ConfigSite(SITE, ["a.example"])]

    def test_an_entry_it_cannot_read_is_reported_not_guessed(self):
        sites, problems = read_config([{"folder": "x"}, {"site": SITE}, "text", {"site": OTHER, "amps": []}])
        assert [s.site for s in sites] == [OTHER]
        assert problems == ['entry 1: no "site"', f'{SITE}: no "amps" list', 'entry 3: no "site"']

    def test_a_file_that_is_not_a_list_is_refused(self):
        for data in ({"site": SITE}, "x", None):
            with pytest.raises(ValueError):
                read_config(data)


class TestTheRule:
    SITES = [ConfigSite(SITE, ["amp-1.example", "amp-2.example", "amp-now.example", "amp-next.example"])]

    def test_only_the_ones_before_the_last_one_the_daily_check_saw(self):
        pairs, report = past_from_config(self.SITES, [SITE], {SITE: "amp-now.example"})
        assert pairs == [(SITE, "amp-1.example"), (SITE, "amp-2.example")]
        assert report == [{"site": SITE, "status": "ok", "current": "amp-now.example",
                           "past": ["amp-1.example", "amp-2.example"]}]

    def test_the_last_one_seen_decides_even_if_it_is_not_the_newest_listed(self):
        pairs, _ = past_from_config(self.SITES, [SITE], {SITE: "amp-2.example"})
        assert pairs == [(SITE, "amp-1.example")]

    def test_a_site_not_in_the_project(self):
        pairs, report = past_from_config(self.SITES, [OTHER], {})
        assert pairs == [] and report[0]["status"] == "not_in_project"

    def test_a_site_the_daily_check_has_not_seen(self):
        pairs, report = past_from_config(self.SITES, [SITE], {})
        assert pairs == [] and report[0]["status"] == "never_checked"

    def test_a_current_amp_domain_the_list_does_not_have(self):
        pairs, report = past_from_config(self.SITES, [SITE], {SITE: "amp-other.example"})
        assert pairs == [] and report[0] == {"site": SITE, "status": "current_not_listed", "current": "amp-other.example"}

    def test_a_project_domain_in_the_list_is_not_an_amp_domain(self):
        sites = [ConfigSite(SITE, [OTHER, "amp-1.example", "amp-now.example"])]
        pairs, _ = past_from_config(sites, [SITE, OTHER], {SITE: "amp-now.example"})
        assert pairs == [(SITE, "amp-1.example")]


@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    monkeypatch.setattr(pp, "get_visibility_weights", lambda: DEFAULT_WEIGHTS)
    with sessionmaker(bind=engine)() as session:
        yield session


def setup(db):
    project = Project(name="Example", domains=[SITE, OTHER], geos=["KZ"])
    db.add(project)
    db.flush()
    endpoint = AmpEndpoint(project_id=project.id, url="https://rotator.example/api/")
    db.add(endpoint)
    db.flush()
    # What the daily checks saw: yesterday's, then today's.
    remember(db, [(project.id, SITE, "amp-2.example", TUE, TUE), (project.id, SITE, "amp-now.example", WED, WED)])
    db.commit()
    return project, endpoint


class TestImporting:
    def test_the_past_ones_join_the_history_dated_before_the_current_one(self, db):
        project, endpoint = setup(db)
        summary = import_config(db, endpoint, CONFIG, "rotator-config.json")
        assert (summary["sites"], summary["added"], summary["known"]) == (2, 1, 1)   # amp-2 was known already
        assert [r["status"] for r in summary["report"]] == ["ok", "not_in_project"]
        rows = {(s.amp_domain, s.source): (s.first_seen, s.last_seen) for s in db.query(AmpDomainSeen).all()}
        assert rows[("amp-1.example", "config")] == (WED, WED)        # before the day amp-now was first named
        assert ("amp-2.example", "rotator") in rows                   # known from the daily check: stays so
        assert ("amp-next.example", "config") not in rows and ("amp-next.example", "rotator") not in rows
        assert endpoint.config["file_name"] == "rotator-config.json" and endpoint.config["added"] == 1

    def test_uploading_again_adds_nothing_twice(self, db):
        project, endpoint = setup(db)
        import_config(db, endpoint, CONFIG)
        again = import_config(db, endpoint, CONFIG)
        assert (again["added"], again["known"]) == (0, 2)
        assert db.query(AmpDomainSeen).count() == 3

    def test_it_says_where_it_comes_from(self, db):
        project, endpoint = setup(db)
        import_config(db, endpoint, CONFIG)
        periods = amp_periods(db, project)
        assert (periods["amp-1.example"].source, periods["amp-now.example"].source) == ("config", "rotator")

    def test_a_past_one_in_the_serps_is_ours_and_is_sent(self, db):
        project, endpoint = setup(db)
        import_config(db, endpoint, CONFIG)
        assert amp_hosts(db, project)["amp-1.example"] == SITE
        job = Job(name="job", project_id=project.id)
        db.add(job)
        db.flush()
        run = JobRun(job_id=job.id, status="done", started_at=WED)
        db.add(run)
        db.flush()
        db.add(Result(run_id=run.id, keyword="query", engine="google", device="mobile", country_code="kz",
                      position=2, url="https://amp-1.example/", domain="amp-1.example"))
        db.commit()
        hits = pp.project_positions(project.id, None, None, db)["serps"][0]["rows"][0]["hits"]
        assert [(h["domain"], h["amp_of"], h["amp_period"]["source"]) for h in hits] == [("amp-1.example", SITE, "config")]
        assert pc.found_by_geo(db, project) == {"KZ": ["amp-1.example"]}
