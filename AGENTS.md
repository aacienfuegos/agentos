<!-- BEGIN:agentos-agent-rules -->
# AgentOS — Reglas para agentes de IA

## Stack
- Backend: Python 3.12 + FastAPI + ARQ + SQLModel + Redis
- Frontend: Next.js 16 + TypeScript + Tailwind + shadcn/ui
- Package manager Python: `uv` (nunca pip directamente)
- DB: SQLite en /data/agentos.db

## Reglas críticas
- Type hints en **todo** el código Python, incluyendo endpoints FastAPI
- Los modelos SQLModel usan `sa_column=Column(JSON)` para campos dict/list
- El worker y el backend comparten el mismo Dockerfile, diferente `command`
- Los logs SSE son **JSON** (nunca texto plano)
- El frontend NO llama a la API de Anthropic directamente

## Workflow
1. Crear rama `feat/<nombre>-issue-<número>` o `fix/<nombre>-issue-<número>`
2. Implementar con type hints
3. `cd backend && uv run pytest` — tests
4. `cd frontend && npx tsc --noEmit` — tipos
5. Commit: `feat(scope): descripción (#número)`
6. PR referenciando el issue
<!-- END:agentos-agent-rules -->
