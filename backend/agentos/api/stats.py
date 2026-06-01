from datetime import date
from typing import Any

from fastapi import APIRouter
from sqlmodel import Session, select

from ..config import settings
from ..database import engine
from ..models import Run, RunStatus, Schedule

router = APIRouter()


@router.get("")
def get_stats() -> dict[str, Any]:
    today = date.today()
    month_start = today.replace(day=1)

    with Session(engine) as session:
        all_runs = session.exec(select(Run)).all()
        scheduled_jobs = session.exec(
            select(Schedule).where(Schedule.enabled == True)
        ).all()

        runs_today = sum(1 for r in all_runs if r.created_at.date() == today)
        runs_this_month = sum(1 for r in all_runs if r.created_at.date() >= month_start)
        active_runs = sum(1 for r in all_runs if r.status == RunStatus.running)

        status_counts: dict[RunStatus, int] = {}
        for r in all_runs:
            status_counts[r.status] = status_counts.get(r.status, 0) + 1

        month_runs = [r for r in all_runs if r.created_at.date() >= month_start]

        runs_by_agent: dict[str, int] = {}
        for r in month_runs:
            runs_by_agent[r.agent_id] = runs_by_agent.get(r.agent_id, 0) + 1

        tokens_input = sum(r.tokens_input or 0 for r in month_runs)
        tokens_output = sum(r.tokens_output or 0 for r in month_runs)
        cost_this_month = sum(r.cost_usd or 0.0 for r in month_runs)

        cost_by_agent: dict[str, float] = {}
        for r in month_runs:
            if r.cost_usd:
                cost_by_agent[r.agent_id] = cost_by_agent.get(r.agent_id, 0.0) + r.cost_usd

    return {
        "runs_today": runs_today,
        "runs_this_month": runs_this_month,
        "active_runs": active_runs,
        "scheduled_jobs": len(scheduled_jobs),
        "status_counts": {k.value: v for k, v in status_counts.items()},
        "runs_by_agent_this_month": runs_by_agent,
        "tokens_this_month": {
            "input": tokens_input,
            "output": tokens_output,
            "total": tokens_input + tokens_output,
        },
        "cost_this_month_usd": round(cost_this_month, 6),
        "cost_by_agent": {k: round(v, 6) for k, v in cost_by_agent.items()},
        "monthly_budget_usd": settings.monthly_budget_usd,
        "budget_exceeded": cost_this_month > settings.monthly_budget_usd,
    }
