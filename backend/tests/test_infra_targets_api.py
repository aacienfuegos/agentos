"""Tests for /api/infra-targets CRUD endpoints."""
from fastapi.testclient import TestClient


TARGET_PAYLOAD = {
    "id": "test-target",
    "name": "Test Target",
    "host": "test-target.internal",
    "ssh_user": "agentos",
    "ssh_port": 2222,
    "notes": "Dev target for testing",
}


def test_list_infra_targets_empty(app_client: TestClient):
    response = app_client.get("/api/infra-targets")
    assert response.status_code == 200
    assert response.json() == []


def test_create_infra_target(app_client: TestClient):
    response = app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    assert response.status_code == 201
    data = response.json()
    assert data["id"] == "test-target"
    assert data["name"] == "Test Target"
    assert data["host"] == "test-target.internal"
    assert data["ssh_port"] == 2222


def test_create_infra_target_default_port(app_client: TestClient):
    payload = {k: v for k, v in TARGET_PAYLOAD.items() if k != "ssh_port"}
    response = app_client.post("/api/infra-targets", json=payload)
    assert response.status_code == 201
    assert response.json()["ssh_port"] == 22


def test_create_infra_target_duplicate(app_client: TestClient):
    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    response = app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    assert response.status_code == 400
    assert "already exists" in response.json()["detail"]


def test_list_infra_targets(app_client: TestClient):
    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    response = app_client.get("/api/infra-targets")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["id"] == "test-target"


def test_get_infra_target(app_client: TestClient):
    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    response = app_client.get("/api/infra-targets/test-target")
    assert response.status_code == 200
    assert response.json()["id"] == "test-target"


def test_get_infra_target_not_found(app_client: TestClient):
    response = app_client.get("/api/infra-targets/nonexistent")
    assert response.status_code == 404


def test_update_infra_target(app_client: TestClient):
    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    response = app_client.put(
        "/api/infra-targets/test-target",
        json={"notes": "Updated notes"},
    )
    assert response.status_code == 200
    assert response.json()["notes"] == "Updated notes"
    # Other fields unchanged
    assert response.json()["host"] == TARGET_PAYLOAD["host"]


def test_update_infra_target_not_found(app_client: TestClient):
    response = app_client.put("/api/infra-targets/nonexistent", json={"notes": "x"})
    assert response.status_code == 404


def test_delete_infra_target(app_client: TestClient):
    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    response = app_client.delete("/api/infra-targets/test-target")
    assert response.status_code == 204
    assert app_client.get("/api/infra-targets/test-target").status_code == 404


def test_delete_infra_target_not_found(app_client: TestClient):
    response = app_client.delete("/api/infra-targets/nonexistent")
    assert response.status_code == 404
