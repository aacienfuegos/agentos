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

# Auditoría de seguridad Python (igual que CI)
cd backend
uv run pip-audit

# TypeScript check frontend
cd frontend
npx tsc --noEmit

# Auditoría de seguridad npm (igual que CI — ejecutar antes de pushear)
cd frontend
npm audit --audit-level=moderate
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
5. `cd backend && uv run pip-audit` — sin vulnerabilidades Python
6. `cd frontend && npx tsc --noEmit` — verificar tipos sin excepción
7. `cd frontend && npm audit --audit-level=moderate` — sin vulnerabilidades npm
8. Probar visualmente en `http://localhost:3000`
9. Commit con prefijo convencional: `feat(scope): descripción (#número)`
10. PR hacia `develop` con `Closes #N` en el body
11. Revisar en local con los servicios dev (`docker compose -f docker-compose.dev.yml up -d`). Si está bien, PR de `develop → main`
12. Merge a `main` → CI publica automáticamente las imágenes en ghcr.io (`:latest`)

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

**Última sesión activa:** 2026-07-28 — TOFU host-key pinning para `infra-architect` (#219), rama `feat/infra-agents-issue-219` sin PR abierta todavía (pendiente de más validación antes de mandarla a `develop`).

> **Gotcha detectado:** un PR con `Closes #N` solo auto-cierra el issue si se mergea en la *default branch* del repo (`main`). Como el flujo real es `feat → develop → main` en dos PRs separados, el cierre automático nunca se dispara al mergear a `develop`, y si la promoción `develop → main` se hace con un merge commit sin closing keyword, el issue se queda abierto aunque el código ya esté en producción. Revisar periódicamente con `git log main` vs `gh issue list --state open`.

> **Gotcha detectado (Alembic vs. `create_db_and_tables()`):** `main.py` llama a `create_db_and_tables()` (`SQLModel.metadata.create_all(engine)`) en el `lifespan` de FastAPI en **todo** arranque del backend, incluido `uv run uvicorn --reload` en local sin Docker. `create_all()` solo crea tablas que no existen — nunca añade columnas nuevas a una tabla ya existente. En Docker esto no es un problema porque `entrypoint.sh` corre `alembic upgrade head` *antes* de arrancar el proceso, así que cuando `create_db_and_tables()` se ejecuta la tabla ya tiene las columnas nuevas (no-op). Pero si desarrollas con el backend nativo (`cd backend && uv run uvicorn agentos.main:app --reload`) contra un `agentos.db` local ya existente, y añades un campo a un modelo SQLModel con su migración Alembic correspondiente, el arranque **no falla y no avisa** — simplemente el esquema se queda desactualizado hasta que corras `uv run alembic upgrade head` a mano. Señal de alarma: `OperationalError: no such column` la primera vez que el código toca el campo nuevo.

> **Gotcha detectado (mount de `alembic/` asimétrico en dev):** `docker-compose.dev.yml` monta `./backend/alembic:/app/alembic` en `backend` pero no lo montaba en `worker` (corregido en la rama `feat/infra-agents-issue-219`, commit de esta sesión). Como `entrypoint.sh` corre `alembic upgrade head` en el arranque de **ambos** contenedores (mismo Dockerfile, distinto `command`), un `worker` sin ese mount solo ve las migraciones que existían cuando se construyó su imagen. Añadir una migración nueva sin reconstruir la imagen del worker provoca `FAILED: Can't locate revision identified by '<rev>'` en su próximo restart — y como `entrypoint.sh` usa `set -e`, el contenedor no llega a arrancar (bucle de reinicio con `restart: unless-stopped`). Si en el futuro se toca este fichero, mantener los mounts de `backend` y `worker` en paralelo.

### Batch pendiente de promoción `develop → main`

`develop` tiene mergeado y sin promocionar a `main`: chat sobre runs (#209), agrupación de runs de knowledge chat (#210), orden de hijos por antigüedad (#211), separación `run_type`/`triggered_by` (#213), refactor KnowledgeBase/KnowledgeAgent (#221/#222). Existe PR abierta `#224` (`develop → main`) que promociona el refactor de KnowledgeBase; el resto del batch (#209–213) no tiene aún PR de promoción abierta.

### Issues ya implementados

Cerrados y en producción (main): phase:core, phase:scheduler, phase:knowledge-1, phase:external-api (#117–#120), harness CRUD + AI generation (#190), agentes CRUD + tool selector (#191/#192), polish de LogStream + quitar coste (#66, #160–165, #193), colapso de carpetas en explorador Knowledge Agent (#195/#196), botones expandir/colapsar todo (#198), BM25 full-text search (#199), migraciones Alembic + entrypoint automático (#204, #205, #207). #191, #195, #66 y #160–165 se cerraron manualmente el 2026-07-24 tras confirmar que el código ya estaba en `main` (ver gotcha arriba). phase:polish parcialmente: #20 (Caddy + Tailscale) sigue abierto.

En `develop`, pendiente de promoción a `main` (ver batch arriba): chat sobre runs (#206/#209), agrupación de runs de knowledge chat (#210), orden de hijos por antigüedad (#211), run_type/triggered_by (#213), refactor KnowledgeBase (#221/#222, PR #224 abierta).

Verificado como **no implementado todavía** pese a mencionarse junto a features similares: #166 (botón cancelar run) y #197 (buscador/filtro en explorador de ficheros) — backlog válido, no cerrar.

### Fases pendientes del roadmap

| Fase | Issues | Descripción |
|------|--------|-------------|
| phase:polish | #20 | Caddy + Tailscale para acceso seguro en producción |
| phase:knowledge-2 | #33, #34, #36, #223 | Knowledge Agent: system prompt auto-generado, automatizaciones, preview del system prompt |
| phase:multimodel | #37–#45 | ⚠️ NEEDS-ANALYSIS — issues originales asumían runners OpenAI/Gemini (incompatible con restricción Claude Pro). Pendiente de redefinición: multi-modelo dentro de Claude (sonnet/haiku/opus vía `--model`) u otro enfoque. |
| phase:usage-limits | #214–#217 | Visión y gestión de límites de uso Claude Pro: origen de % sesión (5h) y semanal (#214, spike), persistencia por run (#215), gauges en frontend + % contexto por conversación (#216), pausa de cola y auto-reanudación al resetear el límite (#217) |
| phase:projects | #218–#220 | "Proyectos": chat y ejecución de agentes sobre repos de desarrollo, extensión de KnowledgeAgent (#218). #219 formaliza como needs-analysis independiente el diseño de agentes de infraestructura multi-repo (scrum-master/arquitecto/deployer) que antes vivía como placeholder en este roadmap. #220 es la duda sobre slash commands explícitos en el chat, capturada desde `NOTES.md`. |
| phase:multi-tenant | pendiente | Multi-usuario: tabla de usuarios, API keys cifradas por usuario (Anthropic/GitHub), runner usa key del usuario en lugar de la global. Anthropic no tiene OAuth — el usuario pega su `sk-ant-...` en Settings. |

### Notas de arquitectura (phase:knowledge-1)

- `KnowledgeRunner` envuelve `ClaudeCodeRunner` (CLI claude, Claude Pro — sin coste extra de API). Crea un `AgentDefinition` proxy en memoria con el `_build_system_prompt(ka)` inyectado (árbol de directorio). El agente trabaja directamente sobre su carpeta con herramientas nativas (Read, Write, Edit, Grep, LS).
- El directorio de conocimiento es `ka.knowledge_path` (default: `/data/knowledge/{id}`). Se puede sobreescribir para apuntar a cualquier path accesible desde el contenedor.
- Runs de knowledge agents tienen `agent_id = "knowledge:{id}"` — SQLite no fuerza FK por defecto, así que funciona sin cambiar el modelo `Run`.
- `tokens_input` en `Run` almacena solo `input_tokens` reales (no cacheados). `tokens_cache_read` y `tokens_cache_write` se guardan por separado para diagnóstico.
- `api.knowledgeAgents` en `frontend/lib/api.ts` cubre todo el CRUD + upload (files/folders/zips) + query.

### Notas de arquitectura (phase:external-api)

- `POST /api/execute` acepta cualquier prompt y lo ejecuta con `ClaudeCodeRunner`. Modo síncrono (runner directo en backend) y asíncrono (ARQ worker). Runs con `agent_id="__execute__"` y `triggered_by="api"`.
- Auth vía `Authorization: Bearer sk-agentos-...`. Las API keys solo tienen acceso a `/api/execute` y `/api/runs/*` — el resto devuelve 403.
- El nombre de la API key se guarda en `input_params["api_key_name"]` para identificar qué app originó el run. El frontend muestra `api: <nombre>` en lugar del sentinel `__execute__`.
- En dev, `~/.claude` y `~/.claude.json` se montan en ambos contenedores (backend y worker) para que el CLI esté autenticado. En producción se usa el named volume `claude_config` (montado en `/home/worker/.claude`): `docker compose exec worker claude /login` una sola vez tras el primer deploy.
- Guía de integración completa en `docs/external-api.md`.

### Notas de arquitectura (SSE / logs en tiempo real)

- El endpoint `GET /api/runs/{run_id}/stream` subscribe a Redis PRIMERO y luego comprueba el estado del run (no al revés). Esto evita una race condition donde agentes rápidos terminan entre el check y el subscribe, perdiendo todos los eventos.
- El evento `done` de Redis se publica dentro de `ClaudeCodeRunner._handle_event`, antes de que el worker escriba `status=success` en la DB. El frontend espera a que el run alcance estado terminal (polling 300 ms) antes de mostrar la respuesta.
- `EventSource` requiere `withCredentials: true` para enviar la cookie `agentos_token` en requests cross-origin (frontend :3000 → backend :8000). La cookie tiene `SameSite=Strict`.
- `LogStream.tsx` acepta `showInfo?: boolean` para incluir opcionalmente los eventos `info` (texto intermedio del agente). El chat de knowledge agents los muestra; la página `/runs/[id]` no.
