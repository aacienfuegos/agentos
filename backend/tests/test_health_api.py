"""Tests for /api/health endpoint."""
from unittest.mock import MagicMock, patch


def test_health_response_shape(app_client):
    """Health always returns the expected JSON shape."""
    resp = app_client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert "status" in data
    assert "version" in data
    assert set(data["services"].keys()) >= {"redis", "database", "claude"}


def test_health_claude_not_authenticated(app_client):
    """Health returns degraded and claude=False when credentials file is absent."""
    mock_path = MagicMock()
    mock_path.exists.return_value = False

    with patch("pathlib.Path.home") as mock_home:
        credentials = MagicMock()
        credentials.exists.return_value = False
        mock_home.return_value.__truediv__.return_value.__truediv__.return_value = credentials

        resp = app_client.get("/api/health")

    assert resp.status_code == 200
    data = resp.json()
    assert data["services"]["claude"] is False
    assert data["status"] == "degraded"


def test_health_claude_credentials_empty(app_client):
    """Health treats a zero-byte credentials file as not authenticated."""
    with patch("pathlib.Path.home") as mock_home:
        credentials = MagicMock()
        credentials.exists.return_value = True
        credentials.stat.return_value = MagicMock(st_size=0)
        mock_home.return_value.__truediv__.return_value.__truediv__.return_value = credentials

        resp = app_client.get("/api/health")

    assert resp.status_code == 200
    assert resp.json()["services"]["claude"] is False
