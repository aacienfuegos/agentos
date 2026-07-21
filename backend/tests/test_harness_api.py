"""Tests for /api/harness CRUD and generate endpoints."""
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def harness_dir(tmp_path: Path) -> Path:
    """Temp directory that mimics ~/.claude structure."""
    (tmp_path / "rules").mkdir()
    (tmp_path / "agents").mkdir()
    (tmp_path / "skills").mkdir()
    (tmp_path / "contexts").mkdir()
    (tmp_path / "scripts").mkdir()

    (tmp_path / "CLAUDE.md").write_text(
        "---\ndescription: Test harness\n---\n\n# CLAUDE.md content\n"
    )
    (tmp_path / "rules" / "security.md").write_text(
        "---\nname: security\ndescription: Security rules\n---\n\n# Security\n"
    )
    (tmp_path / "agents" / "code-reviewer.md").write_text(
        "---\nname: code-reviewer\ndescription: Reviews code\nmodel: claude-sonnet-4-6\ntools:\n  - Read\n  - Bash\n---\n\nReview code carefully.\n"
    )
    skill_dir = tmp_path / "skills" / "verify"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text(
        "---\nname: verify\ndescription: Verify changes\n---\n\n## Instructions\n"
    )
    (tmp_path / "contexts" / "homelab.md").write_text("# Homelab context\n")
    (tmp_path / "scripts" / "cleanup.sh").write_text("#!/usr/bin/env bash\necho hi\n")

    return tmp_path


@pytest.fixture
def client(app_client: TestClient, harness_dir: Path):
    """app_client with harness_path patched to temp dir."""
    with patch("agentos.api.harness.settings") as mock_settings:
        mock_settings.harness_path = str(harness_dir)
        yield app_client, harness_dir


# ── List ──────────────────────────────────────────────────────────────────────

def test_list_returns_all_types(client):
    c, _ = client
    resp = c.get("/api/harness")
    assert resp.status_code == 200
    data = resp.json()
    assert set(data.keys()) == {"claude_md", "rule", "agent", "skill", "context", "script"}
    assert len(data["claude_md"]) == 1
    assert len(data["rule"]) == 1
    assert len(data["agent"]) == 1
    assert len(data["skill"]) == 1
    assert len(data["context"]) == 1
    assert len(data["script"]) == 1


def test_list_claude_md_name_is_filename(client):
    c, _ = client
    data = c.get("/api/harness").json()
    assert data["claude_md"][0]["name"] == "CLAUDE.md"


def test_list_rule_includes_description(client):
    c, _ = client
    data = c.get("/api/harness").json()
    assert data["rule"][0]["name"] == "security"
    assert data["rule"][0]["description"] == "Security rules"


def test_list_skill_from_directory(client):
    c, _ = client
    data = c.get("/api/harness").json()
    assert data["skill"][0]["name"] == "verify"


# ── Get ───────────────────────────────────────────────────────────────────────

def test_get_claude_md(client):
    c, _ = client
    resp = c.get("/api/harness/claude_md/CLAUDE.md")
    assert resp.status_code == 200
    data = resp.json()
    assert data["component_type"] == "claude_md"
    assert "CLAUDE.md content" in data["content"]
    assert data["metadata"]["description"] == "Test harness"


def test_get_rule(client):
    c, _ = client
    resp = c.get("/api/harness/rule/security")
    assert resp.status_code == 200
    assert resp.json()["name"] == "security"


def test_get_agent_parses_frontmatter(client):
    c, _ = client
    data = c.get("/api/harness/agent/code-reviewer").json()
    assert data["metadata"]["model"] == "claude-sonnet-4-6"
    assert "Read" in data["metadata"]["tools"]


def test_get_skill(client):
    c, _ = client
    resp = c.get("/api/harness/skill/verify")
    assert resp.status_code == 200
    assert "Instructions" in resp.json()["content"]


def test_get_not_found(client):
    c, _ = client
    assert c.get("/api/harness/rule/nonexistent").status_code == 404


def test_get_invalid_type(client):
    c, _ = client
    assert c.get("/api/harness/badtype/foo").status_code == 400


# ── Create ────────────────────────────────────────────────────────────────────

def test_create_rule(client):
    c, d = client
    resp = c.post("/api/harness/rule", json={"name": "new-rule", "content": "# New rule\n"})
    assert resp.status_code == 201
    assert resp.json()["name"] == "new-rule"
    assert (d / "rules" / "new-rule.md").exists()


def test_create_skill_makes_directory(client):
    c, d = client
    resp = c.post("/api/harness/skill", json={"name": "my-skill", "content": "# Skill\n"})
    assert resp.status_code == 201
    assert (d / "skills" / "my-skill" / "SKILL.md").exists()


def test_create_script_chmod_x(client):
    c, d = client
    resp = c.post("/api/harness/script", json={"name": "deploy", "content": "#!/usr/bin/env bash\necho ok\n"})
    assert resp.status_code == 201
    p = d / "scripts" / "deploy.sh"
    assert p.exists()
    assert p.stat().st_mode & 0o111  # executable bit set


def test_create_claude_md_returns_405(client):
    c, _ = client
    assert c.post("/api/harness/claude_md", json={"name": "x", "content": "y"}).status_code == 405


def test_create_duplicate_returns_409(client):
    c, _ = client
    c.post("/api/harness/rule", json={"name": "dup", "content": "# a\n"})
    assert c.post("/api/harness/rule", json={"name": "dup", "content": "# b\n"}).status_code == 409


def test_create_invalid_name_rejected(client):
    c, _ = client
    assert c.post("/api/harness/rule", json={"name": "../evil", "content": "x"}).status_code == 400
    assert c.post("/api/harness/rule", json={"name": "foo/bar", "content": "x"}).status_code == 400


# ── Update ────────────────────────────────────────────────────────────────────

def test_update_rule(client):
    c, d = client
    resp = c.put("/api/harness/rule/security", json={"content": "# Updated\n"})
    assert resp.status_code == 200
    assert (d / "rules" / "security.md").read_text() == "# Updated\n"


def test_update_claude_md(client):
    c, d = client
    resp = c.put("/api/harness/claude_md/CLAUDE.md", json={"content": "# Updated CLAUDE\n"})
    assert resp.status_code == 200
    assert (d / "CLAUDE.md").read_text() == "# Updated CLAUDE\n"


def test_update_not_found(client):
    c, _ = client
    assert c.put("/api/harness/rule/missing", json={"content": "x"}).status_code == 404


# ── Delete ────────────────────────────────────────────────────────────────────

def test_delete_rule(client):
    c, d = client
    assert c.delete("/api/harness/rule/security").status_code == 204
    assert not (d / "rules" / "security.md").exists()


def test_delete_skill_removes_directory(client):
    c, d = client
    assert c.delete("/api/harness/skill/verify").status_code == 204
    assert not (d / "skills" / "verify").exists()


def test_delete_claude_md_returns_405(client):
    c, _ = client
    assert c.delete("/api/harness/claude_md/CLAUDE.md").status_code == 405


def test_delete_not_found(client):
    c, _ = client
    assert c.delete("/api/harness/rule/missing").status_code == 404


# ── Generate ──────────────────────────────────────────────────────────────────

def _mock_proc(output: str = "# Generated content\n", returncode: int = 0):
    proc = MagicMock()
    proc.returncode = returncode
    proc.communicate = AsyncMock(return_value=(output.encode(), b""))
    return proc


@pytest.mark.anyio
async def test_generate_rule(client):
    c, _ = client
    with patch("asyncio.create_subprocess_exec", return_value=_mock_proc("# Generated rule\n")) as mock_exec:
        resp = c.post("/api/harness/generate", json={"component_type": "rule", "description": "A security rule"})
    assert resp.status_code == 200
    assert resp.json()["content"] == "# Generated rule"
    mock_exec.assert_called_once()
    args = mock_exec.call_args[0]
    assert args[0] == "claude"
    assert "-p" in args


@pytest.mark.anyio
async def test_generate_script(client):
    c, _ = client
    script_content = "#!/usr/bin/env bash\nset -euo pipefail\necho hello\n"
    with patch("asyncio.create_subprocess_exec", return_value=_mock_proc(script_content)):
        resp = c.post("/api/harness/generate", json={"component_type": "script", "description": "Print hello"})
    assert resp.status_code == 200
    assert resp.json()["content"] == script_content.strip()


@pytest.mark.anyio
async def test_generate_unsupported_type(client):
    c, _ = client
    resp = c.post("/api/harness/generate", json={"component_type": "claude_md", "description": "x"})
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_generate_empty_description(client):
    c, _ = client
    resp = c.post("/api/harness/generate", json={"component_type": "rule", "description": "   "})
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_generate_claude_failure(client):
    c, _ = client
    with patch("asyncio.create_subprocess_exec", return_value=_mock_proc("error", returncode=1)):
        resp = c.post("/api/harness/generate", json={"component_type": "rule", "description": "x"})
    assert resp.status_code == 500
