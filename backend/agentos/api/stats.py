from datetime import date
from typing import Any

from fastapi import APIRouter
from sqlmodel import Session, select

from ..database import engine
from ..models import Run, RunStatus

router = APIRouter()


@router.get("")
def get_stats() -> dict[str, Any]:
    today = date.today()
    month_start = today.replace(day=1)

    with Session(engine) as session:
        all_runs = session.exec(select(Run)).all()

        runs_today = sum(1 for r in all_runs if r.created_at.date() == today)
        runs_this_month = sum(1 for r in all_runs if r.created_at.date() >= month_start)
        active_runs = sum(1 for r in all_runs if r.status == RunStatus.running)

        status_counts = {}
        for r in all_runs:
            status_counts[r.status] = status_counts.get(r.status, 0) + 1

        runs_by_agent: dict[str, int] = {}
        for r in [r for r in all_runs if r.created_at.date() >= month_start]:
            runs_by_agent[r.agent_id] = runs_by_agent.get(r.agent_id, 0) + 1

    return {
        "runs_today": runs_today,
        "runs_this_month": runs_this_month,
        "active_runs": active_runs,
        "status_counts": {k.value: v for k, v in status_counts.items()},
        "runs_by_agent_this_month": runs_by_agent,
    }
