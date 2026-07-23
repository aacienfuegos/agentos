import asyncio
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..database import get_session
from ..models import AgentDefinition

logger = logging.getLogger(__name__)
router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]

_AVAILABLE_TOOLS = [
    "Read", "Write", "Edit", "Bash", "Grep", "LS",
    "WebFetch", "WebSearch", "TodoRead", "TodoWrite",
]

_GENERATE_PROMPT = """\
You are an expert at designing AI agent definitions for AgentOS, a personal automation platform.

Given a description, generate a complete agent definition as a JSON object with these fields:
- id: kebab-case slug, max 30 chars, unique identifier
- name: display name, max 50 chars
- description: one-sentence description of what the agent does, max 150 chars
- system_prompt: detailed system prompt that tells the agent how to behave, what its role is, and how to approach tasks. Be specific and actionable.
- tools: array of tool names the agent needs, choose only from: {tools}
- model: one of "claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-8". Choose based on task complexity.
- knowledge_agent_id: id of a knowledge base to link, or null. Choose one if the agent clearly needs a specific knowledge base.{knowledge_section}

Rules:
- system_prompt should be 3-8 sentences, specific to the agent's purpose
- tools should be the minimum set needed for the task
- model: haiku for simple/fast tasks, sonnet for most tasks, opus for complex reasoning
- Return ONLY valid JSON, no markdown, no explanations

User request: {description}"""

_KNOWLEDGE_SECTION = """

Available knowledge bases (id → name: description):
{entries}"""


class AgentCreate(BaseModel):
    id: str
    name: str
    description: str
    system_prompt: str
    tools: list[str] = []
    model: str = "claude-sonnet-4-6"
    max_tokens: int = 4096
    timeout_seconds: int = 300
    knowledge_agent_id: str | None = None


class AgentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    tools: list[str] | None = None
    model: str | None = None
    max_tokens: int | None = None
    timeout_seconds: int | None = None
    knowledge_agent_id: str | None = None


class AgentGenerateRequest(BaseModel):
    description: str


class AgentGenerateResponse(BaseModel):
    id: str
    name: str
    description: str
    system_prompt: str
    tools: list[str]
    model: str
    knowledge_agent_id: str | None = None


@router.get("")
def list_agents(session: SessionDep) -> list[AgentDefinition]:
    return session.exec(select(AgentDefinition)).all()


@router.post("/generate", response_model=AgentGenerateResponse)
async def generate_agent(req: AgentGenerateRequest, session: SessionDep) -> AgentGenerateResponse:
    if not req.description.strip():
        raise HTTPException(400, "La descripción no puede estar vacía")

    from ..models import KnowledgeAgent
    from sqlmodel import select as sa_select
    knowledge_agents = session.exec(sa_select(KnowledgeAgent)).all()
    if knowledge_agents:
        entries = "\n".join(
            f"- {ka.id} → {ka.name}: {ka.description}" for ka in knowledge_agents
        )
        knowledge_section = _KNOWLEDGE_SECTION.format(entries=entries)
    else:
        knowledge_section = ""

    prompt = _GENERATE_PROMPT.format(
        tools=", ".join(_AVAILABLE_TOOLS),
        knowledge_section=knowledge_section,
        description=req.description.strip(),
    )
    env = {**os.environ, "HOME": str(Path.home())}
    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", "-p", prompt,
            "--output-format", "text",
            "--no-session-persistence",
            "--model", "claude-sonnet-4-6",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
    except asyncio.TimeoutError:
        raise HTTPException(504, "Tiempo de espera agotado generando agente")
    except Exception as e:
        logger.error("Error calling claude for agent generation: %s", e)
        raise HTTPException(500, "Error ejecutando generación")

    if proc.returncode != 0:
        logger.error("claude -p failed: %s", stderr.decode(errors="replace"))
        raise HTTPException(500, "Error en la generación del agente")

    raw = stdout.decode(errors="replace").strip()
    if not raw:
        raise HTTPException(500, "La generación no produjo contenido")

    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw
        raw = raw.rsplit("```", 1)[0].strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error("Invalid JSON from claude: %s — raw: %s", e, raw[:200])
        raise HTTPException(500, "La generación produjo JSON inválido")

    valid_ka_ids = {ka.id for ka in knowledge_agents}
    raw_ka_id = data.get("knowledge_agent_id")
    knowledge_agent_id = raw_ka_id if raw_ka_id in valid_ka_ids else None

    return AgentGenerateResponse(
        id=str(data.get("id", ""))[:30],
        name=str(data.get("name", ""))[:50],
        description=str(data.get("description", ""))[:150],
        system_prompt=str(data.get("system_prompt", "")),
        tools=[t for t in data.get("tools", []) if t in _AVAILABLE_TOOLS],
        model=data.get("model", "claude-sonnet-4-6"),
        knowledge_agent_id=knowledge_agent_id,
    )


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
