from typing import Annotated, Any

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from ..config import settings
from ..database import get_session
from ..models import Run, RunStatus, AgentDefinition, LogEntry

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]


class RunCreate(BaseModel):
    agent_id: str
    input_params: dict[str, Any] = {}


def _redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


@router.get("")
def list_runs(
    session: SessionDep,
    agent_id: str | None = None,
    status: RunStatus | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
) -> list[Run]:
    query = select(Run).order_by(Run.created_at.desc()).offset(offset).limit(limit)
    if agent_id:
        query = query.where(Run.agent_id == agent_id)
    if status:
        query = query.where(Run.status == status)
    return session.exec(query).all()


@router.post("", status_code=201)
async def create_run(run: RunCreate, session: SessionDep) -> Run:
    agent = session.get(AgentDefinition, run.agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")

    db_run = Run(agent_id=run.agent_id, input_params=run.input_params, triggered_by="manual")
    session.add(db_run)
    session.commit()
    session.refresh(db_run)

    pool = await create_pool(_redis_settings())
    await pool.enqueue_job("run_agent_task", db_run.id)
    await pool.aclose()

    return db_run


@router.get("/{run_id}")
def get_run(run_id: str, session: SessionDep) -> Run:
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@router.get("/{run_id}/logs")
def get_run_logs(run_id: str, session: SessionDep) -> list[LogEntry]:
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return session.exec(
        select(LogEntry).where(LogEntry.run_id == run_id).order_by(LogEntry.id)
    ).all()


@router.delete("/{run_id}", status_code=204)
async def cancel_run(run_id: str, session: SessionDep) -> None:
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    if run.status not in (RunStatus.pending, RunStatus.running):
        raise HTTPException(400, f"Cannot cancel run with status '{run.status}'")

    pool = await create_pool(_redis_settings())
    await pool.publish(f"run:{run_id}:cancel", "cancel")
    await pool.aclose()

    run.status = RunStatus.cancelled
    session.add(run)
    session.commit()
