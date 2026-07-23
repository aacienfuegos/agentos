from sqlmodel import SQLModel, create_engine, Session
from .config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
    echo=settings.is_dev,
)


def create_db_and_tables() -> None:
    # In production, schema is managed by Alembic (entrypoint.sh runs alembic upgrade head).
    # This call is kept for local dev runs (uv run uvicorn --reload) and tests.
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
