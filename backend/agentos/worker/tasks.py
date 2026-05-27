import asyncio
from datetime import datetime

from arq.connections import RedisSettings
from sqlmodel import Session

from ..config import settings
from ..database import engine
from ..models import Run, RunStatus, AgentDefinition
from ..runner.claude_code import ClaudeCodeRunner
from ..tools.notifications import send_notification


async def run_agent_task(ctx: dict, run_id: str) -> None:
    with Session(engine, expire_on_commit=False) as session:
        run = session.get(Run, run_id)
        if not run:
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

        # Detach before session closes so attributes remain accessible after expiry
        session.expunge(run)
        session.expunge(agent)

    runner = ClaudeCodeRunner()

    try:
        result = await asyncio.wait_for(
            runner.run(run, agent),
            timeout=agent.timeout_seconds,
        )

        with Session(engine, expire_on_commit=False) as session:
            run = session.get(Run, run_id)
            run.status = RunStatus.success
            run.output = result.output
            run.tokens_input = result.tokens_input
            run.tokens_output = result.tokens_output
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
