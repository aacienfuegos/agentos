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
from ..models import AgentDefinition, KnowledgeBase, Run
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


def ensure_knowledge_dir(kb: KnowledgeBase) -> Path:
    path = Path(kb.knowledge_path)
    path.mkdir(parents=True, exist_ok=True)
    stub = path / "knowledge.md"
    if not any(path.iterdir()):
        stub.write_text(
            f"# Índice — {kb.name}\n\n"
            f"{kb.description or ''}\n\n"
            "```\n"
            "# Añade aquí el índice de ficheros con una línea descriptiva por cada uno.\n"
            "# Ejemplo:\n"
            "# notas.md   → Notas generales\n"
            "# datos/     → Subcarpeta con datos estructurados\n"
            "```\n",
            encoding="utf-8",
        )
    return path


def _build_system_prompt(kb: KnowledgeBase, mode: str = "chat") -> str:
    # mode="chat"    → role (free_text or generic) + constraints + index + tree
    # mode="context" → index + tree only, no role (for external agent consumption)
    instructions = kb.instructions or {}
    free_text = instructions.get("free_text", "").strip()

    constraints: list[str] = []
    if instructions.get("cite_verbatim"):
        constraints.append("Cita siempre textualmente, sin interpretar ni parafrasear.")
    if instructions.get("no_recommendations"):
        constraints.append("No hagas recomendaciones médicas, legales, financieras ni de ningún otro tipo.")
    if instructions.get("require_source_refs"):
        constraints.append("Indica siempre el archivo o sección fuente de cada respuesta.")
    if instructions.get("readonly"):
        constraints.append("No modifiques ni crees ficheros sin confirmación explícita del usuario.")

    parts: list[str] = []

    if mode == "chat":
        if free_text:
            parts.append(free_text)
        else:
            parts.append(
                f"Eres un asistente especializado en {kb.name}. "
                "Responde usando la base de conocimiento disponible en tu directorio."
            )

    if constraints:
        parts.append("Instrucciones:\n" + "\n".join(f"- {c}" for c in constraints))

    path = Path(kb.knowledge_path)
    if not path.exists():
        if mode == "chat":
            parts.append(f"**Aviso:** el directorio de conocimiento no existe: {kb.knowledge_path}")
        return "\n\n".join(parts)

    knowledge_index = path / "knowledge.md"
    if knowledge_index.exists():
        index_content = knowledge_index.read_text(encoding="utf-8").strip()
        if index_content:
            parts.append(f"## Índice de la base de conocimiento\n\n{index_content}")

    tree = _dir_tree(path)
    parts.append(
        f"## Base de conocimiento: {kb.name}\n\n"
        f"Directorio: `{kb.knowledge_path}`\n\n"
        f"Estructura actual:\n```\n{tree}\n```\n\n"
        f"Usa Read, Write, Edit, Grep y LS para explorar y actualizar los ficheros. "
        f"Las rutas relativas se resuelven desde el directorio raíz de la base de conocimiento.\n\n"
        f"Mantenimiento del índice: si hay ficheros en el árbol que no aparecen en `knowledge.md`, "
        f"o entradas en `knowledge.md` que ya no existen, actualiza el índice. "
        f"Cuando crees o elimines un fichero, refleja el cambio en `knowledge.md` en la misma respuesta. "
        f"Las descripciones deben indicar el propósito del fichero, no su contenido actual."
    )

    return "\n\n".join(parts)


@dataclass
class KnowledgeRunResult:
    output: str
    tokens_input: int = field(default=0)
    tokens_output: int = field(default=0)
    tokens_cache_read: int = field(default=0)
    tokens_cache_write: int = field(default=0)
    session_id: str | None = field(default=None)


class KnowledgeRunner:
    def __init__(self, redis_url: str | None = None):
        from ..config import settings
        self._redis_url = redis_url or settings.redis_url

    async def run(self, run: Run, kb: KnowledgeBase) -> KnowledgeRunResult:
        ensure_knowledge_dir(kb)

        resume_session_id: str | None = run.input_params.get("resume_session_id")
        system_prompt = _build_system_prompt(kb) if not resume_session_id else ""

        tools = run.input_params.get("tools") or ["Read", "Write"]
        proxy_agent = AgentDefinition(
            id=f"knowledge:{kb.id}",
            name=kb.name,
            description=kb.description,
            system_prompt=system_prompt,
            tools=tools,
            model="claude-sonnet-4-6",
            max_tokens=4096,
            timeout_seconds=600,
            is_builtin=False,
        )

        runner = ClaudeCodeRunner(redis_url=self._redis_url)
        result: RunResult = await runner.run(
            run,
            proxy_agent,
            persist_session=True,
            resume_session_id=resume_session_id,
            cwd=kb.knowledge_path,
        )

        with Session(engine) as session:
            stored_kb = session.get(KnowledgeBase, kb.id)
            if stored_kb:
                stored_kb.updated_at = datetime.utcnow()
                session.add(stored_kb)
                session.commit()

        return KnowledgeRunResult(
            output=result.output,
            tokens_input=result.tokens_input,
            tokens_output=result.tokens_output,
            tokens_cache_read=result.tokens_cache_read,
            tokens_cache_write=result.tokens_cache_write,
            session_id=result.session_id,
        )
