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
│       │   ├── knowledge_agents.py  # KnowledgeAgent CRUD + query
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
│       │   ├── claude_code.py  # Runner principal vía CLI claude (Claude Pro)
│       │   └── knowledge.py    # KnowledgeRunner — wraps ClaudeCodeRunner con knowledge_doc
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
- `ANTHROPIC_API_KEY` — Necesaria para autenticar el CLI `claude` (no la usa el backend directamente)
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
10. Merge a `main` → CI publica automáticamente las imágenes en ghcr.io (`:latest`)

> **CI activo:** Cada PR ejecuta tests + `uv run pip-audit` + `npm audit`. Push a `develop` → imágenes `:staging`. Push a `main` → imágenes `:latest`. Trivy escanea HIGH/CRITICAL con fix antes de publicar. Dependabot abre PRs semanales (npm, docker, github-actions).
>
> **Nota para agentes:** Al crear PRs usar siempre `--base develop` con `gh pr create`. Sin `--base` gh usa la rama por defecto del repo (main) saltándose el flow `feat → develop → main`.

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

**Última sesión activa:** 2026-06-14 — logs en tiempo real en knowledge agents (issue #99, PR #100)

### PRs abiertas (pendientes de merge en develop)

Ninguna (todo mergeado a develop).

### Issues ya implementados (código existe, cerrar cuando se valide en producción)

- #14 APScheduler, #15 CRUD schedules, #16 Frontend schedules, #17 webhook GitHub — en producción
- #19 ntfy notifications, #24 health indicator dashboard, #25 log retention, #26 redirect 401 — en producción
- #18 stats tokens/coste (#57 mergeado), #21 filtros y paginación (#58), #23 tests YAML loader (#59) — en develop
- #30 KnowledgeAgent model + CRUD (#60), #31 KnowledgeRunner (#61), #32 Knowledge UI (#62) — en develop
- #99 Logs en tiempo real en el chat de knowledge agents (#100) — en develop

### Fases pendientes del roadmap

| Fase | Issues | Descripción |
|------|--------|-------------|
| phase:polish | #20 | Caddy + Tailscale para acceso seguro en producción |
| phase:knowledge-2 | #33, #34, #35, #36 | Knowledge Agent: system prompt auto-generado, automatizaciones |
| phase:multimodel | #37–#45 | ⚠️ PENDIENTE REDEFINICIÓN — issues originales asumían runners OpenAI/Gemini (incompatible con restricción Claude Pro). Reencuadrar como multi-modelo dentro de Claude: sonnet/haiku/opus vía flag `--model` |
| phase:scrum-master | pendiente | Agente scrum master: propaga cambios de workflow/CLAUDE.md a todos los repos de dev + scaffolding de proyectos nuevos |
| phase:arquitecto | pendiente | Agente arquitecto: ingiere ~/docu/homelab como base de conocimiento, asesora y ejecuta despliegues (software de terceros y proyectos propios como tripplanner) |
| phase:multi-tenant | pendiente | Multi-usuario: tabla de usuarios, API keys cifradas por usuario (Anthropic/GitHub), runner usa key del usuario en lugar de la global. Anthropic no tiene OAuth — el usuario pega su `sk-ant-...` en Settings. |

### Notas de arquitectura (phase:knowledge-1)

- `KnowledgeRunner` envuelve `ClaudeCodeRunner` (CLI claude, Claude Pro — sin coste extra de API). Crea un `AgentDefinition` proxy en memoria con el `knowledge_doc` inyectado en el system prompt. Para actualizaciones del doc, el agente escribe el fichero completo en `/tmp/knowledge_update_{run_id}.md` vía herramienta `Write`; el runner lo lee al terminar, persiste en SQLite y lo borra.
- Runs de knowledge agents tienen `agent_id = "knowledge:{id}"` — SQLite no fuerza FK por defecto, así que funciona sin cambiar el modelo `Run`.
- `api.knowledgeAgents` en `frontend/lib/api.ts` cubre todo el CRUD + export/import + query.

### Notas de arquitectura (SSE / logs en tiempo real)

- El endpoint `GET /api/runs/{run_id}/stream` subscribe a Redis PRIMERO y luego comprueba el estado del run (no al revés). Esto evita una race condition donde agentes rápidos terminan entre el check y el subscribe, perdiendo todos los eventos.
- El evento `done` de Redis se publica dentro de `ClaudeCodeRunner._handle_event`, antes de que el worker escriba `status=success` en la DB. El frontend espera a que el run alcance estado terminal (polling 300 ms) antes de mostrar la respuesta.
- `EventSource` requiere `withCredentials: true` para enviar la cookie `agentos_token` en requests cross-origin (frontend :3000 → backend :8000). La cookie tiene `SameSite=Strict`.
- `LogStream.tsx` acepta `showInfo?: boolean` para incluir opcionalmente los eventos `info` (texto intermedio del agente). El chat de knowledge agents los muestra; la página `/runs/[id]` no.
