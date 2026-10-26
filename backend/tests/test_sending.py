"""A send to the Proxy Checker that outlives the page (user, 2026-10-26, told
a refresh does not stop it: "yes, do all three") — each country saved as soon
as it is done, the send shown as running, and a second press refused."""
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import proxy_checker as pc
from app.db import Base
from app.models import DomainProxyCheckLog, Project, ToolDelivery
from app.routers import tools
from app.routers.tools import DirectCheckRunIn, run_direct_check, send_project_now

ANSWER = {"site-one.example": {"KG - Provider A": "PASS"}}


@pytest.fixture
def Session(tmp_path):
    """A database on disk: a second connection sees only what was committed."""
    engine = create_engine(f"sqlite:///{tmp_path / 'serp.db'}")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


@pytest.fixture
def connected(monkeypatch):
    monkeypatch.setattr(pc, "connection", lambda: {"url": "https://checker.invalid/api", "token": "t" * 12})
    monkeypatch.setattr(pc, "timeout_minutes", lambda: 5)


def make_project(Session, name="Example") -> int:
    with Session() as db:
        p = Project(name=name, domains=["site-one.example"], geos=["KG", "KZ"])
        db.add(p)
        db.commit()
        return p.id


def answered(geo, domains, *args, **kw) -> pc.Sent:
    return pc.Sent(True, 200, "", {"method": "POST", "url": "https://checker.invalid/api"}, "", ANSWER)


class TestEachCountrySavedAsItComes:
    def test_the_first_country_is_saved_before_the_second_is_asked(self, Session, connected, monkeypatch):
        project_id = make_project(Session)
        seen = []

        def send_one(url, token, geo, domains, client=None, **kw):
            with Session() as other:            # another connection: committed rows only
                seen.append((geo, other.query(ToolDelivery).count(), other.query(DomainProxyCheckLog).count()))
            return answered(geo, domains)

        monkeypatch.setattr(pc, "send_one", send_one)
        with Session() as db:
            project = db.get(Project, project_id)
            pc.deliver(db, project, {"KG": ["site-one.example"], "KZ": ["site-one.example"]}, trigger="manual")
        assert seen == [("KG", 0, 0), ("KZ", 1, 1)]

    def test_an_app_stopped_half_way_keeps_what_it_had(self, Session, connected, monkeypatch):
        project_id = make_project(Session)

        def send_one(url, token, geo, domains, client=None, **kw):
            if geo == "KZ":
                raise SystemExit("the app is stopping")
            return answered(geo, domains)

        monkeypatch.setattr(pc, "send_one", send_one)
        with Session() as db:
            with pytest.raises(SystemExit):
                pc.deliver(db, db.get(Project, project_id),
                           {"KG": ["site-one.example"], "KZ": ["site-one.example"]}, trigger="manual")
        with Session() as db:
            assert [d.geo for d in db.query(ToolDelivery).all()] == ["KG"]
            assert db.query(DomainProxyCheckLog).count() == 1
        assert pc.in_progress(project_id) == []


class TestShownAsRunning:
    def test_while_it_runs_and_not_after(self, Session, connected, monkeypatch):
        project_id = make_project(Session)
        during = []

        def send_one(url, token, geo, domains, client=None, **kw):
            during.append([(s["trigger"], s["geos"], s["done"]) for s in pc.in_progress(project_id)])
            return answered(geo, domains)

        monkeypatch.setattr(pc, "send_one", send_one)
        with Session() as db:
            pc.deliver(db, db.get(Project, project_id),
                       {"KG": ["site-one.example"], "KZ": ["site-one.example"]}, trigger="direct_manual")
        assert during == [[("direct_manual", ["KG", "KZ"], 0)], [("direct_manual", ["KG", "KZ"], 1)]]
        assert pc.in_progress(project_id) == []

    def test_only_the_projects_own(self):
        with pc._sending(1, "daily", ["KG"], exclusive=False):
            assert len(pc.in_progress(1)) == 1 and pc.in_progress(2) == []

    def test_nothing_to_send_is_never_running(self, Session, connected):
        project_id = make_project(Session)
        with Session() as db:
            assert pc.deliver(db, db.get(Project, project_id), {}, trigger="manual") == []
        assert pc.in_progress(project_id) == []


class TestOnePressAtATime:
    def test_a_press_while_a_send_of_the_project_runs_is_refused(self, Session, connected, monkeypatch):
        project_id = make_project(Session)
        monkeypatch.setattr(pc, "send_one", lambda *a, **kw: pytest.fail("nothing may be sent"))
        with pc._sending(project_id, "after_run", ["KG"], exclusive=False):
            with Session() as db:
                with pytest.raises(pc.Busy):
                    pc.deliver(db, db.get(Project, project_id), {"KG": ["site-one.example"]},
                               trigger="manual", exclusive=True)
                assert db.query(ToolDelivery).count() == 0

    def test_the_automatic_sends_are_never_refused(self, Session, connected, monkeypatch):
        project_id = make_project(Session)
        monkeypatch.setattr(pc, "send_one", lambda url, token, geo, domains, client=None, **kw: answered(geo, domains))
        with pc._sending(project_id, "manual", ["KG"], exclusive=True):
            with Session() as db:
                rows = pc.deliver(db, db.get(Project, project_id), {"KG": ["site-one.example"]}, trigger="daily")
        assert len(rows) == 1

    def test_another_projects_send_does_not_count(self, Session, connected, monkeypatch):
        project_id, other_id = make_project(Session), make_project(Session, "Other")
        monkeypatch.setattr(pc, "send_one", lambda url, token, geo, domains, client=None, **kw: answered(geo, domains))
        with pc._sending(other_id, "manual", ["KG"], exclusive=True):
            with Session() as db:
                rows = pc.deliver(db, db.get(Project, project_id), {"KG": ["site-one.example"]},
                                  trigger="manual", exclusive=True)
        assert len(rows) == 1


class TestTheButtons:
    @pytest.fixture
    def busy(self, Session, connected, monkeypatch):
        def refuse(*args, **kw):
            raise pc.Busy(1)
        monkeypatch.setattr(pc, "send_recent", refuse)
        monkeypatch.setattr(pc, "direct_check", refuse)
        monkeypatch.setattr(tools, "proxy_checker_next_run", lambda project_id: None)
        monkeypatch.setattr(tools, "direct_check_next_run", lambda project_id: None)
        monkeypatch.setattr(pc, "auto_after_run", lambda: True)   # a setting: not this database
        project_id = make_project(Session)
        with Session() as db:
            yield project_id, db

    @pytest.mark.asyncio
    async def test_send_now_says_one_is_running(self, busy):
        project_id, db = busy
        with pytest.raises(HTTPException) as e:
            await send_project_now(project_id, db)
        assert e.value.status_code == 409 and e.value.detail == tools.BUSY

    @pytest.mark.asyncio
    async def test_check_now_says_one_is_running(self, busy):
        project_id, db = busy
        with pytest.raises(HTTPException) as e:
            await run_direct_check(project_id, DirectCheckRunIn(), db)
        assert e.value.status_code == 409 and e.value.detail == tools.BUSY

    def test_both_cards_are_told_what_runs(self, busy):
        project_id, db = busy
        project = db.get(Project, project_id)
        with pc._sending(project_id, "daily", ["KG", "KZ"], exclusive=False):
            for state in (tools._project_state(db, project), tools._direct_state(db, project)):
                assert [(s["trigger"], s["geos"], s["done"]) for s in state["sending"]] == [("daily", ["KG", "KZ"], 0)]
        assert tools._direct_state(db, project)["sending"] == []


class TestInRequestsOfThree:
    """User, 2026-10-26: "make the request contain 3 domains per GEO. The
    timeout example had 8 domains in it" — Cloudflare in front of the Proxy
    Checker gives up after 120 seconds."""

    EIGHT = [f"site-{n}.example" for n in range(1, 9)]

    def test_a_country_in_requests_of_three_at_most(self):
        assert pc.batches(self.EIGHT) == [self.EIGHT[0:3], self.EIGHT[3:6], self.EIGHT[6:8]]
        assert pc.batches(self.EIGHT[:3]) == [self.EIGHT[:3]] and pc.batches([]) == []
        assert pc.DOMAINS_PER_REQUEST == 3

    def test_one_after_another_each_saved_and_counted(self, Session, connected, monkeypatch):
        project_id = make_project(Session)
        asked = []

        def send_one(url, token, geo, domains, client=None, **kw):
            with Session() as other:
                saved = other.query(ToolDelivery).count()
            done = [(s["requests"], s["done"]) for s in pc.in_progress(project_id)]
            asked.append((geo, list(domains), saved, done))
            return pc.Sent(True, 200, "", {}, "", {d: {f"{geo} - Provider A": "PASS"} for d in domains}, 2.5)

        monkeypatch.setattr(pc, "send_one", send_one)
        with Session() as db:
            rows = pc.deliver(db, db.get(Project, project_id),
                              {"KG": self.EIGHT, "KZ": self.EIGHT[:2]}, trigger="manual")
            assert [(r.geo, r.domains, r.duration_ms) for r in rows] == [
                ("KG", self.EIGHT[0:3], 2500), ("KG", self.EIGHT[3:6], 2500),
                ("KG", self.EIGHT[6:8], 2500), ("KZ", self.EIGHT[0:2], 2500)]
            # Every domain's answer is kept, under the request it was asked in.
            assert db.query(DomainProxyCheckLog).count() == 10
        assert asked == [
            ("KG", self.EIGHT[0:3], 0, [(4, 0)]), ("KG", self.EIGHT[3:6], 1, [(4, 1)]),
            ("KG", self.EIGHT[6:8], 2, [(4, 2)]), ("KZ", self.EIGHT[0:2], 3, [(4, 3)])]

    def test_how_long_a_request_took_is_measured_answer_or_not(self):
        import httpx
        ok = httpx.MockTransport(lambda request: httpx.Response(200, json={}))
        with httpx.Client(transport=ok) as client:
            assert pc.send_one("https://checker.invalid/api", "t" * 12, "KG", ["a.example"], client).seconds >= 0

        def cloudflare_gives_up(request):
            raise httpx.ReadTimeout("timed out", request=request)
        with httpx.Client(transport=httpx.MockTransport(cloudflare_gives_up)) as client:
            sent = pc.send_one("https://checker.invalid/api", "t" * 12, "KG", ["a.example"], client)
        assert sent.ok is False and sent.seconds is not None
