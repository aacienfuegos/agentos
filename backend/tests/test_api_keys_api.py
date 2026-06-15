"""Tests for /api/api-keys CRUD and API key auth middleware."""
import hashlib
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from agentos.models import ApiKey


def _insert_key(session: Session, name: str = "test", raw: str = "sk-agentos-testkey00000000000000000000000000") -> str:
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    key = ApiKey(name=name, key_hash=key_hash)
    session.add(key)
    session.commit()
    return raw


# ---------------------------------------------------------------------------
# CRUD (auth bypassed via app_client fixture)
# ---------------------------------------------------------------------------

def test_list_keys_empty(app_client: TestClient):
    assert app_client.get("/api/api-keys").json() == []


def test_create_key_returns_raw_once(app_client: TestClient):
    resp = app_client.post("/api/api-keys", json={"name": "my-app"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["raw_key"].startswith("sk-agentos-")
    assert data["name"] == "my-app"
    assert "key_hash" not in data


def test_list_keys_never_exposes_raw(app_client: TestClient):
    app_client.post("/api/api-keys", json={"name": "hidden"})
    keys = app_client.get("/api/api-keys").json()
    assert len(keys) == 1
    assert "raw_key" not in keys[0]
    assert "key_hash" not in keys[0]


def test_delete_key(app_client: TestClient):
    created = app_client.post("/api/api-keys", json={"name": "del"}).json()
    resp = app_client.delete(f"/api/api-keys/{created['id']}")
    assert resp.status_code == 204
    assert app_client.get("/api/api-keys").json() == []


def test_delete_key_not_found(app_client: TestClient):
    assert app_client.delete("/api/api-keys/nonexistent").status_code == 404


# ---------------------------------------------------------------------------
# Middleware: API key auth
# ---------------------------------------------------------------------------

def _no_auth_client():
    """TestClient with verify_token=False (simulates cookie auth missing)."""
    from agentos.main import app
    return TestClient(app, raise_server_exceptions=True)


def test_no_auth_returns_401(_reset_db):
    with patch("agentos.main.verify_token", return_value=False):
        client = _no_auth_client()
        assert client.get("/api/runs").status_code == 401


def test_valid_key_allows_runs_path(_reset_db, test_session: Session):
    raw = _insert_key(test_session)
    with patch("agentos.main.verify_token", return_value=False):
        resp = _no_auth_client().get("/api/runs", headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 200


def test_valid_key_blocked_on_agents_path(_reset_db, test_session: Session):
    raw = _insert_key(test_session)
    with patch("agentos.main.verify_token", return_value=False):
        resp = _no_auth_client().get("/api/agents", headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 403


def test_invalid_key_returns_401(_reset_db):
    with patch("agentos.main.verify_token", return_value=False):
        resp = _no_auth_client().get("/api/runs", headers={"Authorization": "Bearer sk-agentos-wrongkey"})
    assert resp.status_code == 401


def test_disabled_key_returns_401(_reset_db, test_session: Session):
    raw = "sk-agentos-disabled0000000000000000000000000"
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    key = ApiKey(name="disabled", key_hash=key_hash, enabled=False)
    test_session.add(key)
    test_session.commit()

    with patch("agentos.main.verify_token", return_value=False):
        resp = _no_auth_client().get("/api/runs", headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 401
