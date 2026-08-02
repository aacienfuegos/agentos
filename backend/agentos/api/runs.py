from typing import Annotated, Any

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import Session, select

from ..config import settings
from ..database import get_session
from ..models import Run, RunStatus, AgentDefinition, LogEntry, InfraTarget

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]


class RunCreate(BaseModel):
    agent_id: str
    input_params: dict[str, Any] = {}


class KnowledgeConversationSummary(BaseModel):
    conversation_id: str
    knowledge_agent_id: str
    turn_count: int
    first_at: str
    last_at: str


def _redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


@router.get("")
def list_runs(
    session: SessionDep,
    agent_id: str | None = None,
    status: list[RunStatus] = Query(default=[]),
    limit: int = Query(default=50, le=200),
    offset: int = 0,
    original_run_id: str | None = None,
    conversation_id: str | None = None,
    top_level: bool = False,
) -> list[Run]:
    query = select(Run).order_by(Run.created_at.desc()).offset(offset).limit(limit)
    if agent_id:
        query = query.where(Run.agent_id == agent_id)
    if status:
        query = query.where(Run.status.in_(status))
    if original_run_id:
        query = query.where(
            func.json_extract(Run.input_params, "$.original_run_id") == original_run_id
        )
    if conversation_id:
        query = query.where(
            func.json_extract(Run.input_params, "$.conversation_id") == conversation_id
        )
    if top_level:
        query = query.where(Run.run_type.notin_(["chat", "knowledge"]))
    return session.exec(query).all()


@router.get("/knowledge-conversations")
def list_knowledge_conversations(
    session: SessionDep,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
) -> list[KnowledgeConversationSummary]:
    conv_id_expr = func.json_extract(Run.input_params, "$.conversation_id")
    stmt = (
        select(
            conv_id_expr.label("conversation_id"),
            Run.agent_id,
            func.count().label("turn_count"),
            func.min(Run.created_at).label("first_at"),
            func.max(Run.created_at).label("last_at"),
        )
        .where(Run.agent_id.like("knowledge:%"))
        .where(conv_id_expr.is_not(None))
        .group_by(conv_id_expr)
        .order_by(func.max(Run.created_at).desc())
        .limit(limit)
        .offset(offset)
    )
    rows = session.execute(stmt).mappings().all()
    return [
        KnowledgeConversationSummary(
            conversation_id=row["conversation_id"],
            knowledge_agent_id=row["agent_id"].split(":", 1)[1],
            turn_count=row["turn_count"],
            first_at=str(row["first_at"]),
            last_at=str(row["last_at"]),
        )
        for row in rows
    ]


@router.post("", status_code=201)
async def create_run(run: RunCreate, session: SessionDep) -> Run:
    agent = session.get(AgentDefinition, run.agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    if agent.id == "infra-architect" and not settings.infra_agents_enabled:
        raise HTTPException(403, "Infra agents are disabled (INFRA_AGENTS_ENABLED=false)")

    target_id = run.input_params.get("target_id")
    if agent.id == "infra-architect" and target_id:
        target = session.get(InfraTarget, target_id)
        if not target:
            raise HTTPException(404, f"Infra target '{target_id}' not found")
        if not target.known_hosts_entry:
            raise HTTPException(
                400,
                "La host key de este target no está verificada — usa 'Verificar host' antes de lanzar el diagnóstico",
            )

    has_conversation = "conversation_id" in run.input_params
    run_type = "chat" if has_conversation else "agent"
    db_run = Run(agent_id=run.agent_id, input_params=run.input_params, triggered_by="manual", run_type=run_type)
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
