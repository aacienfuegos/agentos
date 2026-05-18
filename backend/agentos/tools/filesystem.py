import asyncio
import os
from pathlib import Path

SANDBOX_ROOT = Path("/data/sandbox")


def _safe_path(path: str) -> Path:
    resolved = (SANDBOX_ROOT / path.lstrip("/")).resolve()
    if not str(resolved).startswith(str(SANDBOX_ROOT)):
        raise ValueError(f"Path escape attempt: {path}")
    return resolved


async def read_file(params: dict) -> str:
    path = _safe_path(params["path"])
    if not path.exists():
        return f"Error: file not found: {path}"
    return path.read_text(errors="replace")[:50_000]  # cap at 50k chars


async def write_file(params: dict) -> str:
    path = _safe_path(params["path"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(params["content"])
    return f"Written {len(params['content'])} chars to {path}"


async def list_directory(params: dict) -> str:
    path = _safe_path(params.get("path", "."))
    if not path.exists():
        return f"Error: directory not found: {path}"
    entries = []
    for entry in sorted(path.iterdir()):
        kind = "DIR" if entry.is_dir() else "FILE"
        entries.append(f"{kind}  {entry.name}")
    return "\n".join(entries) if entries else "(empty)"


async def run_command(params: dict) -> str:
    cmd = params["command"]
    cwd = params.get("cwd")
    if cwd:
        cwd = str(_safe_path(cwd))
    else:
        cwd = str(SANDBOX_ROOT)

    SANDBOX_ROOT.mkdir(parents=True, exist_ok=True)

    proc = await asyncio.create_subprocess_shell(
        cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=cwd,
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=60)
        output = stdout.decode(errors="replace")
        return output[:10_000]
    except asyncio.TimeoutError:
        proc.kill()
        return "Error: command timed out after 60s"
