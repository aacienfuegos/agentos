"""Tests for /api/stats endpoint."""
import pytest
from fastapi.testclient import TestClient


def test_stats_empty(app_client: TestClient):
    """GET /api/stats with no runs returns a well-shaped response with zeros."""
    response = app_client.get("/api/stats")
    assert response.status_code == 200
    data = response.json()

    # Required top-level keys
    assert "runs_today" in data
    assert "runs_this_month" in data
    assert "active_runs" in data
    assert "tokens_this_month" in data
    assert "cost_this_month_usd" in data
    assert "cost_by_agent" in data
    assert "monthly_budget_usd" in data
    assert "budget_used_pct" in data
    assert "budget_exceeded" in data

    # All counts should be zero with an empty DB
    assert data["runs_today"] == 0
    assert data["runs_this_month"] == 0
    assert data["active_runs"] == 0
    assert data["tokens_this_month"]["input"] == 0
    assert data["tokens_this_month"]["output"] == 0
    assert data["tokens_this_month"]["total"] == 0
    assert data["cost_this_month_usd"] == 0.0
    assert data["cost_by_agent"] == {}
    assert data["budget_exceeded"] is False
