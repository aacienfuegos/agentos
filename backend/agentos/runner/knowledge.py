"""
KnowledgeRunner — usa el CLI `claude` (Claude Pro, sin coste extra de API).

El agente trabaja directamente sobre su directorio de conocimiento:
lee y escribe ficheros con sus herramientas nativas (Read, Write, Edit, Grep, LS).
El system prompt incluye un árbol del directorio para orientarlo.
"""
import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from sqlmodel import Session

from ..database import engine
from ..models import AgentDefinition, KnowledgeAgent, Run
from .claude_code import ClaudeCodeRunner, RunResult

logger = logging.getLogger(__name__)

_SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv", ".mypy_cache", ".pytest_cache"}
_MAX_TREE_FILES = 150


def _dir_tree(path: Path, max_depth: int = 5) -> str:
    lines: list[str] = [str(path)]
    count = 0

    def walk(p: Path, depth: int, prefix: str) -> None:
        nonlocal count
        if depth > max_depth or count >= _MAX_TREE_FILES:
            return
        try:
            entries = sorted(p.iterdir(), key=lambda e: (e.is_file(), e.name.lower()))
        except PermissionError:
            return
        visible = [e for e in entries if e.name not in _SKIP_DIRS and not e.name.startswith(".")]
        for i, entry in enumerate(visible):
            if count >= _MAX_TREE_FILES:
                lines.append(f"{prefix}… (más ficheros omitidos)")
                return
            connector = "└── " if i == len(visible) - 1 else "├── "
            lines.append(f"{prefix}{connector}{entry.name}")
            count += 1
            if entry.is_dir():
                ext = "    " if i == len(visible) - 1 else "│   "
                walk(entry, depth + 1, prefix + ext)

    walk(path, 1, "")
    return "\n".join(lines)


def default_knowledge_path(agent_id: str) -> str:
    return f"/data/knowledge/{agent_id}"


def ensure_knowledge_dir(ka: KnowledgeAgent) -> Path:
    path = Path(ka.knowledge_path)
    path.mkdir(parents=True, exist_ok=True)
    stub = path / "knowledge.md"
    if not any(path.iterdir()):
        stub.write_text(
            f"# {ka.name}\n\n"
            f"{ka.description or 'Base de conocimiento.'}\n\n"
            f"<!-- Añade aquí la información que quieras que recuerde el agente. -->\n",
            encoding="utf-8",
        )
    return path


def _build_system_prompt(ka: KnowledgeAgent) -> str:
    base = ka.system_prompt or (
        f"Eres un asistente especializado en {ka.name}. "
        "Responde usando la base de conocimiento disponible en tu directorio."
    )
    path = Path(ka.knowledge_path)
    if not path.exists():
        return base + f"\n\n**Aviso:** el directorio de conocimiento no existe: {ka.knowledge_path}"

    tree = _dir_tree(path)
    return (
        base
        + f"\n\n## Base de conocimiento: {ka.name}\n\n"
        f"Directorio: `{ka.knowledge_path}`\n\n"
        f"Estructura actual:\n```\n{tree}\n```\n\n"
        f"Usa Read, Write, Edit, Grep y LS para explorar y actualizar los ficheros. "
        f"Las rutas relativas se resuelven desde el directorio raíz de la base de conocimiento."
    )


@dataclass
class KnowledgeRunResult:
    output: str
    tokens_input: int = field(default=0)
    tokens_output: int = field(default=0)
    session_id: str | None = field(default=None)


class KnowledgeRunner:
    def __init__(self, redis_url: str | None = None):
        from ..config import settings
        self._redis_url = redis_url or settings.redis_url

    async def run(self, run: Run, ka: KnowledgeAgent) -> KnowledgeRunResult:
        ensure_knowledge_dir(ka)

        resume_session_id: str | None = run.input_params.get("resume_session_id")
        system_prompt = _build_system_prompt(ka) if not resume_session_id else ""

        tools = run.input_params.get("tools") or ka.tools or ["Read", "Write"]
        proxy_agent = AgentDefinition(
            id=f"knowledge:{ka.id}",
            name=ka.name,
            description=ka.description,
            system_prompt=system_prompt,
            tools=tools,
            model=ka.model,
            max_tokens=ka.max_tokens,
            timeout_seconds=600,
            is_builtin=False,
        )

        runner = ClaudeCodeRunner(redis_url=self._redis_url)
        result: RunResult = await runner.run(
            run,
            proxy_agent,
            persist_session=True,
            resume_session_id=resume_session_id,
            cwd=ka.knowledge_path,
        )

        # Touch updated_at so the UI can detect that the agent was active
        with Session(engine) as session:
            agent = session.get(KnowledgeAgent, ka.id)
            if agent:
                agent.updated_at = datetime.utcnow()
                session.add(agent)
                session.commit()

        return KnowledgeRunResult(
            output=result.output,
            tokens_input=result.tokens_input,
            tokens_output=result.tokens_output,
            session_id=result.session_id,
        )
