import json
from typing import AsyncGenerator

import redis.asyncio as aioredis
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from ..config import settings
from ..database import engine
from ..models import Run, LogEntry, RunStatus

router = APIRouter()


def _stream_historical(session: Session, run_id: str):
    """Yield SSE lines for all persisted log entries, then a done event."""
    logs = session.exec(
        select(LogEntry).where(LogEntry.run_id == run_id).order_by(LogEntry.id)
    ).all()
    for log in logs:
        payload = {"level": log.level, "message": log.message, "metadata": log.extra}
        yield f"data: {json.dumps(payload)}\n\n"
    yield 'event: done\ndata: {}\n\n'


async def _log_event_generator(run_id: str) -> AsyncGenerator[str, None]:
    with Session(engine) as session:
        run = session.get(Run, run_id)
        if not run:
            return

        # Already finished: stream historical logs immediately
        if run.status in (RunStatus.success, RunStatus.failed, RunStatus.cancelled):
            for line in _stream_historical(session, run_id):
                yield line
            return

    # Subscribe to Redis BEFORE the second status check to close the race window:
    # if the run finishes between the check above and the subscribe below,
    # the second check will catch it and stream historical logs instead of
    # hanging forever waiting for messages that were already published.
    client = aioredis.from_url(settings.redis_url)
    pubsub = client.pubsub()
    await pubsub.subscribe(f"run:{run_id}:logs")

    try:
        # Re-check: did the run finish while we were subscribing?
        with Session(engine) as session:
            run = session.get(Run, run_id)
            if run and run.status in (RunStatus.success, RunStatus.failed, RunStatus.cancelled):
                for line in _stream_historical(session, run_id):
                    yield line
                return

        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            data = message["data"]
            if isinstance(data, bytes):
                data = data.decode()
            payload = json.loads(data)
            yield f"data: {json.dumps(payload)}\n\n"
            if payload.get("level") == "done":
                break
    finally:
        await pubsub.unsubscribe(f"run:{run_id}:logs")
        await client.aclose()


@router.get("/{run_id}/stream")
async def stream_logs(run_id: str):
    with Session(engine) as session:
        if not session.get(Run, run_id):
            raise HTTPException(404, "Run not found")

    return StreamingResponse(
        _log_event_generator(run_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
