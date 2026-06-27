---
name: python-testing
description: Testing en AgentOS — pytest, fixtures de DB, estrategia y comandos
metadata:
  type: skill
---

# Python Testing (AgentOS)

## Comandos

```bash
uv run pytest                           # todos los tests
uv run pytest tests/test_agents.py     # archivo específico
uv run pytest -k "test_create"         # tests que matchean el nombre
uv run pytest -v --tb=short            # verbose con traceback corto
uv run pytest --cov=app --cov-report=term-missing  # cobertura
```

## Estructura de tests

```
tests/
├── conftest.py          # fixtures globales (db, client, auth)
├── test_agents.py
├── test_tasks.py
└── test_api/
    ├── test_agents.py
    └── test_runs.py
```

## Fixtures de DB

```python
# tests/conftest.py
import pytest
from sqlmodel import SQLModel, create_engine, Session
from app.database import get_session
from app.main import app

@pytest.fixture(scope="session")
def engine():
    # DB en memoria para tests — aislada, no persiste entre sesiones
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    return engine

@pytest.fixture
def session(engine):
    with Session(engine) as session:
        yield session
        session.rollback()

@pytest.fixture
def client(session):
    def get_session_override():
        return session

    app.dependency_overrides[get_session] = get_session_override
    from fastapi.testclient import TestClient
    return TestClient(app)
```

## Test de endpoints

```python
def test_create_agent(client):
    response = client.post("/api/agents", json={"name": "test", "config": "{}"})
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "test"
    assert "id" in data
```

## No mockear

Preferir tests de integración con DB real (SQLite en memoria) sobre mocks.
Los mocks de DB pueden pasar aunque la migración falle en producción.
