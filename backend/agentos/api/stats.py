from datetime import datetime, date
from typing import Any

from fastapi import APIRouter
from sqlmodel import Session, select, func

from ..database import engine
from ..models import Run, RunStatus
from ..config import settings

router = APIRouter()

# Approximate pricing per million tokens (input/output) by model
MODEL_PRICING: dict[str, tuple[float, float]] = {
    "claude-opus-4-7": (15.0, 75.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5-20251001": (0.25, 1.25),
}
DEFAULT_PRICING = (3.0, 15.0)  # fallback to sonnet pricing


def _cost(model: str, input_tokens: int, output_tokens: int) -> float:
    input_price, output_price = MODEL_PRICING.get(model, DEFAULT_PRICING)
    return (input_tokens * input_price + output_tokens * output_price) / 1_000_000


@router.get("")
def get_stats() -> dict[str, Any]:
    today = date.today()
    month_start = today.replace(day=1)

    with Session(engine) as session:
        all_runs = session.exec(select(Run)).all()

        runs_today = sum(1 for r in all_runs if r.created_at.date() == today)
        runs_this_month = sum(1 for r in all_runs if r.created_at.date() >= month_start)
        active_runs = sum(1 for r in all_runs if r.status == RunStatus.running)

        monthly_runs = [r for r in all_runs if r.created_at.date() >= month_start]
        tokens_input = sum(r.tokens_input or 0 for r in monthly_runs)
        tokens_output = sum(r.tokens_output or 0 for r in monthly_runs)
        cost_this_month = sum(r.cost_usd or 0.0 for r in monthly_runs)

        cost_by_agent: dict[str, float] = {}
        for r in monthly_runs:
            cost_by_agent[r.agent_id] = cost_by_agent.get(r.agent_id, 0.0) + (r.cost_usd or 0.0)

    budget = settings.monthly_budget_usd
    return {
        "runs_today": runs_today,
        "runs_this_month": runs_this_month,
        "active_runs": active_runs,
        "tokens_this_month": {
            "input": tokens_input,
            "output": tokens_output,
            "total": tokens_input + tokens_output,
        },
        "cost_this_month_usd": round(cost_this_month, 4),
        "cost_by_agent": {k: round(v, 4) for k, v in cost_by_agent.items()},
        "monthly_budget_usd": budget,
        "budget_used_pct": round(cost_this_month / budget * 100, 1) if budget > 0 else 0,
        "budget_exceeded": cost_this_month > budget,
    }
