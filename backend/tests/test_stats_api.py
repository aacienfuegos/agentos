"""Tests for /api/stats endpoint."""
from fastapi.testclient import TestClient


def test_stats_empty(app_client: TestClient):
    """GET /api/stats with no runs returns a well-shaped response with zeros."""
    response = app_client.get("/api/stats")
    assert response.status_code == 200
    data = response.json()

    assert "runs_today" in data
    assert "runs_this_month" in data
    assert "active_runs" in data
    assert "status_counts" in data
    assert "runs_by_agent_this_month" in data

    assert data["runs_today"] == 0
    assert data["runs_this_month"] == 0
    assert data["active_runs"] == 0
    assert data["runs_by_agent_this_month"] == {}
