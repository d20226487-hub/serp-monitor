"""The run's CSV opens in Excel as it should (user, 2026-10-14: "fix the
garbled in Excel CSV"): a UTF-8 byte-order mark, and ";" between fields for a
Russian interface."""
import csv
import io
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.models import Job, JobRun, Result
from app.routers import export


@pytest.fixture
def client():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    job = Job(name="Казино KZ")
    session.add(job)
    session.flush()
    run = JobRun(job_id=job.id, status="done", provider="serpapi", started_at=datetime(2026, 10, 14, 7, 0))
    session.add(run)
    session.flush()
    session.add(Result(run_id=run.id, keyword="казино онлайн", engine="google", device="mobile", country_code="kz",
                       position=1, url="https://a.example/", title="Казино, бонусы", domain="a.example"))
    session.commit()
    app = FastAPI()
    app.include_router(export.router)
    app.dependency_overrides[get_db] = lambda: session
    yield TestClient(app), run.id
    session.close()


def test_a_byte_order_mark_so_excel_reads_cyrillic(client):
    http, run_id = client
    r = http.get(f"/runs/{run_id}/export.csv")
    assert r.status_code == 200 and "charset=utf-8" in r.headers["content-type"]
    assert r.content.startswith("\ufeff".encode("utf-8"))


def test_a_russian_interface_gets_semicolons_an_english_one_commas(client):
    http, run_id = client
    for lang, sep in (("ru", ";"), ("en", ",")):
        text = http.get(f"/runs/{run_id}/export.csv?lang={lang}").content.decode("utf-8-sig")
        header, row = list(csv.reader(io.StringIO(text), delimiter=sep))
        assert header[0] == "keyword" and row[0] == "казино онлайн"
        # A comma inside a value is quoted, not split, either way.
        assert row[header.index("title")] == "Казино, бонусы"


def test_without_a_language_it_is_commas_as_before(client):
    http, run_id = client
    text = http.get(f"/runs/{run_id}/export.csv").content.decode("utf-8-sig")
    assert text.splitlines()[0].startswith("keyword,engine,")
