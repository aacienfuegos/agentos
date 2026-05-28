import sqlite3

from sqlmodel import SQLModel, create_engine, Session
from .config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
    echo=settings.is_dev,
)

_MIGRATIONS = [
    ("knowledge_agents", "max_tokens", "INTEGER NOT NULL DEFAULT 4096"),
    ("runs", "session_id", "TEXT"),
    ("knowledge_agents", "web_access", "INTEGER NOT NULL DEFAULT 0"),
    ("knowledge_agents", "write_access", "INTEGER NOT NULL DEFAULT 1"),
    ("knowledge_agents", "tools", 'TEXT DEFAULT \'["Read","Write"]\''),
]


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)
    _run_migrations()


def _run_migrations() -> None:
    db_path = settings.database_url.replace("sqlite:////", "/").replace("sqlite:///", "")
    if not db_path.startswith("/"):
        return
    conn = sqlite3.connect(db_path)
    try:
        for table, column, definition in _MIGRATIONS:
            existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
                conn.commit()
    except Exception:
        pass
    finally:
        conn.close()


def get_session():
    with Session(engine) as session:
        yield session
