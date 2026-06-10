import io
import logging
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlmodel import Session, select

from ..config import settings
from ..database import get_session
from ..models import KnowledgeAgent, Run, RunStatus
from ..runner.knowledge import default_knowledge_path, ensure_knowledge_dir

logger = logging.getLogger(__name__)

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]

_SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv", ".mypy_cache", ".pytest_cache"}
_TEXT_EXTENSIONS = {
    ".md", ".txt", ".yaml", ".yml", ".json", ".toml", ".ini", ".cfg", ".conf",
    ".py", ".sh", ".env", ".example", ".rst", ".csv", ".xml", ".html", ".css",
    ".js", ".ts", ".tsx", ".jsx",
}


class KnowledgeAgentCreate(BaseModel):
    id: str
    name: str
    description: str = ""
    system_prompt: str = ""
    knowledge_path: str = ""
    model: str = "claude-sonnet-4-6"
    tools: list[str] = ["Read", "Write"]


class KnowledgeAgentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    knowledge_path: str | None = None
    model: str | None = None
    tools: list[str] | None = None


@router.get("")
def list_knowledge_agents(session: SessionDep) -> list[KnowledgeAgent]:
    return session.exec(select(KnowledgeAgent)).all()


@router.post("", status_code=201)
def create_knowledge_agent(data: KnowledgeAgentCreate, session: SessionDep) -> KnowledgeAgent:
    if session.get(KnowledgeAgent, data.id):
        raise HTTPException(400, f"Knowledge agent '{data.id}' already exists")
    payload = data.model_dump()
    if not payload["knowledge_path"]:
        payload["knowledge_path"] = default_knowledge_path(data.id)
    agent = KnowledgeAgent(**payload)
    session.add(agent)
    session.commit()
    session.refresh(agent)
    try:
        ensure_knowledge_dir(agent)
    except OSError as e:
        logger.warning("Could not create knowledge directory %s: %s", agent.knowledge_path, e)
    return agent


@router.get("/{agent_id}")
def get_knowledge_agent(agent_id: str, session: SessionDep) -> KnowledgeAgent:
    agent = session.get(KnowledgeAgent, agent_id)
    if not agent:
        raise HTTPException(404, "Knowledge agent not found")
    return agent


@router.put("/{agent_id}")
def update_knowledge_agent(
    agent_id: str, data: KnowledgeAgentUpdate, session: SessionDep
) -> KnowledgeAgent:
    agent = session.get(KnowledgeAgent, agent_id)
    if not agent:
        raise HTTPException(404, "Knowledge agent not found")
    for field_name, value in data.model_dump(exclude_none=True).items():
        setattr(agent, field_name, value)
    agent.updated_at = datetime.utcnow()
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return agent


@router.delete("/{agent_id}", status_code=204)
def delete_knowledge_agent(agent_id: str, session: SessionDep) -> None:
    agent = session.get(KnowledgeAgent, agent_id)
    if not agent:
        raise HTTPException(404, "Knowledge agent not found")
    session.delete(agent)
    session.commit()


# ---------------------------------------------------------------------------
# File browser endpoints
# ---------------------------------------------------------------------------

def _resolve_safe(base: Path, rel: str) -> Path:
    """Resolve rel path inside base, raising 400 on traversal attempts."""
    target = (base / rel).resolve()
    if not str(target).startswith(str(base.resolve())):
        raise HTTPException(400, "Invalid path")
    return target


def _is_text(path: Path) -> bool:
    return path.suffix.lower() in _TEXT_EXTENSIONS or path.suffix == ""


class FileEntry(BaseModel):
    path: str          # relative to knowledge_path
    is_dir: bool
    size: int | None   # None for directories
    modified: float    # Unix timestamp


@router.get("/{agent_id}/files")
def list_knowledge_files(agent_id: str, session: SessionDep) -> list[FileEntry]:
    agent = session.get(KnowledgeAgent, agent_id)
    if not agent:
        raise HTTPException(404, "Knowledge agent not found")
    if not agent.knowledge_path:
        return []
    base = Path(agent.knowledge_path)
    if not base.exists():
        return []

    entries: list[FileEntry] = []
    for entry in sorted(base.rglob("*"), key=lambda p: str(p)):
        # Skip noise directories
        if any(part in _SKIP_DIRS or part.startswith(".") for part in entry.relative_to(base).parts):
            continue
        rel = str(entry.relative_to(base))
        stat = entry.stat()
        entries.append(FileEntry(
            path=rel,
            is_dir=entry.is_dir(),
            size=stat.st_size if entry.is_file() else None,
            modified=stat.st_mtime,
        ))
    return entries


@router.get("/{agent_id}/files/{file_path:path}")
def get_knowledge_file(agent_id: str, file_path: str, session: SessionDep) -> Response:
    agent = session.get(KnowledgeAgent, agent_id)
    if not agent:
        raise HTTPException(404, "Knowledge agent not found")
    if not agent.knowledge_path:
        raise HTTPException(404, "Knowledge agent has no knowledge_path configured")
    base = Path(agent.knowledge_path)
    target = _resolve_safe(base, file_path)
    if not target.exists() or not target.is_file():
        raise HTTPException(404, "File not found")
    if not _is_text(target):
        raise HTTPException(415, "Binary files are not supported in the editor")
    return Response(content=target.read_text(encoding="utf-8"), media_type="text/plain; charset=utf-8")


@router.put("/{agent_id}/files/{file_path:path}", status_code=200)
async def update_knowledge_file(
    agent_id: str, file_path: str, request: Request, session: SessionDep
) -> FileEntry:
    agent = session.get(KnowledgeAgent, agent_id)
    if not agent:
        raise HTTPException(404, "Knowledge agent not found")
    if not agent.knowledge_path:
        raise HTTPException(404, "Knowledge agent has no knowledge_path configured")
    base = Path(agent.knowledge_path)
    target = _resolve_safe(base, file_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    content = (await request.body()).decode("utf-8")
    target.write_text(content, encoding="utf-8")
    agent.updated_at = datetime.utcnow()
    session.add(agent)
    session.commit()
    stat = target.stat()
    return FileEntry(path=file_path, is_dir=False, size=stat.st_size, modified=stat.st_mtime)


@router.delete("/{agent_id}/files/{file_path:path}", status_code=204)
def delete_knowledge_file(agent_id: str, file_path: str, session: SessionDep) -> None:
    agent = session.get(KnowledgeAgent, agent_id)
    if not agent:
        raise HTTPException(404, "Knowledge agent not found")
    if not agent.knowledge_path:
        raise HTTPException(404, "Knowledge agent has no knowledge_path configured")
    base = Path(agent.knowledge_path)
    target = _resolve_safe(base, file_path)
    if not target.exists():
        raise HTTPException(404, "File not found")
    if target.is_dir():
        import shutil
        shutil.rmtree(target)
    else:
        target.unlink()


@router.post("/{agent_id}/upload", status_code=200)
async def upload_knowledge_files(
    agent_id: str,
    session: SessionDep,
    files: list[UploadFile],
    prefix: str = Form(default=""),
) -> dict[str, Any]:
    """Upload files to the knowledge directory.

    Accepts any combination of:
    - Regular files (written to knowledge_path/{prefix}/{filename})
    - Files with path separators in the name (folder upload via webkitRelativePath)
    - Zip archives (extracted automatically to knowledge_path/{prefix}/)
    """
    agent = session.get(KnowledgeAgent, agent_id)
    if not agent:
        raise HTTPException(404, "Knowledge agent not found")
    if not agent.knowledge_path:
        raise HTTPException(404, "Knowledge agent has no knowledge_path configured")

    base = Path(agent.knowledge_path)
    base.mkdir(parents=True, exist_ok=True)

    written: list[str] = []
    errors: list[str] = []

    def safe_target(rel_str: str) -> Path | None:
        try:
            target = (base / rel_str).resolve()
            if str(target).startswith(str(base.resolve())):
                return target
        except Exception:
            pass
        return None

    for upload in files:
        filename = upload.filename or "upload"
        content = await upload.read()
        is_zip = (
            filename.lower().endswith(".zip")
            or (upload.content_type or "").lower() in ("application/zip", "application/x-zip-compressed", "application/octet-stream")
            and filename.lower().endswith(".zip")
        )

        if is_zip:
            try:
                with zipfile.ZipFile(io.BytesIO(content)) as zf:
                    for member in zf.namelist():
                        # Skip macOS metadata and directory entries
                        if "__MACOSX" in member or member.endswith("/"):
                            continue
                        rel = str(Path(prefix) / member) if prefix else member
                        target = safe_target(rel)
                        if target is None:
                            errors.append(f"ruta inválida omitida: {member}")
                            continue
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(zf.read(member))
                        written.append(rel)
            except zipfile.BadZipFile:
                errors.append(f"{filename}: no es un zip válido")
            except Exception as e:
                errors.append(f"{filename}: {e}")
        else:
            rel = str(Path(prefix) / filename) if prefix else filename
            target = safe_target(rel)
            if target is None:
                errors.append(f"ruta inválida omitida: {filename}")
                continue
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
                written.append(rel)
            except Exception as e:
                errors.append(f"{filename}: {e}")

    agent.updated_at = datetime.utcnow()
    session.add(agent)
    session.commit()

    return {"written": written, "errors": errors}


# ---------------------------------------------------------------------------
# Query (launch a run)
# ---------------------------------------------------------------------------

class KnowledgeQuery(BaseModel):
    user_message: str
    resume_session_id: str | None = None
    conversation_id: str | None = None
    tools: list[str] | None = None


@router.post("/{agent_id}/query", status_code=201)
async def query_knowledge_agent(
    agent_id: str, data: KnowledgeQuery, session: SessionDep
) -> dict[str, Any]:
    agent = session.get(KnowledgeAgent, agent_id)
    if not agent:
        raise HTTPException(404, "Knowledge agent not found")

    input_params: dict[str, Any] = {
        "knowledge_agent_id": agent_id,
        "user_message": data.user_message,
    }
    if data.resume_session_id:
        input_params["resume_session_id"] = data.resume_session_id
    if data.conversation_id:
        input_params["conversation_id"] = data.conversation_id
    if data.tools is not None:
        input_params["tools"] = data.tools

    run = Run(
        agent_id=f"knowledge:{agent_id}",
        input_params=input_params,
        triggered_by="manual",
        status=RunStatus.pending,
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    await pool.enqueue_job("run_agent_task", run.id)
    await pool.aclose()

    return {"run_id": run.id}
