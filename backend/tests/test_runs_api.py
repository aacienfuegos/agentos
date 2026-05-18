"""Tests for /api/runs endpoints."""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from agentos.models import AgentDefinition


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
