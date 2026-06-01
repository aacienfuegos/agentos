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

## Restricción de coste — solo Claude Pro, nunca SDK de pago

**Todos los agentes ejecutan mediante el CLI `claude`**, no mediante el SDK `anthropic` ni ningún otro SDK de LLM (OpenAI, Gemini, etc.). La razón es económica y de diseño: el proyecto corre sobre un plan Claude Pro mensual fijo; cualquier llamada directa a la API incurre en coste adicional por tokens.

Implicaciones concretas:
- El backend **nunca** importa `anthropic`, `openai`, `google-generativeai` ni equivalentes para ejecutar modelos
- Toda ejecución de agentes va por `ClaudeCodeRunner` (o runners que lo compongan, como `KnowledgeRunner`)
- Cuando una feature necesita intercambiar datos con el agente en tiempo de ejecución (ej: actualizar un documento), se hace mediante las herramientas nativas del CLI (`Write`, `Read`, `Bash`) y ficheros temporales, no mediante tool use del SDK
- Antes de añadir cualquier dependencia de SDK de LLM a `pyproject.toml`, confirmar explícitamente con el propietario del proyecto

## Workflow
1. Crear rama `feat/<nombre>-issue-<número>` o `fix/<nombre>-issue-<número>`
2. Implementar con type hints
3. `cd backend && uv run pytest` — tests
4. `cd frontend && npx tsc --noEmit` — tipos
5. Commit: `feat(scope): descripción (#número)`
6. PR referenciando el issue
<!-- END:agentos-agent-rules -->
