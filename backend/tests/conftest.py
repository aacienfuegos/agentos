"""Shared test fixtures for AgentOS backend tests."""
import os

# Set required env vars BEFORE any agentos imports so pydantic-settings
# validates.  The DATABASE_URL here is a placeholder; we override the engine
# directly below.
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("ADMIN_PASSWORD", "testpass")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import StaticPool
from sqlmodel import SQLModel, Session, create_engine

# ---------------------------------------------------------------------------
# Build a single in-memory engine that uses StaticPool so that ALL Sessions
# (including those opened inside stats.py, builtin.py, etc.) share the
# identical underlying SQLite connection and therefore the same database.
# ---------------------------------------------------------------------------
_ENGINE = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

# Patch every module that holds a reference to the real engine BEFORE importing
# anything else from agentos, so that `from ..database import engine` in those
# sub-modules resolves to our test engine.
import agentos.database as _db_module
_db_module.engine = _ENGINE  # database.py itself

# These modules are imported lazily (when agentos.main is imported below), but
# we patch the database module attribute first so the `from` imports in each
# sub-module capture our engine.
# (stats.py, builtin.py, scheduler.py, tasks.py all do
#  `from ..database import engine`)

from agentos.main import app  # noqa: E402  — must come after the patch
from agentos.database import get_session  # noqa: E402

# After importing the app the sub-modules have already bound their local
# `engine` names.  We must patch them individually too.
import agentos.api.stats as _stats_module
import agentos.agents.builtin as _builtin_module
import agentos.worker.scheduler as _scheduler_module
import agentos.api.execute as _execute_module

_stats_module.engine = _ENGINE
_builtin_module.engine = _ENGINE
_scheduler_module.engine = _ENGINE
_execute_module.engine = _ENGINE


def _test_get_session():
    """Dependency override: yield a Session on the StaticPool engine."""
    with Session(_ENGINE) as session:
        yield session


@pytest.fixture(autouse=True)
def _reset_db():
    """Create tables before each test; drop them after for isolation."""
    SQLModel.metadata.create_all(_ENGINE)
    yield
    SQLModel.metadata.drop_all(_ENGINE)


@pytest.fixture
def app_client(_reset_db):
    """Synchronous TestClient with the in-memory DB and no scheduler."""
    app.dependency_overrides[get_session] = _test_get_session

    with (
        patch(
            "agentos.worker.scheduler.start_scheduler",
            new_callable=AsyncMock,
        ),
        patch(
            "agentos.worker.scheduler.stop_scheduler",
            new_callable=AsyncMock,
        ),
        patch("agentos.main.verify_token", return_value=True),
    ):
        with TestClient(app, raise_server_exceptions=True) as client:
            yield client

    app.dependency_overrides.clear()


@pytest.fixture
def test_session(_reset_db):
    """Yield a direct Session for setup / assertions in tests."""
    with Session(_ENGINE) as session:
        yield session
