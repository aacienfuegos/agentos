"""Tests for run_agent_task to catch SQLAlchemy DetachedInstanceError regressions."""
import os

os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("ADMIN_PASSWORD", "testpass")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import StaticPool
from sqlmodel import Session, SQLModel, create_engine

import agentos.database as _db_module

_ENGINE = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_db_module.engine = _ENGINE

import agentos.worker.tasks as _tasks_module
import agentos.runner.claude_code as _runner_module

_tasks_module.engine = _ENGINE
_runner_module.engine = _ENGINE

from agentos.models import AgentDefinition, Run, RunStatus
from agentos.runner.claude_code import RunResult
from agentos.worker.tasks import run_agent_task


@pytest.fixture(autouse=True)
def _reset_db():
    SQLModel.metadata.create_all(_ENGINE)
    yield
    SQLModel.metadata.drop_all(_ENGINE)


@pytest.fixture
def db_session(_reset_db):
    with Session(_ENGINE) as session:
        yield session


def _make_agent(session: Session) -> AgentDefinition:
    agent = AgentDefinition(
        id="test-agent",
        name="Test Agent",
        description="desc",
        system_prompt="You are helpful.",
        tools=[],
        model="claude-sonnet-4-6",
        timeout_seconds=30,
    )
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return agent


def _make_run(session: Session, agent_id: str) -> Run:
    run = Run(agent_id=agent_id, input_params={"user_message": "hello"})
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


@pytest.mark.asyncio
async def test_run_agent_task_no_detached_instance_error(db_session):
    """Ensure run_agent_task does not raise DetachedInstanceError after session closes."""
    agent = _make_agent(db_session)
    run = _make_run(db_session, agent.id)
    run_id = run.id

    mock_result = RunResult(output="done", tokens_input=10, tokens_output=20)

    with (
        patch.object(_tasks_module.ClaudeCodeRunner, "run", new=AsyncMock(return_value=mock_result)),
        patch("agentos.worker.tasks.send_notification", new=AsyncMock()),
    ):
        await run_agent_task({}, run_id)

    with Session(_ENGINE) as s:
        finished = s.get(Run, run_id)
        assert finished is not None
        assert finished.status == RunStatus.success, f"run failed with: {finished.error}"
        assert finished.output == "done"


@pytest.mark.asyncio
async def test_run_agent_task_agent_not_found(db_session):
    run = Run(agent_id="ghost-agent", input_params={})
    db_session.add(run)
    db_session.commit()
    run_id = run.id

    await run_agent_task({}, run_id)

    with Session(_ENGINE) as s:
        finished = s.get(Run, run_id)
        assert finished.status == RunStatus.failed
        assert "ghost-agent" in finished.error


@pytest.mark.asyncio
async def test_run_agent_task_run_not_found(db_session):
    # Should silently return without error
    await run_agent_task({}, "nonexistent-run-id")


@pytest.mark.asyncio
async def test_run_agent_task_marks_failed_on_exception(db_session):
    agent = _make_agent(db_session)
    run = _make_run(db_session, agent.id)
    run_id = run.id

    with (
        patch.object(_tasks_module.ClaudeCodeRunner, "run", new=AsyncMock(side_effect=RuntimeError("boom"))),
        patch("agentos.worker.tasks.send_notification", new=AsyncMock()),
    ):
        await run_agent_task({}, run_id)

    with Session(_ENGINE) as s:
        finished = s.get(Run, run_id)
        assert finished.status == RunStatus.failed
        assert "boom" in finished.error
