"""Tests for /api/stats endpoint."""
from datetime import datetime

from fastapi.testclient import TestClient
from sqlmodel import Session

from agentos.models import Run, RunStatus


def test_stats_empty(app_client: TestClient):
    """GET /api/stats with no runs returns a well-shaped response with zeros."""
    response = app_client.get("/api/stats")
    assert response.status_code == 200
    data = response.json()

    assert data["runs_today"] == 0
    assert data["runs_this_month"] == 0
    assert data["active_runs"] == 0
    assert data["scheduled_jobs"] == 0
    assert data["runs_by_agent_this_month"] == {}
    assert data["tokens_this_month"] == {"input": 0, "output": 0, "total": 0}
    assert data["cost_this_month_usd"] == 0.0
    assert data["cost_by_agent"] == {}
    assert "monthly_budget_usd" in data
    assert data["budget_exceeded"] is False


def test_stats_with_runs(app_client: TestClient, test_session: Session):
    """Stats correctly aggregate tokens and cost from completed runs."""
    now = datetime.utcnow()
    run = Run(
        agent_id="code-review",
        status=RunStatus.success,
        triggered_by="manual",
        tokens_input=500,
        tokens_output=300,
        cost_usd=0.005,
        started_at=now,
        finished_at=now,
        created_at=now,
    )
    test_session.add(run)
    test_session.commit()

    response = app_client.get("/api/stats")
    assert response.status_code == 200
    data = response.json()

    assert data["runs_today"] == 1
    assert data["runs_this_month"] == 1
    assert data["tokens_this_month"]["input"] == 500
    assert data["tokens_this_month"]["output"] == 300
    assert data["tokens_this_month"]["total"] == 800
    assert data["cost_this_month_usd"] == 0.005
    assert "code-review" in data["cost_by_agent"]


def test_stats_budget_exceeded(app_client: TestClient, test_session: Session):
    """budget_exceeded is True when cost_this_month_usd > monthly_budget_usd."""
    now = datetime.utcnow()
    # Add a run whose cost exceeds any sane budget
    run = Run(
        agent_id="code-review",
        status=RunStatus.success,
        triggered_by="manual",
        cost_usd=9999.0,
        started_at=now,
        finished_at=now,
        created_at=now,
    )
    test_session.add(run)
    test_session.commit()

    response = app_client.get("/api/stats")
    data = response.json()
    assert data["budget_exceeded"] is True
