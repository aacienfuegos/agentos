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

### Estrategia de ramas

```
feat/nombre-N  ──PR──►  develop  ──PR──►  main
                              │                  │
                         integración          producción
                       (validación local)   (deploy manual)
```

- `develop` es la rama de integración: recibe features, permite validar el conjunto antes de pasar a producción.
- `main` es la rama de producción: solo recibe merges desde `develop` cuando todo está validado.
- **Nunca trabajar directo en `develop` ni en `main`**, aunque el cambio sea de docs, config o una línea. Siempre rama → PR a `develop` → PR a `main`.

### Pasos para cada feature

1. Crear issue en GitHub con label apropiado (`feature`/`bug`, categoría)
2. Crear rama desde `develop`: `feat/<nombre>-issue-<número>` o `fix/<nombre>-issue-<número>`
3. Implementar con type hints completos
4. `cd backend && uv run pytest` — pasar todos los tests sin excepción
5. `cd frontend && npx tsc --noEmit` — verificar tipos sin excepción
6. Probar visualmente en `http://localhost:3000`
7. Commit con prefijo convencional: `feat(scope): descripción (#número)`
8. PR hacia `develop` con `Closes #N` en el body
9. Revisar en local con los servicios dev (`docker compose -f docker-compose.dev.yml up -d`). Si está bien, PR de `develop → main`
10. Merge a `main` → deploy manual en producción

> **Pendiente (backlog):** Configurar GitHub Actions para CI automático (tests + type check en cada PR) y publicación de imagen Docker en ghcr.io al hacer push a `develop` y `main`.

## Arquitectura de agentes

Cada agente built-in es una `AgentDefinition` con:
- `system_prompt`: instrucciones del agente
- `tools`: lista de tools del TOOL_REGISTRY que puede usar
- `model`: modelo de Claude a usar

El `ClaudeCodeRunner` ejecuta el loop agéntico lanzando el CLI `claude` como subproceso con
`--output-format stream-json --verbose`, publica cada evento en Redis (`run:{id}:logs`),
y el endpoint SSE hace subscribe a ese canal para streamear al frontend.
Los eventos `info` (texto del asistente), `tool_use`, `tool_result` y `error` se persisten
en `log_entries`. Tokens y coste se extraen del evento `result` final.

## Seguridad

- Docker socket mount (`/var/run/docker.sock`) solo para `vuln_scan` — uso personal, repos propios
- Auth: JWT en cookie httpOnly, password hasheado con bcrypt en `.env`
- Tailscale recomendado para acceso remoto (ver docs/tailscale.md)

## Estado actual del desarrollo

**Última rama activa:** `feat/polish-logs-copy-timezone-issue-52` — mergeada a main (2026-05-28)

### PRs abiertas (pendientes de merge en develop)

Ninguna.

### Fases pendientes del roadmap

| Fase | Issues | Descripción |
|------|--------|-------------|
| phase:polish | #18, #19, #20, #21, #26 | Stats de uso, ntfy, Caddy+Tailscale, export markdown, redirect 401 |
| phase:knowledge-1 | #30, #31, #32 | KnowledgeAgent: modelo DB, runner con contexto destilado, UI |
| phase:knowledge-2 | #33, #34, #35, #36 | Knowledge Agent: system prompt auto-generado, automatizaciones |
| phase:multimodel-1 | #37–#42 | Runners OpenAI/Gemini, config multi-modelo, credenciales por proveedor |
| phase:multimodel-2 | #43, #44, #45 | Consultas cruzadas entre modelos, modo paralelo, UI comparativa |
| phase:scrum-master | pendiente | Agente scrum master: propaga cambios de workflow/CLAUDE.md a todos los repos de dev + scaffolding de proyectos nuevos |
| phase:arquitecto | pendiente | Agente arquitecto: ingiere ~/docu/homelab como base de conocimiento, asesora y ejecuta despliegues (software de terceros y proyectos propios como tripplanner) |
| phase:multi-tenant | pendiente | Multi-usuario: tabla de usuarios, API keys cifradas por usuario (Anthropic/GitHub), runner usa key del usuario en lugar de la global. Anthropic no tiene OAuth — el usuario pega su `sk-ant-...` en Settings. |
