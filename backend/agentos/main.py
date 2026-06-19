import hashlib
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from .config import settings
from .database import create_db_and_tables, engine
from .api import agents, runs, schedules, stream, stats, webhooks, auth, knowledge_agents
from .api import api_keys, execute
from .api.auth import verify_token
from .models import ApiKey
from .worker.scheduler import start_scheduler, stop_scheduler
from .agents.builtin import seed_builtin_agents

# Paths accessible without any authentication
_PUBLIC_PATHS = {"/api/health", "/api/auth/login", "/api/webhooks/github"}

# Paths accessible with either cookie JWT or an API key
_API_KEY_ALLOWED_PREFIXES = ("/api/execute", "/api/runs")

_KEY_DEBOUNCE = timedelta(minutes=5)


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


def _verify_api_key_header(authorization: str) -> bool:
    raw_key = authorization[len("Bearer "):]
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    with Session(engine) as session:
        key = session.exec(
            select(ApiKey).where(ApiKey.key_hash == key_hash, ApiKey.enabled == True)
        ).first()
        if not key:
            return False
        now = datetime.utcnow()
        if key.last_used_at is None or now - key.last_used_at > _KEY_DEBOUNCE:
            key.last_used_at = now
            session.add(key)
            session.commit()
        return True


# Auth middleware is added first so CORS (added after) wraps it as outermost.
# Starlette applies middlewares last-in-first-out: the last add_middleware call
# becomes the outermost layer, ensuring CORS headers are present on every
# response including 401s.
@app.middleware("http")
async def auth_middleware(request: Request, call_next) -> Response:
    path = request.url.path
    if path in _PUBLIC_PATHS or path.startswith("/docs"):
        return await call_next(request)

    # Cookie JWT (browser UI)
    if verify_token(request.cookies.get("agentos_token")):
        return await call_next(request)

    # API key — only allowed on specific path prefixes
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer sk-agentos-"):
        if not any(path.startswith(prefix) for prefix in _API_KEY_ALLOWED_PREFIXES):
            return Response(
                content='{"detail":"Forbidden: API keys cannot access this endpoint"}',
                status_code=403,
                media_type="application/json",
            )
        if _verify_api_key_header(auth_header):
            return await call_next(request)

    return Response(
        content='{"detail":"Not authenticated"}',
        status_code=401,
        media_type="application/json",
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://frontend:3000"],
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
app.include_router(knowledge_agents.router, prefix="/api/knowledge-agents", tags=["knowledge-agents"])
app.include_router(api_keys.router, prefix="/api/api-keys", tags=["api-keys"])
app.include_router(execute.router, prefix="/api/execute", tags=["execute"])


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

    from pathlib import Path
    credentials = Path.home() / ".claude" / ".credentials.json"
    claude_ok = credentials.exists() and credentials.stat().st_size > 0

    status = "ok" if (redis_ok and db_ok and claude_ok) else "degraded"
    return {
        "status": status,
        "version": "0.1.0",
        "services": {"redis": redis_ok, "database": db_ok, "claude": claude_ok},
    }
