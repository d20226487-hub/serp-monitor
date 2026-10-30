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
    live_clusters, remove_project_keywords, set_clusters,
)


class TestTheLists:
    def test_removing_ignores_case_and_spaces(self):
        assert drop_keywords(["Casino", " casino online ", "bonus"], {"casino", "casino online"}) == ["bonus"]

    def test_stray_separators_are_not_part_of_a_keyword(self):
        assert add_keywords(["casino online"], ["casino online,", " ;slots, "]) == (
            ["casino online", "slots"], ["slots"])
        assert set_clusters({}, {"casino online,": " Brand;"}) == {"casino online": "Brand"}

    def test_adding_keeps_order_and_skips_what_is_there(self):
        assert add_keywords(["a", "B"], ["b", "c", " ", "C", " d "]) == (["a", "B", "c", "d"], ["c", "d"])


@pytest.fixture
def db():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    # As the app's own sessions: no flush before a query.
    with sessionmaker(bind=engine, autoflush=False)() as session:
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
        assert got == {"added": 2, "job_id": upload.id, "clusters": 0}
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
        assert got == {"added": 1, "job_id": upload.id, "clusters": 0}
        assert upload.keywords[-1] == "typed by hand" and "typed by hand" not in phone.keywords

    def test_a_project_without_one_gets_it(self, db):
        project = Project(name="Fresh", domains=[])
        db.add(project)
        db.commit()
        got = add_project_keywords(project.id, KeywordsAddIn(keywords=["first"]), db)
        job = db.get(Job, got["job_id"])
        assert (job.project_id, job.provider, job.keywords) == (project.id, "csv", ["first"])


class TestClusters:
    """User, 2026-10-29: "let the user add the cluster next to the keyword
    (keyword, cluster)"."""

    def test_by_the_keyword_whatever_its_case_and_an_empty_one_removes(self):
        assert set_clusters({"bonus": "Old"}, {" Casino ": " Brand ", "BONUS": "", "x": None}) == {"casino": "Brand"}

    def test_set_with_the_keywords_added(self, db):
        project, _other, phone, upload, _ = setup(db)
        add_project_keywords(project.id, KeywordsAddIn(keywords=["slots"], clusters={"slots": "Games", "casino": "Brand"}), db)
        assert project.keyword_clusters == {"slots": "Games", "casino": "Brand"}
        assert "slots" in upload.keywords and phone.keywords == ["casino", "Wrong one", "bonus"]

    def test_only_clusters_touches_no_job_and_makes_none(self, db):
        project, _other, phone, upload, _ = setup(db)
        got = add_project_keywords(project.id, KeywordsAddIn(clusters={"casino": "Brand"}), db)
        assert got["job_id"] is None and (phone.keywords, upload.keywords) == (
            ["casino", "Wrong one", "bonus"], ["wrong one", "wrong two"])
        assert project.keyword_clusters == {"casino": "Brand"}
        fresh = Project(name="Fresh", domains=[])
        db.add(fresh)
        db.commit()
        add_project_keywords(fresh.id, KeywordsAddIn(clusters={"casino": "Brand"}), db)
        assert db.query(Job).filter(Job.project_id == fresh.id).count() == 0
        # Not a keyword of the project's: no cluster is kept for it.
        assert fresh.keyword_clusters is None

    def test_a_keyword_gone_another_way_leaves_its_cluster_behind_until_a_save(self, db):
        """User, 2026-10-30: "list only clusters of keywords the project still
        has, and drop the leftovers when keywords are saved"."""
        project, _other, phone, upload, _ = setup(db)
        add_project_keywords(project.id, KeywordsAddIn(clusters={"casino": "Brand", "wrong two": "Other"}), db)
        upload.keywords = ["wrong one"]          # edited elsewhere: "wrong two" left the project
        db.commit()
        assert live_clusters(db, project) == {"casino": "Brand"}
        assert project.keyword_clusters == {"casino": "Brand", "wrong two": "Other"}
        add_project_keywords(project.id, KeywordsAddIn(keywords=["slots"]), db)
        assert project.keyword_clusters == {"casino": "Brand"}

    def test_a_removed_keyword_takes_its_cluster_and_clear_all_takes_them_all(self, db):
        project, *_ = setup(db)
        add_project_keywords(project.id, KeywordsAddIn(clusters={"casino": "Brand", "bonus": "Promo"}), db)
        remove_project_keywords(project.id, KeywordsRemoveIn(keywords=["CASINO"]), db)
        assert project.keyword_clusters == {"bonus": "Promo"}
        remove_project_keywords(project.id, KeywordsRemoveIn(all=True), db)
        assert project.keyword_clusters is None
