"""Tests for /api/knowledge-agents CRUD endpoints."""
from fastapi.testclient import TestClient


AGENT_PAYLOAD = {
    "id": "homelab",
    "name": "Homelab",
    "description": "Documentación de infraestructura doméstica",
    "system_prompt": "Eres un experto en homelab.",
    "knowledge_doc": "# Homelab\n\nInfraestructura basada en Proxmox.",
    "model": "claude-sonnet-4-6",
}


def test_list_empty(app_client: TestClient):
    response = app_client.get("/api/knowledge-agents")
    assert response.status_code == 200
    assert response.json() == []


def test_create(app_client: TestClient):
    response = app_client.post("/api/knowledge-agents", json=AGENT_PAYLOAD)
    assert response.status_code == 201
    data = response.json()
    assert data["id"] == "homelab"
    assert data["name"] == "Homelab"
    assert data["knowledge_doc"] == AGENT_PAYLOAD["knowledge_doc"]


def test_create_duplicate(app_client: TestClient):
    app_client.post("/api/knowledge-agents", json=AGENT_PAYLOAD)
    response = app_client.post("/api/knowledge-agents", json=AGENT_PAYLOAD)
    assert response.status_code == 400
    assert "already exists" in response.json()["detail"]


def test_get(app_client: TestClient):
    app_client.post("/api/knowledge-agents", json=AGENT_PAYLOAD)
    response = app_client.get("/api/knowledge-agents/homelab")
    assert response.status_code == 200
    assert response.json()["id"] == "homelab"


def test_get_not_found(app_client: TestClient):
    response = app_client.get("/api/knowledge-agents/nonexistent")
    assert response.status_code == 404


def test_update(app_client: TestClient):
    app_client.post("/api/knowledge-agents", json=AGENT_PAYLOAD)
    response = app_client.put(
        "/api/knowledge-agents/homelab",
        json={"name": "Homelab Updated", "knowledge_doc": "# Updated"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Homelab Updated"
    assert data["knowledge_doc"] == "# Updated"
    # Other fields unchanged
    assert data["description"] == AGENT_PAYLOAD["description"]


def test_update_not_found(app_client: TestClient):
    response = app_client.put("/api/knowledge-agents/nonexistent", json={"name": "X"})
    assert response.status_code == 404


def test_delete(app_client: TestClient):
    app_client.post("/api/knowledge-agents", json=AGENT_PAYLOAD)
    response = app_client.delete("/api/knowledge-agents/homelab")
    assert response.status_code == 204
    assert app_client.get("/api/knowledge-agents/homelab").status_code == 404


def test_delete_not_found(app_client: TestClient):
    assert app_client.delete("/api/knowledge-agents/nonexistent").status_code == 404


def test_export_document(app_client: TestClient):
    app_client.post("/api/knowledge-agents", json=AGENT_PAYLOAD)
    response = app_client.get("/api/knowledge-agents/homelab/document")
    assert response.status_code == 200
    assert "text/markdown" in response.headers["content-type"]
    assert response.text == AGENT_PAYLOAD["knowledge_doc"]


def test_export_document_not_found(app_client: TestClient):
    assert app_client.get("/api/knowledge-agents/nonexistent/document").status_code == 404


def test_import_document(app_client: TestClient):
    app_client.post("/api/knowledge-agents", json=AGENT_PAYLOAD)
    new_doc = "# Nueva versión\n\nContenido actualizado."
    response = app_client.put(
        "/api/knowledge-agents/homelab/document",
        content=new_doc,
        headers={"Content-Type": "text/markdown"},
    )
    assert response.status_code == 200
    assert response.json()["knowledge_doc"] == new_doc

    # Verify persisted
    assert app_client.get("/api/knowledge-agents/homelab").json()["knowledge_doc"] == new_doc


def test_list_after_create(app_client: TestClient):
    app_client.post("/api/knowledge-agents", json=AGENT_PAYLOAD)
    response = app_client.get("/api/knowledge-agents")
    assert len(response.json()) == 1
    assert response.json()[0]["id"] == "homelab"
