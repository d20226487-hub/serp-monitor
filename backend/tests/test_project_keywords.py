"""A project's keywords edited on its page (user, 2026-10-20: "remove/add
keywords from/to the project one by one like GEOs + clear all button")."""
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import Job, Project
from app.routers.projects import (
    KeywordsAddIn, KeywordsRemoveIn, MAX_KEYWORDS_PER_JOB, add_keywords, add_project_keywords, drop_keywords,
    remove_project_keywords,
)


class TestTheLists:
    def test_removing_ignores_case_and_spaces(self):
        assert drop_keywords(["Casino", " casino online ", "bonus"], {"casino", "casino online"}) == ["bonus"]

    def test_adding_keeps_order_and_skips_what_is_there(self):
        assert add_keywords(["a", "B"], ["b", "c", " ", "C", " d "]) == (["a", "B", "c", "d"], ["c", "d"])


@pytest.fixture
def db():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as session:
        yield session


def setup(db):
    project, other = Project(name="Example", domains=[]), Project(name="Other", domains=[])
    db.add_all([project, other])
    db.flush()
    phone = Job(name="phone", project_id=project.id, keywords=["casino", "Wrong one", "bonus"])
    upload = Job(name="CSV — Example", project_id=project.id, provider="csv", keywords=["wrong one", "wrong two"])
    elsewhere = Job(name="elsewhere", project_id=other.id, keywords=["wrong one"])
    db.add_all([phone, upload, elsewhere])
    db.commit()
    return project, other, phone, upload, elsewhere


class TestRemoving:
    def test_one_keyword_leaves_every_job_of_the_project(self, db):
        project, _, phone, upload, elsewhere = setup(db)
        got = remove_project_keywords(project.id, KeywordsRemoveIn(keywords=["WRONG ONE", "wrong two"]), db)
        assert got == {"jobs_changed": 2, "removed": 3}
        assert (phone.keywords, upload.keywords) == (["casino", "bonus"], [])
        assert elsewhere.keywords == ["wrong one"]          # another project's job is not touched

    def test_clear_all(self, db):
        project, _, phone, upload, elsewhere = setup(db)
        got = remove_project_keywords(project.id, KeywordsRemoveIn(all=True), db)
        assert got == {"jobs_changed": 2, "removed": 5}
        assert (phone.keywords, upload.keywords, elsewhere.keywords) == ([], [], ["wrong one"])

    def test_nothing_to_remove_changes_nothing(self, db):
        project, _, phone, _, _ = setup(db)
        assert remove_project_keywords(project.id, KeywordsRemoveIn(keywords=["absent"]), db) == {
            "jobs_changed": 0, "removed": 0}
        assert phone.keywords == ["casino", "Wrong one", "bonus"]


class TestAdding:
    def test_into_the_job_chosen(self, db):
        project, _, phone, upload, _ = setup(db)
        # "Wrong two" is in that job already; "casino" only in another job, so that one goes in too.
        got = add_project_keywords(project.id, KeywordsAddIn(keywords=["new one", "Wrong two", "casino"], job_id=upload.id), db)
        assert got == {"added": 2, "job_id": upload.id}
        assert upload.keywords == ["wrong one", "wrong two", "new one", "casino"]
        assert phone.keywords == ["casino", "Wrong one", "bonus"]

    def test_only_a_job_of_this_project(self, db):
        project, _, _, _, elsewhere = setup(db)
        with pytest.raises(HTTPException) as e:
            add_project_keywords(project.id, KeywordsAddIn(keywords=["x"], job_id=elsewhere.id), db)
        assert e.value.status_code == 404 and elsewhere.keywords == ["wrong one"]

    def test_a_job_holds_at_most_a_thousand(self, db):
        project, _, phone, _, _ = setup(db)
        with pytest.raises(HTTPException) as e:
            add_project_keywords(project.id, KeywordsAddIn(
                keywords=[f"k{i}" for i in range(MAX_KEYWORDS_PER_JOB)], job_id=phone.id), db)
        assert e.value.status_code == 400 and len(phone.keywords) == 3

    def test_without_a_job_into_the_projects_own_list(self, db):
        project, _, phone, upload, _ = setup(db)
        got = add_project_keywords(project.id, KeywordsAddIn(keywords=["typed by hand"]), db)
        assert got == {"added": 1, "job_id": upload.id}
        assert upload.keywords[-1] == "typed by hand" and "typed by hand" not in phone.keywords

    def test_a_project_without_one_gets_it(self, db):
        project = Project(name="Fresh", domains=[])
        db.add(project)
        db.commit()
        got = add_project_keywords(project.id, KeywordsAddIn(keywords=["first"]), db)
        job = db.get(Job, got["job_id"])
        assert (job.project_id, job.provider, job.keywords) == (project.id, "csv", ["first"])
