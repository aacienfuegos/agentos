"""Tests for /api/infra-map endpoints."""
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlmodel import Session

from agentos.config import settings
from agentos.models import InfraNetwork, InfraNode, InfraService


def test_get_infra_map_empty(app_client: TestClient):
    response = app_client.get("/api/infra-map")
    assert response.status_code == 200
    data = response.json()
    assert data == {"networks": [], "nodes": [], "services": [], "links": [], "last_refresh": None}


def test_get_infra_map_returns_seeded_data(app_client: TestClient, test_session: Session):
    network = InfraNetwork(name="Servers", vlan_tag=20, subnet="192.0.2.0/24")
    test_session.add(network)
    test_session.commit()
    test_session.refresh(network)

    node = InfraNode(name="proxmox-host", node_type="host", network_id=network.id)
    test_session.add(node)
    test_session.commit()
    test_session.refresh(node)

    test_session.add(InfraService(name="traefik", node_id=node.id, category="network"))
    test_session.commit()

    response = app_client.get("/api/infra-map")
    assert response.status_code == 200
    data = response.json()
    assert len(data["networks"]) == 1
    assert data["networks"][0]["name"] == "Servers"
    assert len(data["nodes"]) == 1
    assert data["nodes"][0]["network_id"] == network.id
    assert len(data["services"]) == 1
    assert data["services"][0]["node_id"] == node.id


def test_refresh_without_docs_path_configured_fails(app_client: TestClient, monkeypatch):
    monkeypatch.setattr(settings, "infra_map_docs_path", "")
    response = app_client.post("/api/infra-map/refresh")
    assert response.status_code == 400


def test_refresh_enqueues_job(app_client: TestClient, monkeypatch):
    monkeypatch.setattr(settings, "infra_map_docs_path", "/data/homelab-docs")

    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock()
    mock_pool.aclose = AsyncMock()

    with patch("agentos.api.infra_map.create_pool", return_value=mock_pool):
        response = app_client.post("/api/infra-map/refresh")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "pending"
    assert "run_id" in data
    mock_pool.enqueue_job.assert_awaited_once_with("run_agent_task", data["run_id"])


def test_get_infra_map_reports_last_refresh(app_client: TestClient, test_session: Session):
    from datetime import datetime
    from agentos.models import Run, RunStatus
    from agentos.runner.infra_map import INFRA_MAP_AGENT_ID

    run = Run(
        agent_id=INFRA_MAP_AGENT_ID,
        run_type="infra_map",
        triggered_by="manual",
        status=RunStatus.success,
        finished_at=datetime.utcnow(),
    )
    test_session.add(run)
    test_session.commit()

    response = app_client.get("/api/infra-map")
    assert response.status_code == 200
    last_refresh = response.json()["last_refresh"]
    assert last_refresh is not None
    assert last_refresh["status"] == "success"
