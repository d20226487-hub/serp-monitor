"""AMP domains count in positions (user, 2026-10-13: "Imagine we have not
added the today's AMP domains to the project BUT they appear in SERPs. Then
they should be counted in positions as well").

A project lists its sites, never their AMP domains — a rotator names a new one
every day. So every AMP host a rotator has EVER named for a project domain is
kept, and a result on one is a result of the project's.
"""
import csv
import io
from datetime import datetime

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import amp_rotator
from app import proxy_checker as pc
from app.amp_rotator import AmpPeriod, amp_hosts, amp_periods, as_dates, owners, periods, remember, remember_current
from app.blocks import in_serps
from app.db import Base
from app.models import (
    AmpDomain, AmpDomainSeen, AmpEndpoint, DomainProxyCheckLog, Job, JobRun, Project, Result,
)
from app.positions_csv import Ours, PageResult, grid_rows, list_rows, ours_index
from app.routers import project_positions as pp
from app.visibility import DEFAULT_WEIGHTS

MON, TUE, WED = datetime(2026, 10, 5, 7, 0), datetime(2026, 10, 6, 7, 0), datetime(2026, 10, 7, 7, 0)
SITE, OTHER = "site-one.example", "site-two.example"


# --------------------------------------------------------------------------
# Whose a host is
# --------------------------------------------------------------------------

class TestOwners:
    def test_an_amp_host_belongs_to_the_domain_it_was_named_for(self):
        seen = [(SITE, "amp-a.example", MON), (OTHER, "amp-b.example", MON)]
        assert owners(seen, [SITE, OTHER]) == {"amp-a.example": SITE, "amp-b.example": OTHER}

    def test_every_host_ever_named_not_only_the_latest(self):
        seen = [(SITE, "amp-mon.example", MON), (SITE, "amp-tue.example", TUE)]
        assert owners(seen, [SITE]) == {"amp-mon.example": SITE, "amp-tue.example": SITE}

    def test_a_domain_taken_off_the_project_takes_its_amp_hosts_with_it(self):
        assert owners([(OTHER, "amp-b.example", MON)], [SITE]) == {}

    def test_a_host_the_project_lists_itself_is_not_an_amp_host(self):
        assert owners([(SITE, OTHER, MON)], [SITE, OTHER]) == {}

    def test_a_host_named_for_two_domains_goes_to_the_one_named_last(self):
        seen = [(SITE, "amp-a.example", MON), (OTHER, "amp-a.example", TUE)]
        assert owners(seen, [SITE, OTHER]) == {"amp-a.example": OTHER}
        assert owners(list(reversed(seen)), [SITE, OTHER]) == {"amp-a.example": OTHER}


class TestOursIndex:
    INDEX = ours_index([SITE], {"amp-a.example": SITE})

    def test_a_project_domain_and_its_www_spelling(self):
        assert self.INDEX[SITE] == Ours(SITE) and self.INDEX[f"www.{SITE}"] == Ours(SITE)

    def test_an_amp_host_and_its_www_spelling_name_their_site(self):
        assert self.INDEX["amp-a.example"] == Ours(SITE, "amp-a.example")
        assert self.INDEX["www.amp-a.example"] == Ours(SITE, "amp-a.example")

    def test_a_subdomain_is_neither(self):
        assert "m.amp-a.example" not in self.INDEX and f"kz.{SITE}" not in self.INDEX

    def test_a_host_that_is_both_is_the_project_domain(self):
        assert ours_index([SITE, OTHER], {OTHER: SITE})[OTHER] == Ours(OTHER)

    def test_no_amp_hosts_is_the_old_rule(self):
        assert ours_index([SITE]) == {SITE: Ours(SITE), f"www.{SITE}": Ours(SITE)}


# --------------------------------------------------------------------------
# With a database: the history, and the tables
# --------------------------------------------------------------------------

@pytest.fixture
def Session(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    # The weights are a global setting read from the app's own database.
    monkeypatch.setattr(pp, "get_visibility_weights", lambda: DEFAULT_WEIGHTS)
    return sessionmaker(bind=engine)


@pytest.fixture
def db(Session):
    with Session() as session:
        yield session


def project(db, domains=(SITE,)):
    p = Project(name="Example", domains=list(domains))
    db.add(p)
    db.flush()
    job = Job(name="job", project_id=p.id, keywords=["query"])
    db.add(job)
    db.commit()
    return p, job


def run(db, job, when, results, country="kz"):
    """A finished run whose page held `results`: (keyword, position, host[, shown host])."""
    r = JobRun(job_id=job.id, status="done", started_at=when, provider="csv")
    db.add(r)
    db.flush()
    for keyword, position, host, *shown in results:
        db.add(Result(run_id=r.id, keyword=keyword, engine="google", device="mobile", country_code=country,
                      language="ru", google_domain="google.kz", position=position, url=f"https://{host}/",
                      domain=host, shown_host=shown[0] if shown else None))
    db.commit()
    return r


def seen(db):
    return {(s.domain, s.amp_domain): (s.first_seen, s.last_seen) for s in db.query(AmpDomainSeen).all()}


class TestTheHistory:
    def test_a_pair_is_kept_once_with_when_it_was_first_and_last_named(self, db):
        p, _ = project(db)
        remember(db, [(p.id, SITE, "amp-a.example", MON, MON)])
        remember(db, [(p.id, SITE, "amp-a.example", TUE, TUE)])
        assert seen(db) == {(SITE, "amp-a.example"): (MON, TUE)}

    def test_a_rotation_adds_a_host_and_forgets_none(self, db):
        p, _ = project(db)
        remember(db, [(p.id, SITE, "amp-mon.example", MON, MON)])
        remember(db, [(p.id, SITE, "amp-tue.example", TUE, TUE)])
        assert set(seen(db)) == {(SITE, "amp-mon.example"), (SITE, "amp-tue.example")}
        assert amp_hosts(db, p) == {"amp-mon.example": SITE, "amp-tue.example": SITE}

    def test_more_pairs_than_one_statement_carries(self, db):
        p, _ = project(db)
        rows = [(p.id, SITE, f"amp-{i}.example", MON, MON) for i in range(amp_rotator._CHUNK * 2 + 5)]
        remember(db, rows)
        remember(db, rows)
        assert db.query(AmpDomainSeen).count() == len(rows)

    def test_what_was_fetched_before_the_history_was_kept_joins_it_at_start_up(self, db):
        p, _ = project(db)
        endpoint = AmpEndpoint(project_id=p.id, url="https://rotator.example/api/")
        db.add(endpoint)
        db.flush()
        db.add(AmpDomain(endpoint_id=endpoint.id, project_id=p.id, domain=SITE, amp_domain="amp-a.example",
                         since=MON, fetched_at=TUE))
        db.commit()
        remember_current(db)
        assert seen(db) == {(SITE, "amp-a.example"): (MON, TUE)}
        # Run again at the next start, it moves nothing.
        db.query(AmpDomain).update({"fetched_at": WED})
        remember_current(db)
        assert seen(db) == {(SITE, "amp-a.example"): (MON, TUE)}

    def test_a_fetch_keeps_the_host_the_rotator_has_just_moved_on_from(self, Session, db, monkeypatch):
        p, _ = project(db)
        endpoint = AmpEndpoint(project_id=p.id, url="https://rotator.example/api/")
        db.add(endpoint)
        db.commit()
        monkeypatch.setattr(amp_rotator, "SessionLocal", Session)
        monkeypatch.setattr(amp_rotator, "credentials", lambda: ("user", "password"))
        today = {"host": "amp-mon.example"}
        answer = httpx.MockTransport(lambda request: httpx.Response(200, json={SITE: today["host"]}))
        with httpx.Client(transport=answer) as client:
            assert amp_rotator.refresh_endpoint(endpoint.id, client)
            today["host"] = "amp-tue.example"
            assert amp_rotator.refresh_endpoint(endpoint.id, client)
        db.expire_all()
        # Today's answer is one host; the history has both.
        assert [a.amp_domain for a in db.query(AmpDomain).all()] == ["amp-tue.example"]
        assert amp_hosts(db, p) == {"amp-mon.example": SITE, "amp-tue.example": SITE}

    def test_a_deleted_project_takes_its_history_with_it(self, db):
        p, _ = project(db)
        remember(db, [(p.id, SITE, "amp-a.example", MON, MON)])
        amp_rotator.remove_project(db, p.id)
        db.commit()
        assert seen(db) == {}


def rows_of(data):
    return {r["keyword"]: r for serp in data["serps"] for r in serp["rows"]}


class TestTheLatestPositions:
    def test_a_result_on_an_amp_host_is_ours_and_names_its_site(self, db):
        p, job = project(db)
        remember(db, [(p.id, SITE, "amp-a.example", MON, MON)])
        run(db, job, MON, [("query", 1, "amp-a.example"), ("query", 2, "stranger.example"), ("query", 3, SITE)])
        row = rows_of(pp.project_positions(p.id, None, None, db))["query"]
        assert [(h["position"], h["domain"], h["amp_of"]) for h in row["hits"]] == [
            (1, "amp-a.example", SITE), (3, SITE, None)]
        # Both slots are the project's: two of the three on the page.
        assert (row["slots"], row["slots_total"]) == (2, 3)
        assert row["share"] == round(sum(h["share"] for h in row["hits"]), 1)

    def test_without_the_rotators_word_the_host_is_a_stranger(self, db):
        p, job = project(db)
        run(db, job, MON, [("query", 1, "amp-a.example"), ("query", 3, SITE)])
        row = rows_of(pp.project_positions(p.id, None, None, db))["query"]
        assert [(h["domain"], h["amp_of"]) for h in row["hits"]] == [(SITE, None)]
        assert row["slots"] == 1

    def test_a_page_read_yesterday_shows_yesterdays_amp_host(self, db):
        # Named on Monday, replaced on Tuesday: Monday's page still holds it.
        p, job = project(db)
        remember(db, [(p.id, SITE, "amp-mon.example", MON, MON)])
        remember(db, [(p.id, SITE, "amp-tue.example", TUE, TUE)])
        run(db, job, MON, [("query", 4, "www.amp-mon.example")])
        row = rows_of(pp.project_positions(p.id, None, None, db))["query"]
        assert [(h["position"], h["domain"], h["amp_of"]) for h in row["hits"]] == [(4, "amp-mon.example", SITE)]

    def test_two_amp_hosts_of_one_site_on_one_page_are_each_an_entry(self, db):
        # Yesterday's AMP domain still listed beside today's: two hosts, and
        # each of them one somebody can click.
        p, job = project(db)
        remember(db, [(p.id, SITE, "amp-mon.example", MON, MON), (p.id, SITE, "amp-tue.example", TUE, TUE)])
        run(db, job, TUE, [("query", 2, "amp-tue.example"), ("query", 5, "amp-mon.example"),
                           ("query", 7, "www.amp-mon.example")])
        row = rows_of(pp.project_positions(p.id, None, None, db))["query"]
        assert [(h["domain"], h["amp_of"], h["positions"]) for h in row["hits"]] == [
            ("amp-tue.example", SITE, [2]), ("amp-mon.example", SITE, [5, 7])]
        assert row["slots"] == 3

    def test_a_result_is_counted_once_however_many_hosts_are_asked_about(self, db):
        # More hosts than one query carries, and a result whose linked host is
        # the site while its displayed host is an AMP host from another part.
        p, job = project(db)
        hosts = [f"amp-{i}.example" for i in range(pp._HOSTS_PER_QUERY * 2)]
        remember(db, [(p.id, SITE, h, MON, MON) for h in hosts])
        run(db, job, MON, [("query", 3, SITE, hosts[-1]), ("query", 6, hosts[0])])
        hits = rows_of(pp.project_positions(p.id, None, None, db))["query"]["hits"]
        assert [(h["domain"], h["positions"]) for h in hits] == [(SITE, [3]), (hosts[0], [6])]


class TestTheAverages:
    def test_the_amp_hosts_of_a_site_are_one_line_across_the_window(self, db):
        p, job = project(db)
        remember(db, [(p.id, SITE, "amp-mon.example", MON, MON), (p.id, SITE, "amp-tue.example", TUE, TUE)])
        run(db, job, MON, [("query", 2, "amp-mon.example"), ("query", 5, SITE)])
        run(db, job, TUE, [("query", 4, "amp-tue.example")])
        row = rows_of(pp.project_position_averages(p.id, None, None, db))["query"]
        by = {(h["domain"], h["amp"]): h for h in row["hits"]}
        amp, site = by[(SITE, True)], by[(SITE, False)]
        assert (amp["avg_position"], amp["ranked_in"], amp["runs"]) == (3.0, 2, 2)
        assert [h["host"] for h in amp["amp_hosts"]] == ["amp-mon.example", "amp-tue.example"]
        assert (site["avg_position"], site["ranked_in"], site["runs"], site["amp_hosts"]) == (5.0, 1, 2, [])
        # What the project holds on the page is both lines together.
        assert row["visibility"] == round(amp["visibility"] + site["visibility"], 1)

    def test_two_amp_hosts_on_one_page_are_one_reading_of_that_run(self, db):
        p, job = project(db)
        remember(db, [(p.id, SITE, "amp-mon.example", MON, MON), (p.id, SITE, "amp-tue.example", TUE, TUE)])
        run(db, job, TUE, [("query", 2, "amp-tue.example"), ("query", 6, "amp-mon.example")])
        (amp,) = rows_of(pp.project_position_averages(p.id, None, None, db))["query"]["hits"]
        # The better placed of the two; present in the one run there was.
        assert (amp["amp"], amp["avg_position"], amp["ranked_in"], amp["runs"]) == (True, 2.0, 1, 1)
        assert [h["host"] for h in amp["amp_hosts"]] == ["amp-mon.example", "amp-tue.example"]


class TestTheBlocksTab:
    def test_an_amp_domain_in_the_serps_is_a_row_of_its_own_naming_its_site(self, db):
        p, job = project(db)
        remember(db, [(p.id, SITE, "amp-a.example", MON, MON)])
        run(db, job, MON, [("query", 1, "amp-a.example"), ("query", 3, SITE)])
        standing = in_serps(pp.project_positions(p.id, None, None, db), ["KZ"])
        assert sorted((r["domain"], r["best_position"], r.get("main_domain")) for r in standing) == [
            ("amp-a.example", 1, SITE), (SITE, 3, None)]

    def test_yesterdays_amp_domain_beside_todays_on_one_page_is_a_row_too(self, db):
        p, job = project(db)
        remember(db, [(p.id, SITE, "amp-mon.example", MON, MON), (p.id, SITE, "amp-tue.example", TUE, TUE)])
        run(db, job, TUE, [("query", 2, "amp-tue.example"), ("query", 6, "amp-mon.example")])
        standing = in_serps(pp.project_positions(p.id, None, None, db), ["KZ"])
        assert sorted((r["domain"], r["best_position"], r["main_domain"]) for r in standing) == [
            ("amp-mon.example", 6, SITE), ("amp-tue.example", 2, SITE)]


class TestSendingToTheProxyChecker:
    """User, 2026-10-13, asked whether an AMP domain found in the SERPs should
    be sent in its own right: "Yes, send them and show in Blocks"."""

    def rotator(self, db, p, today):
        """What the project's rotator names today: {domain: AMP host}."""
        endpoint = AmpEndpoint(project_id=p.id, url="https://rotator.example/api/")
        db.add(endpoint)
        db.flush()
        for domain, host in today.items():
            db.add(AmpDomain(endpoint_id=endpoint.id, project_id=p.id, domain=domain, amp_domain=host,
                             since=TUE, fetched_at=TUE))
        db.commit()
        remember_current(db)

    def test_an_amp_domain_a_serp_shows_is_sent_though_its_site_is_on_no_page(self, db):
        p, job = project(db)
        p.geos = ["KZ"]
        remember(db, [(p.id, SITE, "amp-mon.example", MON, MON)])
        run(db, job, MON, [("query", 1, "amp-mon.example"), ("query", 2, "stranger.example")])
        assert pc.found_by_geo(db, p) == {"KZ": ["amp-mon.example"]}
        assert pc.to_send(db, p) == {"KZ": ["amp-mon.example"]}

    def test_only_in_the_country_whose_serp_showed_it(self, db):
        p, job = project(db)
        p.geos = ["KZ", "KG"]
        remember(db, [(p.id, SITE, "amp-mon.example", MON, MON)])
        run(db, job, MON, [("query", 1, "amp-mon.example")], country="kz")
        run(db, job, MON, [("query", 1, SITE)], country="kg")
        assert pc.to_send(db, p) == {"KG": [SITE], "KZ": ["amp-mon.example"]}

    def test_the_sites_then_the_amp_domains_found_then_todays_once_each(self, db):
        p, job = project(db, domains=(SITE, OTHER))
        p.geos = ["KZ"]
        self.rotator(db, p, {SITE: "amp-tue.example", OTHER: "amp-two.example"})
        remember(db, [(p.id, SITE, "amp-mon.example", MON, MON)])
        # Yesterday's AMP host still ranks; so does today's, and the site itself.
        run(db, job, TUE, [("query", 1, SITE), ("query", 2, "amp-mon.example"), ("query", 3, "amp-tue.example")])
        assert pc.to_send(db, p) == {"KZ": [SITE, "amp-mon.example", "amp-tue.example"]}

    def test_todays_amp_domain_still_rides_with_a_found_site(self, db):
        p, job = project(db, domains=(SITE, OTHER))
        p.geos = ["KZ"]
        self.rotator(db, p, {SITE: "amp-tue.example", OTHER: "amp-two.example"})
        run(db, job, TUE, [("query", 1, SITE)])
        # The other site is on no page, and neither is its AMP domain: not sent.
        assert pc.to_send(db, p) == {"KZ": [SITE, "amp-tue.example"]}

    def test_the_answer_is_kept_as_an_amp_domains_under_its_site(self, db, monkeypatch):
        monkeypatch.setattr(pc, "connection", lambda: {"url": "https://checker.example/api", "token": "t" * 20})
        monkeypatch.setattr(pc, "timeout_minutes", lambda: pc.DEFAULT_TIMEOUT_MINUTES)   # a setting, read from the app's DB
        p, job = project(db)
        p.geos = ["KZ"]
        remember(db, [(p.id, SITE, "amp-mon.example", MON, MON)])
        run(db, job, MON, [("query", 1, "amp-mon.example")])
        answer = httpx.MockTransport(
            lambda request: httpx.Response(200, json={"amp-mon.example": {"KZ - Provider A": "FAIL"}}))
        with httpx.Client(transport=answer) as client:
            sent = pc.deliver(db, p, pc.to_send(db, p), trigger="manual", client=client)
        assert [(d.geo, d.domains, d.ok) for d in sent] == [("KZ", ["amp-mon.example"], True)]
        assert [(c.geo, c.domain, c.main_domain, c.statuses) for c in db.query(DomainProxyCheckLog).all()] == [
            ("KZ", "amp-mon.example", SITE, {"KZ - Provider A": "FAIL"})]


class TestTheCsv:
    PAGE = [PageResult(1, "amp-a.example", True, "https://amp-a.example/", "AMP", SITE),
            PageResult(2, "stranger.example", False, None, None),
            PageResult(3, SITE, True, f"https://{SITE}/", "Site")]

    def page(self):
        from app.positions_csv import Page
        return Page(engine="google", device="mobile", country_code="kz", location=None, language="ru",
                    google_domain="google.kz", keyword="query", checked_at=MON, share=50.0, slots=2,
                    slots_total=3, results=self.PAGE)

    def test_the_grid_marks_the_amp_host_ours_and_says_whose_it_is(self):
        header, row = grid_rows([self.page()], "all", "en")
        got = dict(zip(header, row))
        assert got["Our positions"] == f"1 amp-a.example (AMP {SITE}), 3 {SITE}"
        assert row[-3:] == ["★ amp-a.example", "stranger.example", f"★ {SITE}"]

    def test_the_list_has_a_column_for_the_site_of_an_amp_host(self):
        header, *rows = list_rows([self.page()], "all", "ru")
        assert header[-1] == "AMP-домен сайта"
        assert [(r[8], r[9], r[-1]) for r in rows] == [
            ("amp-a.example", "да", SITE), ("stranger.example", "нет", ""), (SITE, "да", "")]

    def test_the_export_is_built_by_the_same_rule_as_the_table(self, db):
        p, job = project(db)
        remember(db, [(p.id, SITE, "amp-a.example", MON, MON)])
        run(db, job, MON, [("query", 1, "amp-a.example"), ("query", 2, "stranger.example"), ("query", 3, SITE)])
        body = pp.export_positions_csv(p.id, None, None, "list", "all", "en", 0, db).body.decode("utf-8")
        header, *rows = list(csv.reader(io.StringIO(body.lstrip(chr(0xFEFF)))))
        at = {name: header.index(name) for name in ("Site", "Our site", "AMP domain of")}
        assert [(r[at["Site"]], r[at["Our site"]], r[at["AMP domain of"]]) for r in rows] == [
            ("amp-a.example", "yes", SITE), ("stranger.example", "no", ""), (SITE, "yes", "")]


class TestWhenItWasTheAmpDomain:
    """User, 2026-10-14: "give the date when the domain was AMP for the main
    domain inside the overview, block, and position tables"."""

    def test_the_first_and_last_day_named_and_whether_it_still_is(self):
        seen = [(SITE, "amp-mon.example", MON, TUE), (SITE, "amp-wed.example", WED, WED)]
        got = periods(seen, [SITE], current={(SITE, "amp-wed.example")})
        assert got == {"amp-mon.example": AmpPeriod(SITE, MON, TUE, False),
                       "amp-wed.example": AmpPeriod(SITE, WED, WED, True)}
        assert as_dates(got["amp-mon.example"]) == {"from": MON, "to": TUE}
        assert as_dates(got["amp-wed.example"]) == {"from": WED, "to": None}     # still is
        assert as_dates(None) is None

    def test_a_host_named_for_two_sites_takes_the_dates_of_the_later_one(self):
        seen = [(SITE, "amp-a.example", MON, MON), (OTHER, "amp-a.example", TUE, WED)]
        assert periods(seen, [SITE, OTHER])["amp-a.example"] == AmpPeriod(OTHER, TUE, WED, False)

    def test_current_is_what_the_latest_answer_names(self, db):
        p, _ = project(db)
        endpoint = AmpEndpoint(project_id=p.id, url="https://rotator.example/api/")
        db.add(endpoint)
        db.flush()
        db.add(AmpDomain(endpoint_id=endpoint.id, project_id=p.id, domain=SITE, amp_domain="amp-tue.example",
                         since=TUE, fetched_at=WED))
        db.commit()
        remember(db, [(p.id, SITE, "amp-mon.example", MON, MON), (p.id, SITE, "amp-tue.example", TUE, WED)])
        got = amp_periods(db, p)
        assert (got["amp-mon.example"].current, got["amp-tue.example"].current) == (False, True)
        assert amp_hosts(db, p) == {"amp-mon.example": SITE, "amp-tue.example": SITE}

    def test_the_positions_carry_it(self, db):
        p, job = project(db)
        remember(db, [(p.id, SITE, "amp-mon.example", MON, TUE)])
        run(db, job, TUE, [("query", 1, "amp-mon.example"), ("query", 2, SITE)])
        hits = rows_of(pp.project_positions(p.id, None, None, db))["query"]["hits"]
        assert [(h["domain"], h["amp_period"]) for h in hits] == [
            ("amp-mon.example", {"from": MON, "to": TUE}), (SITE, None)]
        avg = rows_of(pp.project_position_averages(p.id, None, None, db))["query"]["hits"]
        amp = next(h for h in avg if h["amp"])
        assert amp["amp_hosts"] == [{"host": "amp-mon.example", "from": MON, "to": TUE}]
