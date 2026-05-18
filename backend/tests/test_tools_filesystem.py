"""Tests for agentos.tools.filesystem (sandboxed file/command tools)."""
import pytest
import agentos.tools.filesystem as fs_module


@pytest.fixture(autouse=True)
def sandbox(tmp_path, monkeypatch):
    """Redirect SANDBOX_ROOT to a tmp directory for every test."""
    monkeypatch.setattr(fs_module, "SANDBOX_ROOT", tmp_path)
    return tmp_path


async def test_read_file_not_found():
    result = await fs_module.read_file({"path": "missing.txt"})
    assert result.startswith("Error: file not found")


async def test_write_and_read_file(tmp_path):
    content = "hello, world!"
    write_result = await fs_module.write_file({"path": "hello.txt", "content": content})
    assert "Written" in write_result

    read_result = await fs_module.read_file({"path": "hello.txt"})
    assert read_result == content


async def test_list_directory_empty(tmp_path):
    result = await fs_module.list_directory({"path": "."})
    assert result == "(empty)"


async def test_list_directory_with_files(tmp_path):
    # sandbox fixture points SANDBOX_ROOT at tmp_path
    (tmp_path / "alpha.txt").write_text("a")
    (tmp_path / "beta.txt").write_text("b")
    result = await fs_module.list_directory({"path": "."})
    assert "alpha.txt" in result
    assert "beta.txt" in result


async def test_path_escape_blocked():
    with pytest.raises(ValueError, match="Path escape"):
        await fs_module.read_file({"path": "../../etc/passwd"})


async def test_run_command():
    result = await fs_module.run_command({"command": "echo hello"})
    assert result.strip() == "hello"
