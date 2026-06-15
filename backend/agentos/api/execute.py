import asyncio
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Annotated, Any

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from ..config import settings
from ..database import get_session, engine
from ..models import ApiKey, Run, RunStatus
from ..runner.claude_code import ClaudeCodeRunner

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]

EXECUTE_AGENT_ID = "__execute__"

_DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful assistant. Complete the requested task accurately. "
    "Do not take destructive or irreversible actions unless explicitly instructed."
)

_MAX_CONCURRENT_API_RUNS = 3


@dataclass
class _ExecuteAgentProxy:
    """Minimal AgentDefinition-compatible object for ClaudeCodeRunner."""
    id: str = EXECUTE_AGENT_ID
    system_prompt: str = _DEFAULT_SYSTEM_PROMPT
    model: str = "claude-sonnet-4-6"
    tools: list[str] = field(default_factory=list)


class ExecuteRequest(BaseModel):
    prompt: str
    system_prompt: str = _DEFAULT_SYSTEM_PROMPT
    model: str = "claude-sonnet-4-6"
    timeout_seconds: int = Field(default=120, ge=5, le=600)
    async_mode: bool = Field(default=False, alias="async")

    model_config = {"populate_by_name": True}


class ExecuteResponse(BaseModel):
    output: str
    tokens_input: int
    tokens_output: int
    cost_usd: float | None
    run_id: str


class ExecuteAsyncResponse(BaseModel):
    run_id: str
    status: str


def _redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


def _check_budget(session: Session) -> None:
    if settings.monthly_budget_usd <= 0:
        return
    month_start = datetime.combine(date.today().replace(day=1), datetime.min.time())
    cost = session.exec(
        select(func.coalesce(func.sum(Run.cost_usd), 0.0)).where(Run.created_at >= month_start)
    ).one()
    if cost >= settings.monthly_budget_usd:
        raise HTTPException(402, f"Monthly budget of ${settings.monthly_budget_usd} exceeded")


def _check_concurrency(session: Session) -> None:
    active = session.exec(
        select(func.count(Run.id)).where(
            Run.triggered_by == "api",
            Run.status.in_([RunStatus.pending, RunStatus.running]),
        )
    ).one()
    if active >= _MAX_CONCURRENT_API_RUNS:
        raise HTTPException(429, f"Too many concurrent API runs (max {_MAX_CONCURRENT_API_RUNS})")


def _get_api_key_name(authorization: str, session: Session) -> str | None:
    import hashlib
    raw = authorization[len("Bearer "):]
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    key = session.exec(select(ApiKey).where(ApiKey.key_hash == key_hash)).first()
    return key.name if key else None


def _create_run(session: Session, req: ExecuteRequest, api_key_name: str | None = None) -> Run:
    input_params: dict[str, Any] = {
        "user_message": req.prompt,
        "system_prompt": req.system_prompt,
        "model": req.model,
        "timeout_seconds": req.timeout_seconds,
    }
    if api_key_name:
        input_params["api_key_name"] = api_key_name
    run = Run(
        agent_id=EXECUTE_AGENT_ID,
        triggered_by="api",
        input_params=input_params,
        status=RunStatus.pending,
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


@router.post("")
async def execute(req: ExecuteRequest, request: Request, session: SessionDep) -> ExecuteResponse | ExecuteAsyncResponse:
    _check_budget(session)
    _check_concurrency(session)
    auth = request.headers.get("Authorization", "")
    api_key_name = _get_api_key_name(auth, session) if auth.startswith("Bearer sk-agentos-") else None
    run = _create_run(session, req, api_key_name)

    run_id = run.id  # Store before any commit/expunge cycle

    if req.async_mode:
        pool = await create_pool(_redis_settings())
        await pool.enqueue_job("run_agent_task", run_id)
        await pool.aclose()
        return ExecuteAsyncResponse(run_id=run_id, status=run.status.value)

    # Sync mode: run directly in the FastAPI process (no ARQ)
    agent = _ExecuteAgentProxy(
        system_prompt=req.system_prompt,
        model=req.model,
    )

    run.status = RunStatus.running
    run.started_at = datetime.utcnow()
    session.add(run)
    session.commit()
    session.refresh(run)
    session.expunge(run)

    runner = ClaudeCodeRunner()
    try:
        result = await asyncio.wait_for(
            runner.run(run, agent),
            timeout=req.timeout_seconds,
        )
    except asyncio.TimeoutError:
        _fail_run(run_id, f"Timeout after {req.timeout_seconds}s")
        raise HTTPException(408, detail={"error": f"Timeout after {req.timeout_seconds}s", "run_id": run_id})
    except Exception as e:
        _fail_run(run_id, str(e))
        raise HTTPException(500, detail={"error": str(e), "run_id": run_id})

    # Re-fetch within the same dependency session to avoid connection conflicts
    db_run = session.get(Run, run_id)
    if db_run:
        db_run.status = RunStatus.success
        db_run.output = result.output
        db_run.tokens_input = result.tokens_input
        db_run.tokens_output = result.tokens_output
        db_run.tokens_cache_read = result.tokens_cache_read
        db_run.tokens_cache_write = result.tokens_cache_write
        db_run.session_id = result.session_id
        db_run.finished_at = datetime.utcnow()
        session.add(db_run)
        session.commit()

    return ExecuteResponse(
        output=result.output,
        tokens_input=result.tokens_input,
        tokens_output=result.tokens_output,
        cost_usd=None,
        run_id=run_id,
    )


def _fail_run(run_id: str, error: str) -> None:
    with Session(engine) as s:
        run = s.get(Run, run_id)
        if run:
            run.status = RunStatus.failed
            run.error = error
            run.finished_at = datetime.utcnow()
            s.add(run)
            s.commit()
