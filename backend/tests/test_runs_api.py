"""Tests for /api/runs endpoints."""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

import agentos.api.runs as _runs_module
from agentos.models import AgentDefinition, InfraTarget


AGENT_PAYLOAD = {
    "id": "run-agent",
    "name": "Run Agent",
    "description": "Agent for run tests",
    "system_prompt": "You run things.",
}


def _create_agent(client: TestClient) -> None:
    resp = client.post("/api/agents", json=AGENT_PAYLOAD)
    assert resp.status_code == 201


def test_list_runs_empty(app_client: TestClient):
    response = app_client.get("/api/runs")
    assert response.status_code == 200
    assert response.json() == []


def test_get_run_not_found(app_client: TestClient):
    response = app_client.get("/api/runs/nonexistent")
    assert response.status_code == 404


def test_create_run_agent_not_found(app_client: TestClient):
    """POST /api/runs with a non-existent agent_id should return 404."""
    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock()
    mock_pool.aclose = AsyncMock()

    with patch("agentos.api.runs.create_pool", return_value=mock_pool):
        response = app_client.post(
            "/api/runs",
            json={"agent_id": "does-not-exist", "input_params": {}},
        )

    assert response.status_code == 404


def test_create_run_success(app_client: TestClient):
    """POST /api/runs with a valid agent_id creates a run (status=pending)."""
    _create_agent(app_client)

    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock()
    mock_pool.aclose = AsyncMock()

    with patch("agentos.api.runs.create_pool", return_value=mock_pool):
        response = app_client.post(
            "/api/runs",
            json={"agent_id": "run-agent", "input_params": {}},
        )

    assert response.status_code == 201
    data = response.json()
    assert data["agent_id"] == "run-agent"
    assert data["status"] == "pending"
    # Verify the background job was enqueued
    mock_pool.enqueue_job.assert_awaited_once()


def test_create_run_infra_architect_disabled(app_client: TestClient):
    """POST /api/runs for infra-architect must 403 when INFRA_AGENTS_ENABLED=false,
    even if the agent row already exists (e.g. seeded while the flag was true)."""
    resp = app_client.post(
        "/api/agents",
        json={
            "id": "infra-architect",
            "name": "Infra Architect",
            "description": "desc",
            "system_prompt": "Eres un arquitecto de infraestructura en modo solo lectura.",
        },
    )
    assert resp.status_code == 201

    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock()
    mock_pool.aclose = AsyncMock()

    with patch("agentos.api.runs.create_pool", return_value=mock_pool):
        response = app_client.post(
            "/api/runs",
            json={"agent_id": "infra-architect", "input_params": {}},
        )

    assert response.status_code == 403
    mock_pool.enqueue_job.assert_not_awaited()


def _create_infra_architect(client: TestClient) -> None:
    resp = client.post(
        "/api/agents",
        json={
            "id": "infra-architect",
            "name": "Infra Architect",
            "description": "desc",
            "system_prompt": "Eres un arquitecto de infraestructura en modo solo lectura.",
        },
    )
    assert resp.status_code == 201


def test_create_run_infra_architect_target_not_found(app_client: TestClient):
    """target_id pointing at a nonexistent InfraTarget must 404, not silently run."""
    _create_infra_architect(app_client)

    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock()
    mock_pool.aclose = AsyncMock()

    with (
        patch.object(_runs_module.settings, "infra_agents_enabled", True),
        patch("agentos.api.runs.create_pool", return_value=mock_pool),
    ):
        response = app_client.post(
            "/api/runs",
            json={"agent_id": "infra-architect", "input_params": {"target_id": "ghost-target"}},
        )

    assert response.status_code == 404
    mock_pool.enqueue_job.assert_not_awaited()


def test_create_run_infra_architect_target_unverified(app_client: TestClient, test_session: Session):
    """A target whose host key hasn't been fixed via TOFU (verify-host) must
    block run creation — never hand the agent an SSH command without a pinned
    known_hosts entry."""
    _create_infra_architect(app_client)
    test_session.add(InfraTarget(
        id="homelab-dev",
        name="Homelab Dev",
        host="homelab-dev.internal",
        ssh_user="agentos",
        ssh_port=2222,
    ))
    test_session.commit()

    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock()
    mock_pool.aclose = AsyncMock()

    with (
        patch.object(_runs_module.settings, "infra_agents_enabled", True),
        patch("agentos.api.runs.create_pool", return_value=mock_pool),
    ):
        response = app_client.post(
            "/api/runs",
            json={"agent_id": "infra-architect", "input_params": {"target_id": "homelab-dev"}},
        )

    assert response.status_code == 400
    assert "Verificar host" in response.json()["detail"]
    mock_pool.enqueue_job.assert_not_awaited()


def test_create_run_infra_architect_target_verified(app_client: TestClient, test_session: Session):
    """A verified target (known_hosts_entry set) allows the run to proceed."""
    _create_infra_architect(app_client)
    test_session.add(InfraTarget(
        id="homelab-dev",
        name="Homelab Dev",
        host="homelab-dev.internal",
        ssh_user="agentos",
        ssh_port=2222,
        known_hosts_entry="homelab-dev.internal ssh-ed25519 AAAAtest",
        host_key_fingerprint="256 SHA256:test test.internal (ED25519)",
    ))
    test_session.commit()

    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock()
    mock_pool.aclose = AsyncMock()

    with (
        patch.object(_runs_module.settings, "infra_agents_enabled", True),
        patch("agentos.api.runs.create_pool", return_value=mock_pool),
    ):
        response = app_client.post(
            "/api/runs",
            json={"agent_id": "infra-architect", "input_params": {"target_id": "homelab-dev"}},
        )

    assert response.status_code == 201
    mock_pool.enqueue_job.assert_awaited_once()
