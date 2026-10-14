"""The project's "CSV uploads" tab: a short log of uploads, each removable
(user, 2026-10-14: "add the Import CSV log tab as a forth where will be a
short log of uploads", with deleting an upload)."""
from datetime import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import Job, JobRun, Project, Result, ToolDelivery
from app.routers.serp_upload import PROVIDER, delete_serp_csv_upload, list_serp_csv_uploads

MON, TUE = datetime(2026, 10, 12, 7, 0), datetime(2026, 10, 13, 7, 0)


@pytest.fixture
def db():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as session:
        yield session


def setup(db):
    project = Project(name="Example", domains=["site-one.example"])
    other = Project(name="Other", domains=[])
    db.add_all([project, other])
    db.flush()
    job = Job(name="CSV — Example", project_id=project.id, provider=PROVIDER)
    db.add(job)
    db.flush()
    # An upload made before its file was recorded: only its positions say anything.
    old = JobRun(job_id=job.id, status="done", provider=PROVIDER, started_at=MON, uploaded_at=MON)
    # One made since.
    new = JobRun(job_id=job.id, status="done", provider=PROVIDER, started_at=TUE, uploaded_at=TUE, upload={
        "file_name": "serp_13-10-2026.csv", "engine": "google", "device": "mobile", "rows": 3, "queries": 2,
        "geos": {"KZ": 3}, "empty": 4, "unknown_geos": {"Atlantis": 1}, "bad_total": 2, "geos_added": ["KZ"],
    })
    db.add_all([old, new])
    db.flush()
    for keyword, country, position in (("a", "kz", 1), ("a", "kz", 2), ("b", "kz", 1), ("a", "kg", 1)):
        db.add(Result(run_id=old.id, keyword=keyword, engine="google", device="desktop", country_code=country,
                      position=position, domain="site-one.example"))
    for position in (1, 2, 3):
        db.add(Result(run_id=new.id, keyword="a", engine="google", device="mobile", country_code="kz",
                      position=position, domain="site-one.example"))
    db.add_all([
        ToolDelivery(tool="proxy_checker", project_id=project.id, run_id=new.id, trigger="after_run", geo="KZ",
                     domains=["site-one.example"], ok=True, status_code=200, sent_at=TUE),
        ToolDelivery(tool="proxy_checker", project_id=project.id, run_id=new.id, trigger="after_run", geo="KG",
                     domains=["site-one.example"], ok=False, status_code=None, sent_at=TUE),
    ])
    db.commit()
    return project, other, old, new


class TestTheLog:
    def test_newest_first_with_what_the_file_was(self, db):
        project, _, old, new = setup(db)
        rows = list_serp_csv_uploads(project.id, db)["uploads"]
        assert [r["run_id"] for r in rows] == [new.id, old.id]
        latest = rows[0]
        assert (latest["file_name"], latest["engine"], latest["device"], latest["rows"], latest["queries"]) == (
            "serp_13-10-2026.csv", "google", "mobile", 3, 2)
        assert (latest["empty"], latest["not_loaded"], latest["geos_added"]) == (4, 3, ["KZ"])
        assert latest["proxy_checker"] == {"requests": 2, "accepted": 1, "no_answer": 1, "refused": 0, "at": TUE}

    def test_an_upload_made_before_its_file_was_recorded_says_what_its_positions_say(self, db):
        project, _, old, _ = setup(db)
        row = list_serp_csv_uploads(project.id, db)["uploads"][1]
        # 4 positions; "a" and "b" in KZ and "a" in KG are 3 queries.
        assert (row["rows"], row["queries"], row["geos"]) == (4, 3, {"KZ": 3, "KG": 1})
        assert (row["engine"], row["device"]) == ("google", "desktop")
        assert row["file_name"] is None and row["empty"] is None and row["not_loaded"] is None
        assert row["proxy_checker"] is None


class TestRemovingAnUpload:
    def test_its_run_and_positions_go_and_the_rest_stays(self, db):
        project, _, old, new = setup(db)
        left = delete_serp_csv_upload(project.id, new.id, db)["uploads"]
        assert [r["run_id"] for r in left] == [old.id]
        assert db.get(JobRun, new.id) is None
        assert db.query(Result).filter(Result.run_id == new.id).count() == 0
        assert db.query(Result).filter(Result.run_id == old.id).count() == 4
        # The sends stay in the log, no longer tied to the run that is gone.
        assert [d.run_id for d in db.query(ToolDelivery).all()] == [None, None]

    def test_only_an_upload_of_this_project(self, db):
        project, other, old, _ = setup(db)
        with pytest.raises(HTTPException) as e:
            delete_serp_csv_upload(other.id, old.id, db)
        assert e.value.status_code == 404
        with pytest.raises(HTTPException):
            delete_serp_csv_upload(project.id, 999_999, db)
        assert db.get(JobRun, old.id) is not None

    def test_a_run_that_is_not_an_upload_is_not_one(self, db):
        project, _, _, _ = setup(db)
        job = Job(name="phone", project_id=project.id, provider="own_android")
        db.add(job)
        db.flush()
        run = JobRun(job_id=job.id, status="done", started_at=TUE)
        db.add(run)
        db.commit()
        with pytest.raises(HTTPException):
            delete_serp_csv_upload(project.id, run.id, db)
        assert db.get(JobRun, run.id) is not None
