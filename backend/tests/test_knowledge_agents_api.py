"""Tests for /api/knowledge-agents CRUD and file browser endpoints."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


AGENT_PAYLOAD = {
    "id": "homelab",
    "name": "Homelab",
    "description": "Documentación de infraestructura doméstica",
    "system_prompt": "Eres un experto en homelab.",
    "model": "claude-sonnet-4-6",
}


def test_list_empty(app_client: TestClient):
    response = app_client.get("/api/knowledge-agents")
    assert response.status_code == 200
    assert response.json() == []


def test_create(app_client: TestClient, tmp_path: Path):
    payload = {**AGENT_PAYLOAD, "knowledge_path": str(tmp_path / "homelab")}
    response = app_client.post("/api/knowledge-agents", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["id"] == "homelab"
    assert data["name"] == "Homelab"
    assert data["knowledge_path"] == str(tmp_path / "homelab")


def test_create_auto_path(app_client: TestClient):
    """When knowledge_path is omitted, a default path under /data/knowledge/ is assigned."""
    response = app_client.post("/api/knowledge-agents", json=AGENT_PAYLOAD)
    assert response.status_code == 201
    data = response.json()
    assert data["knowledge_path"] == "/data/knowledge/homelab"


def test_create_duplicate(app_client: TestClient, tmp_path: Path):
    payload = {**AGENT_PAYLOAD, "knowledge_path": str(tmp_path / "homelab")}
    app_client.post("/api/knowledge-agents", json=payload)
    response = app_client.post("/api/knowledge-agents", json=payload)
    assert response.status_code == 400
    assert "already exists" in response.json()["detail"]


def test_get(app_client: TestClient, tmp_path: Path):
    payload = {**AGENT_PAYLOAD, "knowledge_path": str(tmp_path / "homelab")}
    app_client.post("/api/knowledge-agents", json=payload)
    response = app_client.get("/api/knowledge-agents/homelab")
    assert response.status_code == 200
    assert response.json()["id"] == "homelab"


def test_get_not_found(app_client: TestClient):
    response = app_client.get("/api/knowledge-agents/nonexistent")
    assert response.status_code == 404


def test_update(app_client: TestClient, tmp_path: Path):
    payload = {**AGENT_PAYLOAD, "knowledge_path": str(tmp_path / "homelab")}
    app_client.post("/api/knowledge-agents", json=payload)
    response = app_client.put(
        "/api/knowledge-agents/homelab",
        json={"name": "Homelab Updated"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Homelab Updated"
    assert data["description"] == AGENT_PAYLOAD["description"]


def test_update_not_found(app_client: TestClient):
    response = app_client.put("/api/knowledge-agents/nonexistent", json={"name": "X"})
    assert response.status_code == 404


def test_delete(app_client: TestClient, tmp_path: Path):
    payload = {**AGENT_PAYLOAD, "knowledge_path": str(tmp_path / "homelab")}
    app_client.post("/api/knowledge-agents", json=payload)
    response = app_client.delete("/api/knowledge-agents/homelab")
    assert response.status_code == 204
    assert app_client.get("/api/knowledge-agents/homelab").status_code == 404


def test_delete_not_found(app_client: TestClient):
    assert app_client.delete("/api/knowledge-agents/nonexistent").status_code == 404


def test_list_after_create(app_client: TestClient, tmp_path: Path):
    payload = {**AGENT_PAYLOAD, "knowledge_path": str(tmp_path / "homelab")}
    app_client.post("/api/knowledge-agents", json=payload)
    response = app_client.get("/api/knowledge-agents")
    assert len(response.json()) == 1
    assert response.json()[0]["id"] == "homelab"


# ---------------------------------------------------------------------------
# File browser endpoints
# ---------------------------------------------------------------------------

@pytest.fixture
def agent_with_dir(app_client: TestClient, tmp_path: Path):
    kpath = tmp_path / "homelab"
    kpath.mkdir()
    (kpath / "README.md").write_text("# Homelab\n", encoding="utf-8")
    (kpath / "infra").mkdir()
    (kpath / "infra" / "docker.md").write_text("# Docker\n", encoding="utf-8")
    payload = {**AGENT_PAYLOAD, "knowledge_path": str(kpath)}
    app_client.post("/api/knowledge-agents", json=payload)
    return str(kpath)


def test_list_files(app_client: TestClient, agent_with_dir):
    response = app_client.get("/api/knowledge-agents/homelab/files")
    assert response.status_code == 200
    paths = [f["path"] for f in response.json()]
    assert "README.md" in paths
    assert "infra/docker.md" in paths


def test_list_files_empty_when_dir_inaccessible(app_client: TestClient):
    """Returns empty list when knowledge_path is inaccessible (e.g. auto-path in test env)."""
    # Auto-path /data/knowledge/homelab cannot be created in test env → dir stays missing
    response = app_client.post("/api/knowledge-agents", json=AGENT_PAYLOAD)
    assert response.status_code == 201
    response = app_client.get("/api/knowledge-agents/homelab/files")
    assert response.status_code == 200
    assert response.json() == []


def test_get_file(app_client: TestClient, agent_with_dir):
    response = app_client.get("/api/knowledge-agents/homelab/files/README.md")
    assert response.status_code == 200
    assert "# Homelab" in response.text


def test_get_file_nested(app_client: TestClient, agent_with_dir):
    response = app_client.get("/api/knowledge-agents/homelab/files/infra/docker.md")
    assert response.status_code == 200
    assert "# Docker" in response.text


def test_get_file_not_found(app_client: TestClient, agent_with_dir):
    response = app_client.get("/api/knowledge-agents/homelab/files/nope.md")
    assert response.status_code == 404


def test_get_file_traversal(app_client: TestClient, agent_with_dir):
    response = app_client.get("/api/knowledge-agents/homelab/files/../../etc/passwd")
    assert response.status_code in (400, 404)


def test_update_file(app_client: TestClient, agent_with_dir):
    new_content = "# Homelab actualizado\n\nNuevo contenido."
    response = app_client.put(
        "/api/knowledge-agents/homelab/files/README.md",
        content=new_content,
        headers={"Content-Type": "text/plain"},
    )
    assert response.status_code == 200
    assert response.json()["path"] == "README.md"
    # Verify persisted
    assert "actualizado" in app_client.get(
        "/api/knowledge-agents/homelab/files/README.md"
    ).text


def test_update_file_creates_new(app_client: TestClient, agent_with_dir):
    response = app_client.put(
        "/api/knowledge-agents/homelab/files/software/traefik.md",
        content="# Traefik\n",
        headers={"Content-Type": "text/plain"},
    )
    assert response.status_code == 200
    assert response.json()["path"] == "software/traefik.md"


def test_delete_file(app_client: TestClient, agent_with_dir):
    response = app_client.delete("/api/knowledge-agents/homelab/files/README.md")
    assert response.status_code == 204
    assert app_client.get("/api/knowledge-agents/homelab/files/README.md").status_code == 404


def test_delete_file_not_found(app_client: TestClient, agent_with_dir):
    response = app_client.delete("/api/knowledge-agents/homelab/files/nope.md")
    assert response.status_code == 404
