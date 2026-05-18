from datetime import datetime
from typing import Annotated, Any

from arq import create_pool
from arq.connections import RedisSettings
from croniter import croniter
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlmodel import Session, select

from ..config import settings
from ..database import get_session
from ..models import Schedule, AgentDefinition, Run
from ..worker.scheduler import add_schedule, remove_schedule, update_schedule

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]


def _redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


class ScheduleCreate(BaseModel):
    agent_id: str
    name: str
    cron_expression: str
    input_params: dict[str, Any] = {}

    @field_validator("cron_expression")
    @classmethod
    def validate_cron(cls, v: str) -> str:
        if not croniter.is_valid(v):
            raise ValueError(f"Invalid cron expression: {v}")
        return v


class ScheduleUpdate(BaseModel):
    name: str | None = None
    cron_expression: str | None = None
    input_params: dict[str, Any] | None = None

    @field_validator("cron_expression")
    @classmethod
    def validate_cron(cls, v: str | None) -> str | None:
        if v is not None and not croniter.is_valid(v):
            raise ValueError(f"Invalid cron expression: {v}")
        return v


@router.get("")
def list_schedules(session: SessionDep) -> list[Schedule]:
    return session.exec(select(Schedule)).all()


@router.post("", status_code=201)
def create_schedule(data: ScheduleCreate, session: SessionDep) -> Schedule:
    if not session.get(AgentDefinition, data.agent_id):
        raise HTTPException(404, "Agent not found")
    cron = croniter(data.cron_expression)
    schedule = Schedule(
        **data.model_dump(),
        next_run_at=cron.get_next(datetime),
    )
    session.add(schedule)
    session.commit()
    session.refresh(schedule)
    add_schedule(schedule)
    return schedule


@router.get("/{schedule_id}")
def get_schedule(schedule_id: str, session: SessionDep) -> Schedule:
    schedule = session.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(404, "Schedule not found")
    return schedule


@router.put("/{schedule_id}")
def update_schedule_endpoint(
    schedule_id: str, data: ScheduleUpdate, session: SessionDep
) -> Schedule:
    schedule = session.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(404, "Schedule not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(schedule, key, value)
    if data.cron_expression:
        schedule.next_run_at = croniter(data.cron_expression).get_next(datetime)
    session.add(schedule)
    session.commit()
    session.refresh(schedule)
    update_schedule(schedule)
    return schedule


@router.delete("/{schedule_id}", status_code=204)
def delete_schedule(schedule_id: str, session: SessionDep) -> None:
    schedule = session.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(404, "Schedule not found")
    remove_schedule(schedule_id)
    session.delete(schedule)
    session.commit()


@router.post("/{schedule_id}/toggle")
def toggle_schedule(schedule_id: str, session: SessionDep) -> Schedule:
    schedule = session.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(404, "Schedule not found")
    schedule.enabled = not schedule.enabled
    session.add(schedule)
    session.commit()
    session.refresh(schedule)
    if schedule.enabled:
        add_schedule(schedule)
    else:
        remove_schedule(schedule_id)
    return schedule


@router.post("/{schedule_id}/run-now", status_code=202)
async def run_now(schedule_id: str, session: SessionDep) -> Run:
    schedule = session.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(404, "Schedule not found")

    run = Run(
        agent_id=schedule.agent_id,
        schedule_id=schedule_id,
        input_params=schedule.input_params,
        triggered_by="manual",
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    pool = await create_pool(_redis_settings())
    await pool.enqueue_job("run_agent_task", run.id)
    await pool.aclose()

    return run
