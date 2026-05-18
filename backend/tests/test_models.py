"""Tests for SQLModel models and RunStatus enum."""
import pytest

from agentos.models import AgentDefinition, Run, RunStatus


def test_run_status_enum():
    assert RunStatus.pending == "pending"
    assert RunStatus.running == "running"
    assert RunStatus.success == "success"
    assert RunStatus.failed == "failed"
    assert RunStatus.cancelled == "cancelled"


def test_agent_definition_defaults():
    agent = AgentDefinition(
        id="my-agent",
        name="My Agent",
        description="desc",
        system_prompt="prompt",
    )
    assert agent.model == "claude-sonnet-4-6"
    assert agent.max_tokens == 4096
    assert agent.timeout_seconds == 300
    assert agent.is_builtin is False
    assert agent.tools == []


def test_run_created_pending():
    run = Run(agent_id="some-agent")
    assert run.status == RunStatus.pending
    assert run.triggered_by == "manual"
    assert run.output is None
    assert run.error is None
