"""Tests for POST /api/execute (sync and async modes)."""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from agentos.models import Run, RunStatus
from agentos.runner.claude_code import RunResult


_VALID_REQUEST = {"prompt": "Say hello", "timeout_seconds": 30}


def test_execute_sync_success(app_client: TestClient):
    mock_result = RunResult(output='{"hello": "world"}', tokens_input=10, tokens_output=5)

    with patch("agentos.api.execute.ClaudeCodeRunner") as MockRunner:
        instance = MockRunner.return_value
        instance.run = AsyncMock(return_value=mock_result)
        resp = app_client.post("/api/execute", json=_VALID_REQUEST)

    assert resp.status_code == 200
    data = resp.json()
    assert data["output"] == '{"hello": "world"}'
    assert data["tokens_input"] == 10
    assert data["tokens_output"] == 5
    assert "run_id" in data


def test_execute_sync_creates_run_in_db(app_client: TestClient):
    mock_result = RunResult(output="done", tokens_input=1, tokens_output=1)

    with patch("agentos.api.execute.ClaudeCodeRunner") as MockRunner:
        instance = MockRunner.return_value
        instance.run = AsyncMock(return_value=mock_result)
        resp = app_client.post("/api/execute", json=_VALID_REQUEST)

    assert resp.status_code == 200
    run_id = resp.json()["run_id"]

    # Verify via the API (avoids cross-engine issues from test_worker_task.py patching)
    run_resp = app_client.get(f"/api/runs/{run_id}")
    assert run_resp.status_code == 200
    run_data = run_resp.json()
    assert run_data["agent_id"] == "__execute__"
    assert run_data["triggered_by"] == "api"
    assert run_data["status"] == "success"


def test_execute_sync_timeout(app_client: TestClient):
    import asyncio

    with patch("agentos.api.execute.ClaudeCodeRunner") as MockRunner:
        instance = MockRunner.return_value
        instance.run = AsyncMock(side_effect=asyncio.TimeoutError())
        resp = app_client.post("/api/execute", json={**_VALID_REQUEST, "timeout_seconds": 5})

    assert resp.status_code == 408
    data = resp.json()
    assert "error" in data["detail"]
    assert "run_id" in data["detail"]


def test_execute_sync_error(app_client: TestClient):
    with patch("agentos.api.execute.ClaudeCodeRunner") as MockRunner:
        instance = MockRunner.return_value
        instance.run = AsyncMock(side_effect=RuntimeError("claude failed"))
        resp = app_client.post("/api/execute", json=_VALID_REQUEST)

    assert resp.status_code == 500
    data = resp.json()
    assert "claude failed" in data["detail"]["error"]


def test_execute_async_mode(app_client: TestClient):
    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock()
    mock_pool.aclose = AsyncMock()

    with patch("agentos.api.execute.create_pool", return_value=mock_pool):
        resp = app_client.post("/api/execute", json={**_VALID_REQUEST, "async": True})

    assert resp.status_code == 200
    data = resp.json()
    assert "run_id" in data
    assert data["status"] == "pending"
    mock_pool.enqueue_job.assert_awaited_once()


def test_execute_timeout_validation(app_client: TestClient):
    """timeout_seconds must be between 5 and 600."""
    resp = app_client.post("/api/execute", json={**_VALID_REQUEST, "timeout_seconds": 1})
    assert resp.status_code == 422

    resp = app_client.post("/api/execute", json={**_VALID_REQUEST, "timeout_seconds": 9999})
    assert resp.status_code == 422


def test_execute_budget_exceeded(app_client: TestClient):
    from agentos.api.execute import _check_budget
    with patch("agentos.api.execute._check_budget", side_effect=__import__("fastapi").HTTPException(402, "budget")):
        resp = app_client.post("/api/execute", json=_VALID_REQUEST)
    assert resp.status_code == 402


def test_execute_too_many_concurrent(app_client: TestClient):
    from agentos.api.execute import _check_concurrency
    with patch("agentos.api.execute._check_concurrency", side_effect=__import__("fastapi").HTTPException(429, "too many")):
        resp = app_client.post("/api/execute", json=_VALID_REQUEST)
    assert resp.status_code == 429
