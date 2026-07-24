import asyncio
from dataclasses import dataclass, field
from datetime import datetime

from arq.connections import RedisSettings
from sqlmodel import Session

from ..config import settings
from ..database import engine
from ..models import Run, RunStatus, AgentDefinition, KnowledgeBase, InfraTarget
from ..runner.claude_code import ClaudeCodeRunner
from ..runner.knowledge import KnowledgeRunner
from ..tools.notifications import send_notification

_KNOWLEDGE_PREFIX = "knowledge:"
_EXECUTE_AGENT_ID = "__execute__"


@dataclass
class _ExecuteAgentProxy:
    """In-memory AgentDefinition for async /api/execute runs."""
    id: str
    system_prompt: str
    model: str
    tools: list[str] = field(default_factory=list)


async def run_agent_task(ctx: dict, run_id: str) -> None:
    with Session(engine, expire_on_commit=False) as session:
        run = session.get(Run, run_id)
        if not run:
            return

        # Route to generic execute runner (async mode of /api/execute)
        if run.agent_id == _EXECUTE_AGENT_ID:
            params = run.input_params
            agent = _ExecuteAgentProxy(
                id=_EXECUTE_AGENT_ID,
                system_prompt=params.get("system_prompt", ""),
                model=params.get("model", "claude-sonnet-4-6"),
                tools=params.get("tools", ["WebFetch", "WebSearch"]),
            )
            run.status = RunStatus.running
            run.started_at = datetime.utcnow()
            session.add(run)
            session.commit()
            session.expunge(run)
            timeout = params.get("timeout_seconds", 120)
            await _run_generic(run, agent, timeout)
            return

        # Route to KnowledgeRunner if agent_id starts with "knowledge:"
        if run.agent_id.startswith(_KNOWLEDGE_PREFIX):
            kb_id = run.agent_id[len(_KNOWLEDGE_PREFIX):]
            kb = session.get(KnowledgeBase, kb_id)
            if not kb:
                run.status = RunStatus.failed
                run.error = f"Knowledge base '{kb_id}' not found"
                session.add(run)
                session.commit()
                return
            run.status = RunStatus.running
            run.started_at = datetime.utcnow()
            session.add(run)
            session.commit()
            session.expunge(run)
            session.expunge(kb)
            await _run_knowledge(run, kb)
            return

        agent = session.get(AgentDefinition, run.agent_id)
        if not agent:
            run.status = RunStatus.failed
            run.error = f"Agent '{run.agent_id}' not found"
            session.add(run)
            session.commit()
            return

        run.status = RunStatus.running
        run.started_at = datetime.utcnow()
        session.add(run)
        session.commit()

        resume_session_id: str | None = run.input_params.get("resume_session_id")
        initial_context: str | None = run.input_params.get("initial_context")

        # Inject knowledge base context if configured and not resuming a session
        ka_cwd: str | None = None
        if not resume_session_id and agent.knowledge_base_id:
            kb = session.get(KnowledgeBase, agent.knowledge_base_id)
            if kb:
                from ..runner.knowledge import _build_system_prompt, ensure_knowledge_dir
                ensure_knowledge_dir(kb)
                knowledge_ctx = _build_system_prompt(kb, mode="context")
                agent.system_prompt = knowledge_ctx + "\n\n---\n\n" + agent.system_prompt
                ka_cwd = kb.knowledge_path
                session.expunge(kb)

        # Inject the concrete InfraTarget connection details for infra-architect
        # runs, so it diagnoses the target the caller picked instead of the
        # fixed example alias hardcoded in its own system prompt.
        target_id: str | None = run.input_params.get("target_id")
        if not resume_session_id and target_id and agent.id == "infra-architect":
            target = session.get(InfraTarget, target_id)
            if target:
                target_ctx = (
                    f"## InfraTarget: {target.name} (id: {target.id})\n"
                    f"Conéctate con: `ssh -p {target.ssh_port} {target.ssh_user}@{target.host} <comando>`\n"
                    f"Notas: {target.notes or '(sin notas)'}\n"
                )
                agent.system_prompt = target_ctx + "\n---\n\n" + agent.system_prompt

        # Detach before session closes so attributes remain accessible after expiry
        session.expunge(run)
        session.expunge(agent)

    runner = ClaudeCodeRunner()

    try:
        result = await asyncio.wait_for(
            runner.run(run, agent, persist_session=True, resume_session_id=resume_session_id, cwd=ka_cwd, initial_context=initial_context),
            timeout=agent.timeout_seconds,
        )

        with Session(engine, expire_on_commit=False) as session:
            run = session.get(Run, run_id)
            run.status = RunStatus.success
            run.output = result.output
            run.tokens_input = result.tokens_input
            run.tokens_output = result.tokens_output
            run.tokens_cache_read = result.tokens_cache_read
            run.tokens_cache_write = result.tokens_cache_write
            run.session_id = result.session_id
            run.finished_at = datetime.utcnow()
            session.add(run)
            session.commit()
            duration = _duration(run)
            session.expunge(run)

        await send_notification(
            title=f"✅ {agent.name} completado",
            message=f"Duración: {duration}",
            priority="default",
        )

    except asyncio.TimeoutError:
        _mark_failed(run_id, f"Timeout after {agent.timeout_seconds}s")
        await send_notification(
            title=f"⏱ {agent.name} timeout",
            message=f"El agente superó el tiempo límite de {agent.timeout_seconds}s",
            priority="high",
        )

    except asyncio.CancelledError:
        _mark_failed(run_id, "Cancelled")

    except Exception as e:
        _mark_failed(run_id, str(e))
        await send_notification(
            title=f"❌ {agent.name} falló",
            message=str(e)[:200],
            priority="high",
        )


def _mark_failed(run_id: str, error: str) -> None:
    with Session(engine) as session:
        run = session.get(Run, run_id)
        if run:
            run.status = RunStatus.failed
            run.error = error
            run.finished_at = datetime.utcnow()
            session.add(run)
            session.commit()


async def _run_knowledge(run: Run, kb: KnowledgeBase) -> None:
    runner = KnowledgeRunner()
    run_id = run.id
    try:
        result = await runner.run(run, kb)
        with Session(engine, expire_on_commit=False) as session:
            run = session.get(Run, run_id)
            run.status = RunStatus.success
            run.output = result.output
            run.tokens_input = result.tokens_input
            run.tokens_output = result.tokens_output
            run.tokens_cache_read = result.tokens_cache_read
            run.tokens_cache_write = result.tokens_cache_write
            run.session_id = result.session_id
            run.finished_at = datetime.utcnow()
            session.add(run)
            session.commit()
        await send_notification(
            title=f"✅ {kb.name} completado",
            message=f"Tokens: {result.tokens_input + result.tokens_output}",
            priority="default",
        )
    except Exception as e:
        _mark_failed(run_id, str(e))
        await send_notification(
            title=f"❌ {kb.name} falló",
            message=str(e)[:200],
            priority="high",
        )



async def _run_generic(run: Run, agent: _ExecuteAgentProxy, timeout: int) -> None:
    runner = ClaudeCodeRunner()
    run_id = run.id
    try:
        result = await asyncio.wait_for(runner.run(run, agent), timeout=timeout)
        with Session(engine, expire_on_commit=False) as session:
            run = session.get(Run, run_id)
            if run:
                run.status = RunStatus.success
                run.output = result.output
                run.tokens_input = result.tokens_input
                run.tokens_output = result.tokens_output
                run.tokens_cache_read = result.tokens_cache_read
                run.tokens_cache_write = result.tokens_cache_write
                run.session_id = result.session_id
                run.finished_at = datetime.utcnow()
                session.add(run)
                session.commit()
    except asyncio.TimeoutError:
        _mark_failed(run_id, f"Timeout after {timeout}s")
    except Exception as e:
        _mark_failed(run_id, str(e))


def _duration(run: Run) -> str:
    if run.started_at and run.finished_at:
        secs = int((run.finished_at - run.started_at).total_seconds())
        return f"{secs}s"
    return "unknown"


class WorkerSettings:
    functions = [run_agent_task]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = 10
    job_timeout = 3600
