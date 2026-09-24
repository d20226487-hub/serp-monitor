from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings
from .search import register_sqlite_functions

IS_SQLITE = settings.database_url.startswith("sqlite")

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if IS_SQLITE else {},
    pool_pre_ping=True,
)

if IS_SQLITE:
    @event.listens_for(engine, "connect")
    def _register_sqlite_functions(dbapi_connection, _record):
        """Per CONNECTION, not per engine: SQLite user functions live on the
        connection, and the pool opens several. A function registered once at
        startup would be missing from every connection opened afterwards."""
        register_sqlite_functions(dbapi_connection)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
