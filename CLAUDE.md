@AGENTS.md

# AgentOS

Plataforma personal self-hosted para orquestar agentes de Claude. FastAPI + ARQ + Redis + SQLite + Next.js 16.

## Stack y versiones críticas

| Capa | Tecnología | Notas |
|------|-----------|-------|
| Backend | Python 3.12 + FastAPI | Async nativo, type hints en todo |
| Task queue | ARQ (async Redis Queue) | Worker separado, mismo Dockerfile que backend |
| Message broker | Redis 7 | ARQ + pub/sub de logs SSE |
| Scheduler | APScheduler 4.x | Integrado en el proceso backend |
| Base de datos | SQLite + SQLModel | `/data/agentos.db` en volumen Docker |
| Frontend | Next.js 16 + TypeScript | App Router, RSC, Tailwind + shadcn/ui |
| Real-time | SSE (Server-Sent Events) | Logs en tiempo real desde worker vía Redis |
| Reverse proxy | Caddy 2 | HTTPS automático, Tailscale-ready |
| Pkg manager Python | `uv` | Más rápido que pip, lockfile (`uv.lock`) |

## Estructura del repositorio

```
agentos/
├── docker-compose.yml          # Producción
├── docker-compose.dev.yml      # Desarrollo local
├── .env.example
├── caddy/Caddyfile
├── agents_config/              # Configs YAML de agentes custom
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml          # uv project
│   └── agentos/
│       ├── main.py             # FastAPI app entry
│       ├── database.py         # SQLite + SQLModel engine
│       ├── models.py           # DB models
│       ├── config.py           # Settings desde .env (pydantic-settings)
│       ├── api/                # Routers FastAPI
│       │   ├── agents.py
│       │   ├── runs.py
│       │   ├── schedules.py
│       │   ├── stream.py       # SSE endpoint
│       │   ├── webhooks.py     # GitHub webhook
│       │   └── stats.py
│       ├── worker/
│       │   ├── tasks.py        # ARQ tasks
│       │   └── scheduler.py    # APScheduler setup
│       ├── runner/
│       │   ├── base.py         # Clase base AgentRunner
│       │   └── anthropic.py    # Runner vía API Anthropic (streaming)
│       ├── tools/              # Tool registry
│       │   ├── __init__.py     # TOOL_REGISTRY dict
│       │   ├── filesystem.py
│       │   ├── github.py
│       │   └── notifications.py
│       └── agents/             # Agentes built-in
│           ├── code_review.py
│           ├── vuln_scan.py
│           ├── portfolio_updater.py
│           └── custom.py
└── frontend/
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── app/
        │   ├── layout.tsx
        │   ├── page.tsx             # Dashboard
        │   ├── runs/[id]/page.tsx   # Run detail con SSE logs
        │   ├── agents/page.tsx
        │   └── schedules/page.tsx
        └── components/
            ├── RunCard.tsx
            ├── LogStream.tsx        # SSE consumer
            ├── AgentForm.tsx
            └── ScheduleBuilder.tsx
```

## Comandos de desarrollo

```bash
# Levantar servicios (dev)
docker compose -f docker-compose.dev.yml up -d

# Backend standalone (con uv)
cd backend
uv run uvicorn agentos.main:app --reload --port 8000

# Worker standalone
cd backend
uv run python -m arq agentos.worker.tasks.WorkerSettings

# Frontend
cd frontend
npm run dev    # http://localhost:3000

# Tests backend
cd backend
uv run pytest

# TypeScript check frontend
cd frontend
npx tsc --noEmit
```

## Variables de entorno requeridas

Ver `.env.example`. Las críticas:
- `ANTHROPIC_API_KEY` — API de Anthropic
- `GITHUB_TOKEN` — Token con permisos `repo` + PR comments
- `SECRET_KEY` — Para JWT (`openssl rand -hex 32`)
- `ADMIN_PASSWORD` — Password del panel web
- `NTFY_URL` — Para notificaciones push (ej: `https://ntfy.sh/mi-topic-secreto`)

## Workflow de desarrollo

1. Crear issue en GitHub con label apropiado
2. Rama: `feat/<nombre>-issue-<número>` o `fix/<nombre>-issue-<número>`
3. Implementar con type hints completos
4. `cd backend && uv run pytest` — pasar tests
5. `cd frontend && npx tsc --noEmit` — verificar tipos
6. Commit: `feat(scope): descripción (#número)`
7. PR referenciando el issue

## Arquitectura de agentes

Cada agente built-in es una `AgentDefinition` con:
- `system_prompt`: instrucciones del agente
- `tools`: lista de tools del TOOL_REGISTRY que puede usar
- `model`: modelo de Claude a usar

El `AnthropicRunner` ejecuta el loop agéntico (streaming), publica cada evento en Redis
(`run:{id}:logs`), y el endpoint SSE hace subscribe a ese canal para streamear al frontend.

## Seguridad

- Docker socket mount (`/var/run/docker.sock`) solo para `vuln_scan` — uso personal, repos propios
- Auth: JWT en cookie httpOnly, password hasheado con bcrypt en `.env`
- Tailscale recomendado para acceso remoto (ver docs/tailscale.md)
