"""Checking chosen domains for blocks on a timer, without a SERP (user,
2026-10-26: "check the domains for blocks even when the SERP was not checked …
let the user select which domains to check in a specified interval (they can
select or choose all). The GEOs will be taken from the Project GEOs if
specified")."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import blocks
from app import proxy_checker as pc
from app.db import Base
from app.models import AmpDomain, AmpEndpoint, Job, Project, ToolDelivery
from app.routers import tools
from app.routers.tools import DirectCheckIn, DirectCheckRunIn, get_direct_check, run_direct_check, update_direct_check
from app.scheduler import direct_check_trigger

SITES = ["site-one.example", "site-two.example", "site-three.example"]


class TestWhichDomains:
    def test_no_choice_is_all_of_them(self):
        assert pc.direct_domains(SITES, None) == SITES

    def test_a_choice_keeps_the_projects_order(self):
        assert pc.direct_domains(SITES, ["SITE-THREE.example", "site-one.example"]) == [
            "site-one.example", "site-three.example"]

    def test_a_domain_the_project_no_longer_has_is_not_checked(self):
        assert pc.direct_domains(SITES, ["gone.example", "site-two.example"]) == ["site-two.example"]

    def test_an_empty_choice_checks_nothing(self):
        assert pc.direct_domains(SITES, []) == []


class TestWhatGoes:
    def test_every_geo_gets_every_domain_then_their_amp_domains(self):
        got = pc.direct_by_geo(["site-one.example", "site-two.example"], ["KG", "KZ"],
                               {"site-one.example": ["amp-one.example"], "elsewhere.example": ["amp-x.example"]})
        assert got == {
            "KG": ["site-one.example", "site-two.example", "amp-one.example"],
            "KZ": ["site-one.example", "site-two.example", "amp-one.example"],
        }

    def test_nothing_without_domains_or_geos(self):
        assert pc.direct_by_geo([], ["KG"], {}) == {}
        assert pc.direct_by_geo(["site-one.example"], [], {}) == {}


@pytest.fixture
def db():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as session:
        yield session


def project(db, **kw) -> Project:
    p = Project(name="Example", domains=list(SITES), **kw)
    db.add(p)
    db.commit()
    return p


class TestTheProjectsGeos:
    def test_the_project_geos_and_not_the_ones_chosen_for_serp_findings(self, db):
        p = project(db, geos=["KG", "KZ"], proxy_checker_geos=["KG"], direct_check_domains=["site-two.example"])
        assert pc.direct_to_send(db, p) == {"KG": ["site-two.example"], "KZ": ["site-two.example"]}

    def test_only_the_geos_chosen_for_it(self, db):
        """User, 2026-10-26: "Let the user choose GEOs as well"."""
        p = project(db, geos=["KG", "KZ", "UZ"], direct_check_domains=["site-one.example"], direct_check_geos=["UZ", "KG"])
        assert pc.direct_to_send(db, p) == {"KG": ["site-one.example"], "UZ": ["site-one.example"]}

    def test_a_chosen_geo_the_project_no_longer_has_is_not_checked(self, db):
        p = project(db, geos=["KG"], direct_check_domains=["site-one.example"], direct_check_geos=["KZ", "KG"])
        assert pc.direct_to_send(db, p) == {"KG": ["site-one.example"]}

    def test_no_geo_chosen_checks_nothing(self, db):
        assert pc.direct_to_send(db, project(db, geos=["KG"], direct_check_geos=[])) == {}

    def test_never_set_the_jobs_countries_stand_in(self, db):
        p = project(db, direct_check_domains=["site-one.example"])
        db.add(Job(name="phone", project_id=p.id, locations=[{"country_code": "uz"}]))
        db.commit()
        assert pc.direct_to_send(db, p) == {"UZ": ["site-one.example"]}

    def test_the_amp_domain_of_the_day_rides_along(self, db):
        p = project(db, geos=["KG"], direct_check_domains=["site-one.example"])
        endpoint = AmpEndpoint(project_id=p.id, url="https://rotator.invalid/x")
        db.add(endpoint)
        db.flush()
        db.add(AmpDomain(endpoint_id=endpoint.id, project_id=p.id, domain="site-one.example",
                         amp_domain="amp-one.example"))
        db.commit()
        assert pc.direct_to_send(db, p) == {"KG": ["site-one.example", "amp-one.example"]}


@pytest.fixture
def router(monkeypatch):
    """The router without a scheduler or a connection behind it."""
    timers = []
    monkeypatch.setattr(tools, "upsert_direct_check_schedule", lambda p: timers.append(
        (p.direct_check_enabled, p.direct_check_hours, p.direct_check_since)))
    monkeypatch.setattr(tools, "direct_check_next_run", lambda project_id: None)
    monkeypatch.setattr(pc, "connection", lambda: {"url": "", "token": ""})
    return timers


class TestTheSetting:
    def test_off_until_switched_on(self, db, router):
        state = get_direct_check(project(db, geos=["KG"]).id, db)
        assert (state["enabled"], state["hours"], state["domains"]) == (False, 24, None)
        assert state["project_domains"] == SITES and state["project_geos"] == ["KG"] and state["geos_set"] is True
        assert state["geos"] is None

    def test_switching_on_sets_the_timer_from_now(self, db, router):
        p = project(db)
        before = datetime.now(timezone.utc).replace(tzinfo=None)
        state = update_direct_check(p.id, DirectCheckIn(enabled=True, hours=6, domains=["site-two.example"]), db)
        assert (state["enabled"], state["hours"], state["domains"]) == (True, 6, ["site-two.example"])
        assert router[-1][:2] == (True, 6) and router[-1][2] >= before

    def test_other_domains_leave_the_timer_where_it_is(self, db, router):
        p = project(db)
        update_direct_check(p.id, DirectCheckIn(enabled=True, hours=6), db)
        since = router[-1][2]
        update_direct_check(p.id, DirectCheckIn(enabled=True, hours=6, domains=["site-one.example"]), db)
        assert router[-1][2] == since

    def test_another_interval_restarts_it(self, db, router):
        p = project(db)
        update_direct_check(p.id, DirectCheckIn(enabled=True, hours=6), db)
        p.direct_check_since = datetime(2026, 10, 1)
        db.commit()
        update_direct_check(p.id, DirectCheckIn(enabled=True, hours=12), db)
        assert router[-1][2] > datetime(2026, 10, 1)

    def test_null_is_all_again(self, db, router):
        p = project(db, direct_check_domains=["site-one.example"])
        state = update_direct_check(p.id, DirectCheckIn(enabled=True, hours=24, domains=None), db)
        assert state["domains"] is None and p.direct_check_domains is None

    def test_chosen_geos_and_null_is_all_again(self, db, router):
        p = project(db, geos=["KG", "KZ"])
        state = update_direct_check(p.id, DirectCheckIn(enabled=True, hours=24, geos=["kz"]), db)
        assert state["geos"] == ["KZ"] and p.direct_check_geos == ["KZ"]
        state = update_direct_check(p.id, DirectCheckIn(enabled=True, hours=24, geos=None), db)
        assert state["geos"] is None and p.direct_check_geos is None

    def test_only_the_projects_own_geos(self, db, router):
        p = project(db, geos=["KG"])
        with pytest.raises(HTTPException) as e:
            update_direct_check(p.id, DirectCheckIn(enabled=True, hours=24, geos=["UZ"]), db)
        assert e.value.status_code == 400 and p.direct_check_geos is None

    def test_only_an_offered_interval(self, db, router):
        with pytest.raises(HTTPException) as e:
            update_direct_check(project(db).id, DirectCheckIn(enabled=True, hours=5), db)
        assert e.value.status_code == 400

    def test_only_the_projects_own_domains(self, db, router):
        p = project(db)
        with pytest.raises(HTTPException) as e:
            update_direct_check(p.id, DirectCheckIn(enabled=True, hours=24, domains=["other.example"]), db)
        assert e.value.status_code == 400 and p.direct_check_domains is None

    def test_the_last_check_shown_is_one_without_a_serp(self, db, router):
        p = project(db)
        db.add_all([
            ToolDelivery(tool=pc.TOOL, project_id=p.id, trigger="direct", geo="KG", domains=[], ok=True,
                         sent_at=datetime(2026, 10, 25, 9, 0)),
            ToolDelivery(tool=pc.TOOL, project_id=p.id, trigger="after_run", geo="KG", domains=[], ok=True,
                         sent_at=datetime(2026, 10, 26, 9, 0)),
        ])
        db.commit()
        assert get_direct_check(p.id, db)["last_at"] == datetime(2026, 10, 25, 9, 0)


class TestCheckNow:
    """A one-time check (user: "I meant check now"): the domains picked on the
    page, once, whether or not the timer is on or the choice saved."""

    def test_the_domains_picked_on_the_page_not_the_saved_ones(self, db):
        p = project(db, geos=["KG"], direct_check_domains=["site-one.example"])
        assert pc.direct_to_send(db, p, ["site-two.example"]) == {"KG": ["site-two.example"]}
        assert pc.direct_to_send(db, p, None) == {"KG": SITES}
        assert pc.direct_to_send(db, p) == {"KG": ["site-one.example"]}

    def test_the_geos_picked_on_the_page_not_the_saved_ones(self, db):
        p = project(db, geos=["KG", "KZ"], direct_check_domains=["site-one.example"], direct_check_geos=["KG"])
        assert pc.direct_to_send(db, p, geos=["KZ"]) == {"KZ": ["site-one.example"]}
        assert pc.direct_to_send(db, p, geos=None) == {"KG": ["site-one.example"], "KZ": ["site-one.example"]}

    @pytest.fixture
    def sent(self, monkeypatch):
        calls = []
        monkeypatch.setattr(tools, "direct_check_next_run", lambda project_id: None)
        monkeypatch.setattr(pc, "connection", lambda: {"url": "https://checker.invalid/api", "token": "t" * 12})
        monkeypatch.setattr(pc, "direct_check", lambda project_id, trigger, domains, geos:
                            calls.append((trigger, domains, geos)) or [])
        return calls

    @pytest.mark.asyncio
    async def test_with_the_timer_off(self, db, sent):
        p = project(db, geos=["KG"])
        await run_direct_check(p.id, DirectCheckRunIn(domains=["site-two.example"], geos=["kg"]), db)
        assert sent == [("direct_manual", ["site-two.example"], ["KG"])] and p.direct_check_enabled is False

    @pytest.mark.asyncio
    async def test_null_is_all_and_no_body_is_the_saved_choice(self, db, sent):
        p = project(db, geos=["KG", "KZ"], direct_check_domains=["site-one.example"], direct_check_geos=["KZ"])
        await run_direct_check(p.id, DirectCheckRunIn(domains=None, geos=None), db)
        await run_direct_check(p.id, None, db)
        assert sent == [("direct_manual", None, None), ("direct_manual", ["site-one.example"], ["KZ"])]

    @pytest.mark.asyncio
    async def test_only_the_projects_own_domains(self, db, sent):
        with pytest.raises(HTTPException) as e:
            await run_direct_check(project(db).id, DirectCheckRunIn(domains=["other.example"]), db)
        assert e.value.status_code == 400 and sent == []

    @pytest.mark.asyncio
    async def test_only_the_projects_own_geos(self, db, sent):
        with pytest.raises(HTTPException) as e:
            await run_direct_check(project(db, geos=["KG"]).id, DirectCheckRunIn(geos=["UZ"]), db)
        assert e.value.status_code == 400 and sent == []

    @pytest.mark.asyncio
    async def test_nothing_without_a_connection(self, db, sent, monkeypatch):
        monkeypatch.setattr(pc, "connection", lambda: {"url": "", "token": ""})
        with pytest.raises(HTTPException) as e:
            await run_direct_check(project(db).id, DirectCheckRunIn(domains=None), db)
        assert e.value.status_code == 409 and sent == []


class TestTheTimer:
    def test_ticks_at_whole_intervals_from_when_it_was_set(self):
        trigger = direct_check_trigger(6, datetime(2026, 10, 26, 10, 0))
        now = datetime(2026, 10, 26, 17, 30, tzinfo=timezone.utc)
        assert trigger.get_next_fire_time(None, now) == datetime(2026, 10, 26, 22, 0, tzinfo=timezone.utc)

    def test_a_restart_does_not_move_it(self):
        since = datetime(2026, 10, 20, 8, 0)
        for minutes in (1, 59, 61, 600):
            now = datetime(2026, 10, 26, 8, 0, tzinfo=timezone.utc) + timedelta(minutes=minutes)
            fire = direct_check_trigger(24, since).get_next_fire_time(None, now)
            assert (fire.hour, fire.minute) == (8, 0)

    def test_a_project_switched_off_sends_nothing(self, db, monkeypatch):
        sent = []
        monkeypatch.setattr(pc, "SessionLocal", sessionmaker(bind=db.get_bind()))
        monkeypatch.setattr(pc, "direct_check", lambda project_id, trigger: sent.append((project_id, trigger)))
        off, on = project(db), Project(name="On", domains=["site-one.example"], direct_check_enabled=True)
        db.add(on)
        db.commit()
        pc.direct_check_tick(off.id)
        pc.direct_check_tick(on.id)
        pc.direct_check_tick(999)
        assert sent == [(on.id, "direct")]


class TestInBlocks:
    def test_a_domain_no_serp_shows_is_a_row_marked_as_checked_without_one(self):
        check = {"geo": "KG", "domain": "site-two.example", "main_domain": None,
                 "statuses": {"KG - Provider A": "PASS"}, "checked_at": datetime(2026, 10, 26, 9, 0), "direct": True}
        rows, amp = blocks.period_rows([], [check], {})
        assert len(rows) == 1 and amp == []
        assert rows[0]["direct"] is True and rows[0]["best_position"] is None and rows[0]["kind"] == blocks.PASS

    def test_a_row_from_a_serp_is_not(self):
        standing = [{"geo": "KG", "domain": "site-one.example", "keywords": 1, "engines": ["google"],
                     "best_position": 3, "best_keyword": "casino", "best_engine": "google", "last_seen": None}]
        check = {"geo": "KG", "domain": "site-one.example", "main_domain": None,
                 "statuses": {"KG - Provider A": "PASS"}, "checked_at": datetime(2026, 10, 26, 9, 0)}
        rows, _ = blocks.period_rows(standing, [check], {})
        assert rows[0]["direct"] is False and rows[0]["best_position"] == 3
