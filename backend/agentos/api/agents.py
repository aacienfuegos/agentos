from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..database import get_session
from ..models import AgentDefinition

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]


class AgentCreate(BaseModel):
    id: str
    name: str
    description: str
    system_prompt: str
    tools: list[str] = []
    model: str = "claude-sonnet-4-6"
    max_tokens: int = 4096
    timeout_seconds: int = 300


class AgentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    tools: list[str] | None = None
    model: str | None = None
    max_tokens: int | None = None
    timeout_seconds: int | None = None


@router.get("")
def list_agents(session: SessionDep) -> list[AgentDefinition]:
    return session.exec(select(AgentDefinition)).all()


@router.post("", status_code=201)
def create_agent(agent: AgentCreate, session: SessionDep) -> AgentDefinition:
    if session.get(AgentDefinition, agent.id):
        raise HTTPException(400, f"Agent '{agent.id}' already exists")
    db_agent = AgentDefinition(**agent.model_dump())
    session.add(db_agent)
    session.commit()
    session.refresh(db_agent)
    return db_agent


@router.get("/{agent_id}")
def get_agent(agent_id: str, session: SessionDep) -> AgentDefinition:
    agent = session.get(AgentDefinition, agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    return agent


@router.put("/{agent_id}")
def update_agent(agent_id: str, update: AgentUpdate, session: SessionDep) -> AgentDefinition:
    agent = session.get(AgentDefinition, agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    data = update.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(agent, key, value)
    agent.updated_at = datetime.utcnow()
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return agent


@router.delete("/{agent_id}", status_code=204)
def delete_agent(agent_id: str, session: SessionDep) -> None:
    agent = session.get(AgentDefinition, agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    if agent.is_builtin:
        raise HTTPException(400, "Cannot delete built-in agents")
    session.delete(agent)
    session.commit()
