"""Tests for /api/agents CRUD endpoints."""
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from agentos.models import AgentDefinition


AGENT_PAYLOAD = {
    "id": "test-agent",
    "name": "Test Agent",
    "description": "A test agent",
    "system_prompt": "You are a test assistant.",
    "tools": [],
    "model": "claude-sonnet-4-6",
    "max_tokens": 4096,
    "timeout_seconds": 300,
}


def test_list_agents_empty(app_client: TestClient):
    """GET /api/agents returns a valid list; no user-created agents exist yet."""
    response = app_client.get("/api/agents")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    # The lifespan seeds built-in agents; verify no custom (non-builtin) agents.
    custom_agents = [a for a in data if not a["is_builtin"]]
    assert custom_agents == []


def test_create_agent(app_client: TestClient):
    response = app_client.post("/api/agents", json=AGENT_PAYLOAD)
    assert response.status_code == 201
    data = response.json()
    assert data["id"] == "test-agent"
    assert data["name"] == "Test Agent"
    assert data["model"] == "claude-sonnet-4-6"
    assert data["max_tokens"] == 4096
    assert data["is_builtin"] is False


def test_create_agent_duplicate(app_client: TestClient):
    app_client.post("/api/agents", json=AGENT_PAYLOAD)
    response = app_client.post("/api/agents", json=AGENT_PAYLOAD)
    assert response.status_code == 400
    assert "already exists" in response.json()["detail"]


def test_get_agent(app_client: TestClient):
    app_client.post("/api/agents", json=AGENT_PAYLOAD)
    response = app_client.get("/api/agents/test-agent")
    assert response.status_code == 200
    assert response.json()["id"] == "test-agent"


def test_get_agent_not_found(app_client: TestClient):
    response = app_client.get("/api/agents/nonexistent")
    assert response.status_code == 404


def test_update_agent(app_client: TestClient):
    app_client.post("/api/agents", json=AGENT_PAYLOAD)
    response = app_client.put(
        "/api/agents/test-agent",
        json={"name": "Updated Name"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Name"
    # Other fields unchanged
    assert response.json()["description"] == AGENT_PAYLOAD["description"]


def test_delete_agent(app_client: TestClient):
    app_client.post("/api/agents", json=AGENT_PAYLOAD)
    response = app_client.delete("/api/agents/test-agent")
    assert response.status_code == 204
    # Confirm it's gone
    assert app_client.get("/api/agents/test-agent").status_code == 404


def test_delete_builtin_agent(app_client: TestClient, test_session: Session):
    # Insert a builtin agent directly into the DB.
    builtin = AgentDefinition(
        id="builtin-agent",
        name="Builtin",
        description="A built-in agent",
        system_prompt="...",
        is_builtin=True,
    )
    test_session.add(builtin)
    test_session.commit()

    response = app_client.delete("/api/agents/builtin-agent")
    assert response.status_code == 400
    assert "built-in" in response.json()["detail"].lower()
