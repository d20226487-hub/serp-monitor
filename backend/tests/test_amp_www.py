"""A project domain written with "www." is asked about that way at the AMP
rotator — and nowhere else.

The rotator matches site names exactly (measured 2026-11-25: asking either real
rotator for the other spelling of all 25 sites that have an AMP returned ""
every time). A site registered there as www.domain.com therefore answered ""
for the project's domain.com, and its AMP never appeared. The user's rule: keep
the "www." the user writes, use it only for the rotator request, and trim
everything else as before.
"""
import json

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import amp_rotator
from app.db import Base
from app.models import AmpDomain, AmpEndpoint, Project
from app.providers.domain_paste import clean_domain_list, normalize_domain, typed_with_www

SITE, OTHER = "site-one.example", "site-two.example"


class TestTypedWithWww:
    def test_the_www_spelling_is_noted_and_the_domain_stays_bare(self):
        typed = ["www.site-one.example", "site-two.example"]
        assert clean_domain_list(typed) == [SITE, OTHER]
        assert typed_with_www(typed) == [SITE]

    def test_everything_else_is_still_trimmed(self):
        typed = [" HTTPS://WWW.Site-One.example:443/path?q=1 ", "user@www.site-two.example."]
        assert clean_domain_list(typed) == [SITE, OTHER]
        assert typed_with_www(typed) == [SITE, OTHER]

    def test_a_bare_domain_is_not_noted(self):
        assert typed_with_www([SITE, "https://site-two.example/"]) == []

    def test_written_both_ways_the_www_spelling_wins(self):
        typed = [SITE, f"www.{SITE}"]
        assert clean_domain_list(typed) == [SITE]
        assert typed_with_www(typed) == [SITE]

    def test_what_is_not_a_domain_is_not_noted_either(self):
        assert normalize_domain("www.com") is None
        assert typed_with_www(["www.com", "www."]) == []


@pytest.fixture
def Session(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)
    monkeypatch.setattr(amp_rotator, "SessionLocal", session)
    monkeypatch.setattr(amp_rotator, "credentials", lambda: ("user", "password"))
    return session


def endpoint_for(Session, www=()):
    with Session() as db:
        p = Project(name="Example", domains=[SITE, OTHER], www_domains=list(www))
        db.add(p)
        db.commit()
        e = AmpEndpoint(project_id=p.id, url="https://rotator.example/api/")
        db.add(e)
        db.commit()
        return p.id, e.id


def exact_rotator(known: dict[str, str], asked: list):
    """A rotator that, like the real ones, knows each site under ONE spelling
    and answers "" for any other."""
    def answer(request):
        names = json.loads(request.content)
        asked.extend(names)
        return httpx.Response(200, json={n: known.get(n, "") for n in names})
    return httpx.MockTransport(answer)


class TestRotatorRequest:
    def test_a_site_held_as_www_is_missed_when_asked_bare(self, Session):
        _, eid = endpoint_for(Session)
        asked: list = []
        with httpx.Client(transport=exact_rotator({f"www.{SITE}": "amp-a.example"}, asked)) as c:
            assert amp_rotator.refresh_endpoint(eid, c)
        with Session() as db:
            assert db.query(AmpDomain).count() == 0
        assert asked == [SITE, OTHER]

    def test_written_with_www_it_is_asked_with_www_and_credited_to_the_bare_domain(self, Session):
        pid, eid = endpoint_for(Session, www=[SITE])
        asked: list = []
        with httpx.Client(transport=exact_rotator({f"www.{SITE}": "amp-a.example"}, asked)) as c:
            assert amp_rotator.refresh_endpoint(eid, c)
        assert asked == [f"www.{SITE}", OTHER]
        with Session() as db:
            assert [(a.domain, a.amp_domain) for a in db.query(AmpDomain).all()] == [(SITE, "amp-a.example")]
            # And so the positions, Blocks and Proxy Checker see it as usual.
            assert amp_rotator.amp_hosts(db, db.get(Project, pid)) == {"amp-a.example": SITE}

    def test_only_the_rotator_names_carry_www(self, Session):
        pid, _ = endpoint_for(Session, www=[SITE])
        with Session() as db:
            p = db.get(Project, pid)
            assert amp_rotator.rotator_names(p) == {f"www.{SITE}": SITE, OTHER: OTHER}
            assert p.domains == [SITE, OTHER]


class TestConfigUpload:
    def test_a_config_site_written_with_www_is_the_projects_domain(self, Session):
        pid, eid = endpoint_for(Session, www=[SITE])
        with httpx.Client(transport=exact_rotator({f"www.{SITE}": "amp-now.example"}, [])) as c:
            assert amp_rotator.refresh_endpoint(eid, c)
        config = [{"site": f"www.{SITE}", "amps": ["amp-old.example", "amp-now.example", "amp-next.example"]}]
        with Session() as db:
            summary = amp_rotator.import_config(db, db.get(AmpEndpoint, eid), config)
            assert summary["added"] == 1
            assert summary["report"][0]["status"] == "ok"
            assert set(amp_rotator.amp_hosts(db, db.get(Project, pid))) == {"amp-old.example", "amp-now.example"}
