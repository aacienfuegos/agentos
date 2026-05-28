"""
KnowledgeRunner — usa el CLI `claude` (Claude Pro, sin coste extra de API).

El agente recibe el knowledge_doc en el system prompt y, si necesita actualizar
el documento, usa la herramienta Write para escribir el doc completo en un
path temporal. Al terminar el run, el runner lee ese fichero, lo persiste en
SQLite y lo borra.
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

_TOOLS = ["Read", "Write"]


@dataclass
class KnowledgeRunResult:
    output: str
    tokens_input: int = field(default=0)
    tokens_output: int = field(default=0)
    knowledge_doc_updated: bool = field(default=False)
    session_id: str | None = field(default=None)


def _update_path(run_id: str) -> Path:
    return Path(f"/tmp/knowledge_update_{run_id}.md")


def _build_system_prompt(ka: KnowledgeAgent, run_id: str) -> str:
    update_file = _update_path(run_id)
    base = ka.system_prompt or (
        f"Eres un asistente especializado en {ka.name}. "
        "Responde usando la base de conocimiento disponible."
    )
    doc_section = (
        f"\n\n## Base de conocimiento: {ka.name}\n\n{ka.knowledge_doc}"
        if ka.knowledge_doc
        else f"\n\n## Base de conocimiento: {ka.name}\n\n(sin contenido aún)"
    )
    update_hint = (
        f"\n\n---\n"
        f"Si aprendes algo nuevo o detectas una corrección necesaria en la base de conocimiento, "
        f"escribe el documento COMPLETO actualizado en Markdown en este fichero:\n\n"
        f"  {update_file}\n\n"
        f"Usa la herramienta Write con path=\"{update_file}\" y el documento completo como contenido. "
        f"Después del write, indica brevemente al usuario qué has actualizado."
    )
    return base + doc_section + update_hint


class KnowledgeRunner:
    def __init__(self, redis_url: str | None = None):
        from ..config import settings
        self._redis_url = redis_url or settings.redis_url

    async def run(self, run: Run, ka: KnowledgeAgent) -> KnowledgeRunResult:
        resume_session_id: str | None = run.input_params.get("resume_session_id")
        system_prompt = _build_system_prompt(ka, run.id) if not resume_session_id else ""

        proxy_agent = AgentDefinition(
            id=f"knowledge:{ka.id}",
            name=ka.name,
            description=ka.description,
            system_prompt=system_prompt,
            tools=_TOOLS,
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
        )

        doc_updated = self._apply_update(ka.id, run.id)

        return KnowledgeRunResult(
            output=result.output,
            tokens_input=result.tokens_input,
            tokens_output=result.tokens_output,
            knowledge_doc_updated=doc_updated,
            session_id=result.session_id,
        )

    def _apply_update(self, ka_id: str, run_id: str) -> bool:
        path = _update_path(run_id)
        if not path.exists():
            return False
        try:
            new_doc = path.read_text(encoding="utf-8")
            with Session(engine) as session:
                ka = session.get(KnowledgeAgent, ka_id)
                if ka:
                    ka.knowledge_doc = new_doc
                    ka.updated_at = datetime.utcnow()
                    session.add(ka)
                    session.commit()
            logger.info("Knowledge doc updated for agent '%s' (run %s)", ka_id, run_id)
            return True
        except Exception as e:
            logger.error("Failed to apply knowledge doc update: %s", e)
            return False
        finally:
            try:
                path.unlink(missing_ok=True)
            except Exception:
                pass
