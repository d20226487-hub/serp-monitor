"""The global switch for sending to the Proxy Checker after every SERP check
and CSV upload (user, 2026-10-14: "When enabled, this will happen
automatically, when disabled the user will configure. The user should be able
to still overwrite this setting on the project page. But default will be auto
checks")."""
from datetime import datetime

import httpx

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import proxy_checker as pc
from app.db import Base
from app.models import Job, JobRun, Project


class TestTheSwitch:
    def test_on_unless_turned_off(self):
        assert pc.parse_flag(None) is True and pc.parse_flag("") is True
        assert pc.parse_flag("1") is True and pc.parse_flag("true") is True
        for off in ("0", "false", "off", "no", " FALSE "):
            assert pc.parse_flag(off) is False, off


class TestWhatAModeComesTo:
    def test_a_project_on_inherit_follows_the_switch(self):
        assert pc.effective_mode("inherit", True) == "after_run"
        assert pc.effective_mode("inherit", False) == "off"

    def test_a_projects_own_choice_wins_whatever_the_switch(self):
        for auto in (True, False):
            assert pc.effective_mode("off", auto) == "off"
            assert pc.effective_mode("after_run", auto) == "after_run"
            assert pc.effective_mode("daily", auto) == "daily"

    def test_what_nobody_understands_sends_nothing(self):
        assert pc.effective_mode(None, True) == "off"
        assert pc.effective_mode("sometimes", True) == "off"

    def test_inherit_is_a_mode_the_page_may_save(self):
        assert "inherit" in pc.MODES


@pytest.fixture
def Session():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def finished_run(Session, mode=None):
    with Session() as db:
        project = Project(name=f"Example {db.query(Project).count() + 1}", domains=["site-one.example"])
        if mode is not None:
            project.proxy_checker_mode = mode
        db.add(project)
        db.flush()
        job = Job(name="job", project_id=project.id)
        db.add(job)
        db.flush()
        run = JobRun(job_id=job.id, status="done", started_at=datetime(2026, 10, 14, 7, 0))
        db.add(run)
        db.commit()
        return run.id, project.proxy_checker_mode


class TestAfterARun:
    def sends(self, Session, monkeypatch, mode, auto):
        """Whether a finished run (or an upload) of a project on `mode` is sent,
        with the switch on or off. Nothing leaves: the sender is replaced."""
        sent = []
        monkeypatch.setattr(pc, "SessionLocal", Session)
        monkeypatch.setattr(pc, "auto_after_run", lambda: auto)
        monkeypatch.setattr(pc, "to_send", lambda db, project, run_id=None: {"KZ": ["site-one.example"]})
        monkeypatch.setattr(pc, "deliver", lambda db, project, by_geo, **kw: sent.append((project.id, kw)))
        run_id, _ = finished_run(Session, mode)
        pc.after_run(run_id)
        return bool(sent)

    def test_a_new_project_follows_the_switch(self, Session, monkeypatch):
        assert finished_run(Session)[1] == "inherit"
        assert self.sends(Session, monkeypatch, None, auto=True)

    def test_switched_off_a_project_that_follows_it_sends_nothing(self, Session, monkeypatch):
        assert not self.sends(Session, monkeypatch, "inherit", auto=False)

    def test_a_project_set_to_off_stays_off_with_the_switch_on(self, Session, monkeypatch):
        # The projects that existed when the switch came kept "off".
        assert not self.sends(Session, monkeypatch, "off", auto=True)

    def test_a_project_set_to_send_after_runs_does_so_with_the_switch_off(self, Session, monkeypatch):
        assert self.sends(Session, monkeypatch, "after_run", auto=False)

    def test_a_daily_project_is_not_sent_after_a_run(self, Session, monkeypatch):
        assert not self.sends(Session, monkeypatch, "daily", auto=True)


class TestHowLongTheAnswerIsWaitedFor:
    """User, 2026-10-14: "Make it configurable in the setting: how long will we
    wait for the proxy checker"."""

    def test_the_whole_wait_is_the_setting_and_connecting_has_its_own_short_limit(self):
        timeout = pc.request_timeout(12)
        assert timeout.read == 12 * 60 and timeout.connect == pc.CONNECT_SECONDS

    def test_five_minutes_unless_set_otherwise(self):
        assert pc.DEFAULT_TIMEOUT_MINUTES == 5
        assert (pc.TIMEOUT_MINUTES_MIN, pc.TIMEOUT_MINUTES_MAX) == (1, 60)

    def test_no_answer_in_time_says_how_long_was_waited(self):
        def slow(request):
            raise httpx.ReadTimeout("timed out", request=request)

        with httpx.Client(transport=httpx.MockTransport(slow)) as client:
            sent = pc.send_one("https://checker.example/api", "token-123456789", "KZ", ["a.example"], client,
                               wait_minutes=7)
        assert (sent.ok, sent.status_code) == (False, None)
        assert sent.excerpt.startswith("no answer within 7 min")
