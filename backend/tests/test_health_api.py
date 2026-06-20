"""Tests for /api/health endpoint."""
import tempfile
from pathlib import Path
from unittest.mock import patch


def test_health_response_shape(app_client):
    """Health always returns the expected JSON shape."""
    resp = app_client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert "status" in data
    assert "version" in data
    assert set(data["services"].keys()) >= {"redis", "database", "claude"}


def test_health_claude_not_authenticated(app_client):
    """Health returns claude=False when neither credential file exists."""
    with tempfile.TemporaryDirectory() as tmpdir:
        with patch("pathlib.Path.home", return_value=Path(tmpdir)):
            resp = app_client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["services"]["claude"] is False
    assert data["status"] == "degraded"


def test_health_claude_new_credentials(app_client):
    """Health returns claude=True when ~/.claude/.credentials.json exists and is non-empty."""
    with tempfile.TemporaryDirectory() as tmpdir:
        home = Path(tmpdir)
        claude_dir = home / ".claude"
        claude_dir.mkdir()
        (claude_dir / ".credentials.json").write_text('{"token":"abc"}')
        with patch("pathlib.Path.home", return_value=home):
            resp = app_client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["services"]["claude"] is True


def test_health_claude_legacy_credentials(app_client):
    """Health returns claude=True when ~/.claude.json exists (legacy location)."""
    with tempfile.TemporaryDirectory() as tmpdir:
        home = Path(tmpdir)
        (home / ".claude.json").write_text('{"token":"abc"}')
        with patch("pathlib.Path.home", return_value=home):
            resp = app_client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["services"]["claude"] is True
