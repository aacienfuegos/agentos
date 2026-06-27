---
name: api-design
description: Convenciones REST para AgentOS — naming, status codes, paginación, errores, versioning. Referencia al diseñar o revisar endpoints de la API.
metadata:
  type: skill
---

# API Design — AgentOS

## URL y recursos

```
# Recursos en plural, kebab-case, sin verbos
GET    /api/v1/agents
GET    /api/v1/agents/:id
POST   /api/v1/agents
PATCH  /api/v1/agents/:id
DELETE /api/v1/agents/:id

# Sub-recursos para relaciones
GET    /api/v1/agents/:id/runs
POST   /api/v1/agents/:id/runs

# Acciones que no son CRUD (verbos permitidos aquí)
POST   /api/v1/agents/:id/stop
POST   /api/v1/agents/:id/restart
```

## Status codes

```
200 OK              — GET, PATCH con body
201 Created         — POST (incluir Location header)
204 No Content      — DELETE, PATCH sin body
400 Bad Request     — JSON inválido, parámetro requerido faltante
401 Unauthorized    — Sin token o token inválido
403 Forbidden       — Autenticado pero sin permisos
404 Not Found       — Recurso no existe
409 Conflict        — Duplicado, estado incompatible
422 Unprocessable   — JSON válido pero semánticamente inválido (validación Pydantic)
429 Too Many        — Rate limit excedido
500 Internal Error  — Nunca exponer detalles internos
```

## Response format

```python
# Éxito — recurso único
{"data": {"id": 1, "name": "agent-1", ...}}

# Éxito — colección con paginación
{
  "data": [...],
  "meta": {"total": 42, "page": 1, "per_page": 20, "total_pages": 3}
}

# Error — siempre con code y message
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [{"field": "name", "message": "Field required"}]
  }
}
```

## Paginación

Para AgentOS (datasets pequeños): offset-based es suficiente.

```
GET /api/v1/agents/runs?page=2&per_page=20
```

Implementación FastAPI:
```python
@router.get("/agents/{agent_id}/runs")
async def list_runs(
    agent_id: int,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, le=100),
    session: Session = Depends(get_session),
):
    offset = (page - 1) * per_page
    total = session.exec(select(func.count(Run.id)).where(Run.agent_id == agent_id)).one()
    runs = session.exec(
        select(Run).where(Run.agent_id == agent_id).offset(offset).limit(per_page)
    ).all()
    return {
        "data": runs,
        "meta": {"total": total, "page": page, "per_page": per_page, "total_pages": ceil(total / per_page)}
    }
```

## Errores — no exponer internos

```python
# BAD — expone stack trace o query SQL al cliente
raise HTTPException(status_code=500, detail=str(e))

# GOOD — log interno, mensaje genérico al cliente
logger.error("DB error in list_runs", exc_info=True)
raise HTTPException(status_code=500, detail="Internal server error")
```

## Checklist antes de añadir un endpoint

- [ ] URL sigue naming conventions (plural, sin verbos)
- [ ] Status code correcto (no 200 para todo)
- [ ] Input validado con Pydantic (FastAPI lo hace automáticamente con response_model)
- [ ] Auth verificada (Depends(get_current_user))
- [ ] Paginación en list endpoints
- [ ] Errores no exponen detalles internos
- [ ] Response model definido en el decorator (para OpenAPI)
