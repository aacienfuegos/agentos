import asyncio
from datetime import datetime

from arq import ArqRedis
from sqlmodel import Session

from ..config import settings
from ..database import engine
from ..models import Run, RunStatus, LogEntry, AgentDefinition
from ..runner.anthropic import AnthropicRunner
from ..tools.notifications import send_notification


async def run_agent_task(ctx: dict, run_id: str) -> None:
    with Session(engine) as session:
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

    runner = AnthropicRunner()

    try:
        result = await asyncio.wait_for(
            runner.run(run, agent),
            timeout=agent.timeout_seconds,
        )

        with Session(engine) as session:
            run = session.get(Run, run_id)
            run.status = RunStatus.success
            run.output = result.output
            run.tokens_input = result.tokens_input
            run.tokens_output = result.tokens_output
            run.cost_usd = _calculate_cost(agent.model, result.tokens_input, result.tokens_output)
            run.finished_at = datetime.utcnow()
            session.add(run)
            session.commit()

        await send_notification(
            title=f"✅ {agent.name} completado",
            message=f"Duración: {_duration(run)}  |  Coste: ${run.cost_usd:.4f}",
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


def _calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    pricing = {
        "claude-opus-4-7": (15.0, 75.0),
        "claude-sonnet-4-6": (3.0, 15.0),
        "claude-haiku-4-5-20251001": (0.25, 1.25),
    }
    input_price, output_price = pricing.get(model, (3.0, 15.0))
    return (input_tokens * input_price + output_tokens * output_price) / 1_000_000


def _duration(run: Run) -> str:
    if run.started_at and run.finished_at:
        secs = int((run.finished_at - run.started_at).total_seconds())
        return f"{secs}s"
    return "unknown"


class WorkerSettings:
    functions = [run_agent_task]
    max_jobs = 10
    job_timeout = 3600

    @classmethod
    def redis_settings(cls):
        from arq.connections import RedisSettings
        return RedisSettings.from_dsn(settings.redis_url)
