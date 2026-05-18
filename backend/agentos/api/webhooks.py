import hashlib
import hmac
import json
from typing import Any

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, HTTPException, Request
from sqlmodel import Session

from ..config import settings
from ..database import engine
from ..models import Run

router = APIRouter()

BOT_LOGINS = {"dependabot[bot]", "renovate[bot]", "github-actions[bot]"}


def _redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


def _verify_signature(body: bytes, signature: str) -> bool:
    if not settings.github_webhook_secret:
        return True  # skip verification in dev if no secret configured
    expected = "sha256=" + hmac.new(
        settings.github_webhook_secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


@router.post("/github")
async def github_webhook(request: Request) -> dict[str, Any]:
    body = await request.body()
    signature = request.headers.get("X-Hub-Signature-256", "")

    if not _verify_signature(body, signature):
        raise HTTPException(401, "Invalid webhook signature")

    event = request.headers.get("X-GitHub-Event", "")
    payload = json.loads(body)

    if event != "pull_request":
        return {"ok": True, "action": "ignored", "reason": f"event={event}"}

    action = payload.get("action", "")
    if action not in ("opened", "synchronize", "reopened"):
        return {"ok": True, "action": "ignored", "reason": f"pr action={action}"}

    sender = payload.get("sender", {}).get("login", "")
    if sender in BOT_LOGINS:
        return {"ok": True, "action": "ignored", "reason": "bot PR"}

    pr_number = payload["pull_request"]["number"]
    repo = payload["repository"]["full_name"]

    with Session(engine) as session:
        run = Run(
            agent_id="code-review",
            input_params={"repo": repo, "pr_number": pr_number, "focus": "all"},
            triggered_by="webhook",
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        run_id = run.id

    pool = await create_pool(_redis_settings())
    await pool.enqueue_job("run_agent_task", run_id)
    await pool.aclose()

    return {"ok": True, "run_id": run_id, "pr": pr_number, "repo": repo}
