from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import create_db_and_tables, engine
from .api import agents, runs, schedules, stream, stats, webhooks, auth
from .worker.scheduler import start_scheduler, stop_scheduler
from .agents.builtin import seed_builtin_agents


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    seed_builtin_agents()
    await start_scheduler()
    yield
    await stop_scheduler()


app = FastAPI(
    title="AgentOS API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://frontend:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(agents.router, prefix="/api/agents", tags=["agents"])
app.include_router(runs.router, prefix="/api/runs", tags=["runs"])
app.include_router(schedules.router, prefix="/api/schedules", tags=["schedules"])
app.include_router(stream.router, prefix="/api/runs", tags=["stream"])
app.include_router(stats.router, prefix="/api/stats", tags=["stats"])
app.include_router(webhooks.router, prefix="/api/webhooks", tags=["webhooks"])


@app.get("/api/health")
async def health():
    import redis.asyncio as aioredis
    redis_ok = False
    try:
        r = aioredis.from_url(settings.redis_url, socket_connect_timeout=2)
        await r.ping()
        await r.aclose()
        redis_ok = True
    except Exception:
        pass

    from sqlmodel import Session, text
    db_ok = False
    try:
        with Session(engine) as s:
            s.exec(text("SELECT 1"))
        db_ok = True
    except Exception:
        pass

    status = "ok" if (redis_ok and db_ok) else "degraded"
    return {
        "status": status,
        "version": "0.1.0",
        "services": {"redis": redis_ok, "database": db_ok},
    }
