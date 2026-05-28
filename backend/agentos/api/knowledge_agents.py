from datetime import datetime
from typing import Annotated, Any

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlmodel import Session, select

from ..config import settings
from ..database import get_session
from ..models import KnowledgeAgent, Run, RunStatus

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]


class KnowledgeAgentCreate(BaseModel):
    id: str
    name: str
    description: str = ""
    system_prompt: str = ""
    knowledge_doc: str = ""
    model: str = "claude-sonnet-4-6"
    tools: list[str] = ["Read", "Write"]


class KnowledgeAgentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    knowledge_doc: str | None = None
    model: str | None = None
    tools: list[str] | None = None


@router.get("")
def list_knowledge_agents(session: SessionDep) -> list[KnowledgeAgent]:
    return session.exec(select(KnowledgeAgent)).all()


@router.post("", status_code=201)
def create_knowledge_agent(data: KnowledgeAgentCreate, session: SessionDep) -> KnowledgeAgent:
    if session.get(KnowledgeAgent, data.id):
        raise HTTPException(400, f"Knowledge agent '{data.id}' already exists")
    agent = KnowledgeAgent(**data.model_dump())
    session.add(agent)
    session.commit()
    session.refresh(agent)
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
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(agent, field, value)
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


@router.get("/{agent_id}/document")
def export_knowledge_doc(agent_id: str, session: SessionDep) -> Response:
    agent = session.get(KnowledgeAgent, agent_id)
    if not agent:
        raise HTTPException(404, "Knowledge agent not found")
    return Response(
        content=agent.knowledge_doc or "",
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{agent_id}.md"'},
    )


@router.put("/{agent_id}/document", status_code=200)
async def import_knowledge_doc(agent_id: str, request: Request, session: SessionDep) -> KnowledgeAgent:
    agent = session.get(KnowledgeAgent, agent_id)
    if not agent:
        raise HTTPException(404, "Knowledge agent not found")
    raw = await request.body()
    agent.knowledge_doc = raw.decode("utf-8")
    agent.updated_at = datetime.utcnow()
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return agent


class KnowledgeQuery(BaseModel):
    user_message: str
    resume_session_id: str | None = None
    conversation_id: str | None = None


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

    run = Run(
        agent_id=f"knowledge:{agent_id}",
        input_params=input_params,
        triggered_by="manual",
        status=RunStatus.pending,
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    await pool.enqueue_job("run_agent_task", run.id)
    await pool.aclose()

    return {"run_id": run.id}
