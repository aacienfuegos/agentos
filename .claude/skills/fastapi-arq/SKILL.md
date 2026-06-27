---
name: fastapi-arq
description: FastAPI + ARQ (Redis queue) — patrones de endpoints, tareas async, dependency injection
metadata:
  type: skill
---

# FastAPI + ARQ

## Endpoints FastAPI

```python
# CORRECTO — async, Depends para inyección
from fastapi import APIRouter, Depends, HTTPException
from app.deps import get_db, get_current_user

router = APIRouter()

@router.get("/items/{item_id}")
async def get_item(
    item_id: int,
    db = Depends(get_db),
    user = Depends(get_current_user),
):
    item = await db.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return item
```

## Tareas ARQ

```python
# app/tasks/my_task.py
async def my_task(ctx, param: str) -> dict:
    """Tarea ARQ — siempre async, siempre recibe ctx como primer argumento."""
    result = await do_work(param)
    return {"result": result}

# Encolar desde un endpoint
from arq import create_pool
from app.config import settings

@router.post("/trigger")
async def trigger(data: MySchema):
    pool = await create_pool(settings.redis_url)
    await pool.enqueue_job("my_task", data.param)
    return {"queued": True}
```

## Settings con pydantic-settings

```python
# app/config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    redis_url: str
    secret_key: str

    class Config:
        env_file = ".env"

settings = Settings()
```

## Comandos de desarrollo

```bash
# Instalar dependencias
uv sync

# Dev server
uv run uvicorn app.main:app --reload --port 8000

# Tests
uv run pytest

# Audit de dependencias
uv run pip-audit

# Type check
uv run mypy app/ --ignore-missing-imports

# Worker ARQ
uv run arq app.tasks.worker.WorkerSettings
```

## SQLite + SQLModel (AgentOS)

```python
# Modelos
from sqlmodel import SQLModel, Field
from typing import Optional

class Agent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    config: str  # JSON serializado

# Queries
from sqlmodel import select, Session

async def get_agent(session: Session, agent_id: int):
    return session.get(Agent, agent_id)
```

## No hacer

- No usar `print()` — usar `import logging; logger = logging.getLogger(__name__)`
- No mezclar sync/async en el mismo stack sin `run_in_executor`
- No acceder a la DB directamente desde los endpoints — siempre via `Depends(get_db)`
