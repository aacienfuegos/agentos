from typing import Annotated

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..config import settings
from ..database import get_session
from ..models import InfraLink, InfraNetwork, InfraNode, InfraService, Run, RunStatus
from ..runner.infra_map import INFRA_MAP_AGENT_ID

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]


class RefreshResponse(BaseModel):
    run_id: str
    status: str


class LastRefresh(BaseModel):
    run_id: str
    status: str
    finished_at: str | None


class InfraMapResponse(BaseModel):
    networks: list[InfraNetwork]
    nodes: list[InfraNode]
    services: list[InfraService]
    links: list[InfraLink]
    last_refresh: LastRefresh | None


def _redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


@router.post("/refresh")
async def refresh(session: SessionDep) -> RefreshResponse:
    if not settings.infra_map_docs_path:
        raise HTTPException(400, "infra_map_docs_path no está configurado")

    run = Run(
        agent_id=INFRA_MAP_AGENT_ID,
        triggered_by="manual",
        run_type="infra_map",
        input_params={"user_message": "Extrae la infraestructura documentada y escribe extraction.json."},
        status=RunStatus.pending,
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    run_id = run.id

    pool = await create_pool(_redis_settings())
    await pool.enqueue_job("run_agent_task", run_id)
    await pool.aclose()

    return RefreshResponse(run_id=run_id, status=run.status.value)


@router.get("")
async def get_infra_map(session: SessionDep) -> InfraMapResponse:
    networks = session.exec(select(InfraNetwork)).all()
    nodes = session.exec(select(InfraNode)).all()
    services = session.exec(select(InfraService)).all()
    links = session.exec(select(InfraLink)).all()

    last_run = session.exec(
        select(Run)
        .where(Run.agent_id == INFRA_MAP_AGENT_ID)
        .order_by(Run.created_at.desc())
    ).first()

    last_refresh = None
    if last_run:
        last_refresh = LastRefresh(
            run_id=last_run.id,
            status=last_run.status.value,
            finished_at=last_run.finished_at.isoformat() if last_run.finished_at else None,
        )

    return InfraMapResponse(
        networks=networks,
        nodes=nodes,
        services=services,
        links=links,
        last_refresh=last_refresh,
    )
