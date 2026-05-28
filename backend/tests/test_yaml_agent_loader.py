"""Tests for YAML-based agent loader (agents/builtin.py)."""
from pathlib import Path
from unittest.mock import patch

import yaml
from sqlmodel import Session

from agentos.agents.builtin import _load_yaml_agents, seed_builtin_agents
from agentos.models import AgentDefinition


def _write_yaml(directory: Path, filename: str, data: dict) -> Path:
    path = directory / filename
    with open(path, "w") as f:
        yaml.dump(data, f)
    return path


# ---------------------------------------------------------------------------
# _load_yaml_agents
# ---------------------------------------------------------------------------

def test_load_yaml_agents_missing_dir(tmp_path: Path):
    nonexistent = tmp_path / "no_agents_here"
    with patch("agentos.agents.builtin.AGENTS_CONFIG_DIR", nonexistent):
        result = _load_yaml_agents()
    assert result == []


def test_load_yaml_agents_empty_dir(tmp_path: Path):
    with patch("agentos.agents.builtin.AGENTS_CONFIG_DIR", tmp_path):
        result = _load_yaml_agents()
    assert result == []


def test_load_yaml_agents_valid(tmp_path: Path):
    _write_yaml(tmp_path, "my_agent.yaml", {
        "id": "my-agent",
        "name": "My Agent",
        "description": "Does stuff",
        "system_prompt": "You are helpful.",
        "tools": ["Bash"],
        "model": "claude-sonnet-4-6",
        "max_tokens": 2048,
        "timeout_seconds": 120,
    })
    with patch("agentos.agents.builtin.AGENTS_CONFIG_DIR", tmp_path):
        result = _load_yaml_agents()
    assert len(result) == 1
    assert result[0]["id"] == "my-agent"
    assert result[0]["is_builtin"] is False  # default injected


def test_load_yaml_agents_multiple_files(tmp_path: Path):
    for i in range(3):
        _write_yaml(tmp_path, f"agent_{i}.yaml", {"id": f"agent-{i}", "name": f"Agent {i}"})
    with patch("agentos.agents.builtin.AGENTS_CONFIG_DIR", tmp_path):
        result = _load_yaml_agents()
    ids = {r["id"] for r in result}
    assert ids == {"agent-0", "agent-1", "agent-2"}


def test_load_yaml_agents_skips_missing_id(tmp_path: Path, caplog):
    _write_yaml(tmp_path, "bad.yaml", {"name": "No ID here"})
    with patch("agentos.agents.builtin.AGENTS_CONFIG_DIR", tmp_path):
        result = _load_yaml_agents()
    assert result == []
    assert "missing 'id'" in caplog.text


def test_load_yaml_agents_skips_invalid_yaml(tmp_path: Path, caplog):
    (tmp_path / "broken.yaml").write_text(": this is : not : valid yaml :::")
    with patch("agentos.agents.builtin.AGENTS_CONFIG_DIR", tmp_path):
        result = _load_yaml_agents()
    assert result == []
    assert "Error loading agent" in caplog.text


def test_load_yaml_agents_continues_after_error(tmp_path: Path):
    _write_yaml(tmp_path, "a_broken.yaml", {"name": "no id"})
    _write_yaml(tmp_path, "z_good.yaml", {"id": "good-agent", "name": "Good"})
    with patch("agentos.agents.builtin.AGENTS_CONFIG_DIR", tmp_path):
        result = _load_yaml_agents()
    assert len(result) == 1
    assert result[0]["id"] == "good-agent"


def test_load_yaml_agents_yml_extension(tmp_path: Path):
    _write_yaml(tmp_path, "agent.yml", {"id": "yml-agent", "name": "YML"})
    with patch("agentos.agents.builtin.AGENTS_CONFIG_DIR", tmp_path):
        result = _load_yaml_agents()
    assert any(r["id"] == "yml-agent" for r in result)


# ---------------------------------------------------------------------------
# seed_builtin_agents — YAML integration
# ---------------------------------------------------------------------------

def test_seed_creates_yaml_agent(tmp_path: Path, test_session: Session):
    _write_yaml(tmp_path, "custom.yaml", {
        "id": "yaml-agent",
        "name": "YAML Agent",
        "description": "From YAML",
        "system_prompt": "Help the user.",
        "tools": ["Read"],
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 1024,
        "timeout_seconds": 60,
    })
    with patch("agentos.agents.builtin.AGENTS_CONFIG_DIR", tmp_path):
        seed_builtin_agents()
    agent = test_session.get(AgentDefinition, "yaml-agent")
    assert agent is not None
    assert agent.name == "YAML Agent"
    assert agent.is_builtin is False


def test_seed_updates_existing_yaml_agent(tmp_path: Path, test_session: Session):
    existing = AgentDefinition(
        id="yaml-agent",
        name="Old Name",
        description="Old desc",
        system_prompt="Old prompt",
    )
    test_session.add(existing)
    test_session.commit()

    _write_yaml(tmp_path, "custom.yaml", {
        "id": "yaml-agent",
        "name": "New Name",
        "system_prompt": "New prompt.",
    })
    with patch("agentos.agents.builtin.AGENTS_CONFIG_DIR", tmp_path):
        seed_builtin_agents()

    test_session.expire_all()
    agent = test_session.get(AgentDefinition, "yaml-agent")
    assert agent.name == "New Name"
    assert agent.system_prompt == "New prompt."


def test_seed_does_not_fail_on_broken_yaml(tmp_path: Path):
    (tmp_path / "broken.yaml").write_text("::not yaml::")
    with patch("agentos.agents.builtin.AGENTS_CONFIG_DIR", tmp_path):
        seed_builtin_agents()  # must not raise
