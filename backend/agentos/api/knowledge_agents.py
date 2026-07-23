import io
import logging
import math
import re
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func
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
# Search (BM25 full-text search over knowledge files)
# ---------------------------------------------------------------------------

class SearchMatch(BaseModel):
    line_number: int
    line: str
    context_before: list[str]
    context_after: list[str]


class SearchResult(BaseModel):
    file: str
    score: float
    matches: list[SearchMatch]


def _parse_query(q: str) -> tuple[list[str], list[str], bool]:
    """Parse query into (terms, phrases, case_sensitive).

    Quoted strings → phrases (exact substring).
    Remaining words → individual terms (all must appear in the document).
    Smart case: any uppercase char → case-sensitive search.
    """
    case_sensitive = any(c.isupper() for c in q)
    phrases: list[str] = [m.group(1) for m in re.finditer(r'"([^"]+)"', q)]
    remaining = re.sub(r'"[^"]+"', ' ', q)
    terms = [w for w in remaining.split() if w]
    return terms, phrases, case_sensitive


def _count_substr(text: str, sub: str) -> int:
    # str.count() skips overlapping occurrences; step by 1 to catch them all
    count = start = 0
    while (idx := text.find(sub, start)) != -1:
        count += 1
        start = idx + 1
    return count


def _extract_snippets(
    lines: list[str],
    terms: list[str],
    phrases: list[str],
    case_sensitive: bool,
    context: int = 2,
    max_snippets: int = 5,
) -> list[SearchMatch]:
    """Return the best lines by needle density, re-sorted to document order.

    Density (total needle occurrences on that line) picks the most relevant
    snippets. Re-sorting by line_number ensures they render top-to-bottom,
    which is more natural than relevance order for reading.
    """
    all_needles = terms + phrases

    scored: list[tuple[int, float]] = []
    for i, line in enumerate(lines):
        cmp = line if case_sensitive else line.lower()
        s = sum(
            _count_substr(cmp, n if case_sensitive else n.lower())
            for n in all_needles
        )
        if s > 0:
            scored.append((i, s))

    scored.sort(key=lambda x: x[1], reverse=True)
    snippets: list[SearchMatch] = []
    for line_idx, _ in scored[:max_snippets]:
        snippets.append(SearchMatch(
            line_number=line_idx + 1,
            line=lines[line_idx],
            context_before=lines[max(0, line_idx - context):line_idx],
            context_after=lines[line_idx + 1:line_idx + 1 + context],
        ))
    snippets.sort(key=lambda s: s.line_number)
    return snippets


@router.get("/{agent_id}/search")
def search_knowledge(agent_id: str, q: str, session: SessionDep) -> list[SearchResult]:
    """BM25 full-text search over the knowledge directory.

    Query syntax:
    - "exact phrase"  → exact substring match
    - word1 word2     → both words must appear anywhere in the document (AND)
    - SmartCase       → any uppercase char makes the search case-sensitive
    """
    agent = session.get(KnowledgeAgent, agent_id)
    if not agent:
        raise HTTPException(404, "Knowledge agent not found")
    q = q.strip()
    if not q or not agent.knowledge_path:
        return []

    base = Path(agent.knowledge_path)
    if not base.exists():
        return []

    terms, phrases, case_sensitive = _parse_query(q)
    all_needles = terms + phrases
    if not all_needles:
        return []

    # Load all text files (respect the same skip rules as the file browser)
    corpus: list[tuple[str, str, int]] = []  # (rel_path, text, word_count)
    for path in sorted(base.rglob("*")):
        if not path.is_file():
            continue
        rel_parts = path.relative_to(base).parts
        if any(part in _SKIP_DIRS or part.startswith(".") for part in rel_parts):
            continue
        if not _is_text(path):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        corpus.append((str(path.relative_to(base)), text, len(text.split())))

    N = len(corpus)
    if N == 0:
        return []

    avg_dl = sum(wc for _, _, wc in corpus) / N

    # Okapi BM25 (k1=1.5, b=0.75 are the standard defaults).
    # k1 controls TF saturation — higher means longer docs get proportionally
    # more credit for repeated terms. b=0.75 applies mild length normalization.
    K1 = 1.5
    B = 0.75

    # First pass: find matching docs, compute per-needle tf and df
    df: dict[str, int] = {n: 0 for n in all_needles}
    matching: list[tuple[str, str, int, dict[str, int]]] = []

    for rel, text, word_count in corpus:
        cmp_text = text if case_sensitive else text.lower()
        tfs: dict[str, int] = {}
        all_present = True
        for needle in all_needles:
            tf = _count_substr(cmp_text, needle if case_sensitive else needle.lower())
            if tf == 0:
                all_present = False
                break
            tfs[needle] = tf
        if all_present:
            matching.append((rel, text, word_count, tfs))
            for needle in tfs:
                df[needle] += 1

    if not matching:
        return []

    # Second pass: BM25 score
    results: list[SearchResult] = []
    for rel, text, word_count, tfs in matching:
        score = 0.0
        for needle in all_needles:
            tf = tfs[needle]
            doc_freq = max(df.get(needle, 1), 1)
            # IDF: rare terms score higher; +1 keeps it positive when df ≈ N
            idf = math.log((N - doc_freq + 0.5) / (doc_freq + 0.5) + 1)
            # TF with saturation and length normalization
            tf_norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * word_count / avg_dl))
            score += idf * tf_norm

        # Bonus: needle appears in the filename (user usually cares about this)
        rel_cmp = rel if case_sensitive else rel.lower()
        for needle in all_needles:
            if (needle if case_sensitive else needle.lower()) in rel_cmp:
                score += 2.0

        lines = text.splitlines()
        snippets = _extract_snippets(lines, terms, phrases, case_sensitive)
        results.append(SearchResult(file=rel, score=round(score, 3), matches=snippets))

    results.sort(key=lambda r: r.score, reverse=True)
    return results[:50]


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

    triggered_by = "manual"
    if data.conversation_id:
        first_run = session.exec(
            select(Run)
            .where(
                func.json_extract(Run.input_params, "$.conversation_id") == data.conversation_id
            )
            .order_by(Run.created_at)
            .limit(1)
        ).first()
        if first_run:
            triggered_by = "chat"
            input_params["original_run_id"] = first_run.id

    run = Run(
        agent_id=f"knowledge:{agent_id}",
        input_params=input_params,
        triggered_by=triggered_by,
        status=RunStatus.pending,
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    await pool.enqueue_job("run_agent_task", run.id)
    await pool.aclose()

    return {"run_id": run.id}
