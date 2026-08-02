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

**Última sesión activa:** 2026-08-02 — hardening final de `infra-architect` (#219): fix de vulnerabilidad de auto-tampering de `authorized_keys` (root:root 711/644). PR `#245` mergeada a `develop`. De paso, PR `#246` corrigió una vulnerabilidad no relacionada (brace-expansion en el `npm` vendorizado de ambos Dockerfiles, ver gotcha) que rompía el deploy de staging. `develop` verde: tests, tipos, auditorías y Trivy pasando en ambas imágenes.

**Sesión 2026-08-02 (continuación):** diseño y arranque de `phase:infra-map` — mapa visual de infraestructura derivado de `~/docu/homelab` (issues #248/#249/#250, diseño en `docs/infra-platform-design.md`). Implementado en esta sesión (rama `feat/infra-map-model-issue-248`): modelos `InfraNetwork`/`InfraNode`/`InfraService`/`InfraLink` + migración, `InfraMapRunner` (extracción vía agente CLI `claude`, sin SDK), endpoints `POST /api/infra-map/refresh` + `GET /api/infra-map`, mount read-only de `~/docu/homelab` en `docker-compose.dev.yml`. Pendiente: frontend (#249 dashboard, #250 topología) y promoción a `main`.

**Sesión 2026-08-02 (continuación 2):** frontend del mapa de infraestructura (#250, PR #252) — grafo de topología con React Flow + dagre, validado contra datos reales de `~/docu/homelab`. Tras feedback del usuario sobre legibilidad ("no hay quien lo entienda"), pulido visual (#253, PR #254): `colorMode="dark"` para controles visibles, tooltips nativos en vez de etiquetas de arista siempre visibles, aristas padre→hijo eliminadas (texto en la tarjeta en su lugar), curvas bezier + layout `LR`. Después, dado que un solo grafo seguía mezclando demasiadas relaciones distintas, se dividió en varias vistas temáticas (#255, PR #256): flujo de tráfico, red privada (Tailscale), firewall entre redes (nuevo componente `InfraNetworkFirewallGraph`, agrega excepciones a nivel de VLAN), "Todo" y "Tarjetas". `develop` verde tras cada merge (verificado por `databaseId` exacto, no `--limit 1`). Pendiente: promoción de todo `phase:infra-map` a `main`.

> **Gotcha detectado (ciclos en grafos dagre):** un layout jerárquico/en capas (dagre, Sugiyama) no puede dibujar un ciclo real de grafo sin que una arista aparezca como "back-edge" (curva larga hacia atrás) — es inherente al algoritmo, no un bug de layout. En el mapa de infraestructura esto se manifestó como una curva que parecía cruzar todo el diagrama entre un proxy inverso y el servicio DNS que reescribe dominios de vuelta hacia ese mismo proxy: relación real (A apunta a B, B apunta a A por un motivo distinto), no un error de extracción ni de dibujado. Si vuelve a aparecer una arista que "no tiene sentido" en un grafo dagre, comprobar primero si el dataset filtrado contiene un ciclo de 2+ nodos antes de tocar el layout.

> **Gotcha detectado (brace-expansion en npm vendorizado):** ambos `Dockerfile` instalan `npm@latest` globalmente (`npm install -g npm@latest`), y la propia CLI de npm trae vendorizado un `brace-expansion` que puede quedar en un rango vulnerable (CVE-2026-14257) sin que tenga nada que ver con las dependencias del proyecto — `npm audit`/overrides en `package.json` no lo tocan porque no es una dependencia de nuestro árbol, vive dentro de `usr/local/lib/node_modules/npm/node_modules/`. Como `deploy-staging.yml` solo corre en push a `develop` (no en cada PR) y `develop` llevaba 10 días sin push, el problema estuvo latente sin que ningún CI lo detectara hasta el primer push tras ese hueco. Fix: mismo patrón que el fix de `undici` ya existente en ambos Dockerfiles — instalar la versión parcheada aparte y copiarla sobre la vendorizada. Si Trivy vuelve a fallar por algo vendorizado en npm/node en el futuro, este es el sitio a mirar antes de tocar `frontend/package.json`.

> **Gotcha detectado:** un PR con `Closes #N` solo auto-cierra el issue si se mergea en la *default branch* del repo (`main`). Como el flujo real es `feat → develop → main` en dos PRs separados, el cierre automático nunca se dispara al mergear a `develop`, y si la promoción `develop → main` se hace con un merge commit sin closing keyword, el issue se queda abierto aunque el código ya esté en producción. Revisar periódicamente con `git log main` vs `gh issue list --state open`.

> **Gotcha detectado (Alembic vs. `create_db_and_tables()`):** `main.py` llama a `create_db_and_tables()` (`SQLModel.metadata.create_all(engine)`) en el `lifespan` de FastAPI en **todo** arranque del backend, incluido `uv run uvicorn --reload` en local sin Docker. `create_all()` solo crea tablas que no existen — nunca añade columnas nuevas a una tabla ya existente. En Docker esto no es un problema porque `entrypoint.sh` corre `alembic upgrade head` *antes* de arrancar el proceso, así que cuando `create_db_and_tables()` se ejecuta la tabla ya tiene las columnas nuevas (no-op). Pero si desarrollas con el backend nativo (`cd backend && uv run uvicorn agentos.main:app --reload`) contra un `agentos.db` local ya existente, y añades un campo a un modelo SQLModel con su migración Alembic correspondiente, el arranque **no falla y no avisa** — simplemente el esquema se queda desactualizado hasta que corras `uv run alembic upgrade head` a mano. Señal de alarma: `OperationalError: no such column` la primera vez que el código toca el campo nuevo.

> **Gotcha detectado (mount de `alembic/` asimétrico en dev):** `docker-compose.dev.yml` monta `./backend/alembic:/app/alembic` en `backend` pero no lo montaba en `worker`. Como `entrypoint.sh` corre `alembic upgrade head` en el arranque de **ambos** contenedores (mismo Dockerfile, distinto `command`), un `worker` sin ese mount solo ve las migraciones que existían cuando se construyó su imagen. Añadir una migración nueva sin reconstruir la imagen del worker provoca `FAILED: Can't locate revision identified by '<rev>'` en su próximo restart — y como `entrypoint.sh` usa `set -e`, el contenedor no llega a arrancar (bucle de reinicio con `restart: unless-stopped`). Si en el futuro se toca este fichero, mantener los mounts de `backend` y `worker` en paralelo.

> **Gotcha detectado (UID de contenedor vs volumen persistente):** el `Dockerfile` de `backend` define `ARG UID=1001` como default propio, distinto del default `UID:-1000` de `docker-compose.dev.yml`. Si una imagen se construye sin que el build-arg de compose llegue a aplicarse (p.ej. un `docker build`/`compose build` suelto en un shell donde `UID` no estaba exportado), el usuario `worker` queda con UID 1001 y los ficheros que crea en el volumen `backend_data` (incluido `/data/agentos.db`) quedan con ese owner. Un rebuild posterior con UID 1000 no puede escribir en esos ficheros (`attempt to write a readonly database`), y además puede desincronizar `alembic_version` si `create_db_and_tables()` llegó a crear una tabla antes de que la migración correspondiente se aplicara — el síntoma es `table X already exists` en `alembic upgrade head` al arrancar. Fix no destructivo: `docker compose run --rm --user root --entrypoint sh backend -c "chown -R worker:worker /data"` para igualar ownership, y si la tabla física ya coincide con el esquema de una migración pendiente, `alembic stamp head` en vez de recrearla.

### Batch pendiente de promoción `develop → main`

`develop` tiene mergeado y sin promocionar a `main`: chat sobre runs (#209), agrupación de runs de knowledge chat (#210), orden de hijos por antigüedad (#211), separación `run_type`/`triggered_by` (#213), refactor KnowledgeBase/KnowledgeAgent (#221/#222), agentes de infraestructura (#219, PRs #245/#246). Existe PR abierta `#224` (`develop → main`) que promociona el refactor de KnowledgeBase; el resto del batch (#209–213, #219) no tiene aún PR de promoción abierta.

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
| phase:infra-map | #248–#250 | Mapa visual de infraestructura: agente extrae `InfraNode`/`InfraNetwork`/`InfraService`/`InfraLink` desde `~/docu/homelab` (montado read-only) a tablas propias (#248), dashboard de inventario (#249) y diagrama de topología (#250). Solo lectura — sync bidireccional (#248 §fuera de alcance) y escaneo activo de red quedan para una fase posterior sin issue todavía. Diseño en `docs/infra-platform-design.md`. |

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

### Notas de arquitectura (#219 — agentes de infraestructura)

- Diseño completo y actualizado en `docs/infra-agents-design.md`. Implementación en `feat/infra-agents-issue-219`, PR `#245` hacia `develop`.
- `InfraTarget` (modelo + CRUD en `backend/agentos/api/infra_targets.py`) representa un host gestionable por SSH: metadata + host-key fingerprint (TOFU) + `ssh_public_key` (la privada nunca sale de `/data/infra_keys/{id}/`, volumen compartido backend/worker) + `sudo_commands` (subconjunto exacto con privilegio).
- Agente builtin `infra-architect` (`backend/agentos/agents/builtin.py`) es puramente advisory: tools `["Bash", "Read"]`, sin `Write`. Se registra únicamente si `INFRA_AGENTS_ENABLED=true` (default `false`).
- Modelo de seguridad final (tras varias iteraciones, ver `docs/infra-agents-design.md`): el usuario SSH dedicado corre en scope normal de Unix, no hay allowlist de comandos a nivel SSH. Un wrapper de forced-command (`agentos-audit-wrapper.sh`, instalado vía `command=` + `restrict` en `authorized_keys`) audita cada comando por `logger` y bloquea un denylist best-effort de patrones catastróficos (fail-open, no allowlist). `sudo_commands` es la única vía con privilegio real, vía `Cmnd_Alias` de sudoers con match exacto. `~/.ssh` y `authorized_keys` del usuario destino son `root:root` (711/644) para que el propio usuario no pueda sobreescribir sus restricciones.
- `GET /api/infra-targets/{id}/setup-commands` genera en vivo el bash exacto para provisionar el host (usuario, sudoers, wrapper, authorized_keys) — el provisioning del lado del host queda siempre manual.
- Target de dev: servicio `infra-dev-target` en `docker-compose.dev.yml` (`linuxserver/openssh-server`, sshd corre como el propio usuario `agentos`, no como root — no representativo de un host real para probar el fix de permisos). Sincronizado con `scripts/infra-dev/sync-dev-target-key.sh`.
- Explícitamente fuera de esta fase: cualquier conexión a infraestructura real (`~/docu/homelab`) o capacidad de despliegue/escritura — eso requiere una decisión explícita posterior (ver roadmap `phase:projects` / `phase:multi-tenant`) y un agente "deployer" separado con aprobación humana.

### Notas de arquitectura (#248 — mapa visual de infraestructura)

- Diseño completo en `docs/infra-platform-design.md`. Implementación en `feat/infra-map-model-issue-248`.
- Cuatro tablas nuevas y deliberadamente pequeñas: `InfraNetwork` (VLANs), `InfraNode` (hosts/VMs/LXCs/dispositivos), `InfraService`, `InfraLink` (enlaces, para el futuro diagrama de topología #250). Sin relación de esquema con `InfraTarget` (#219) — son descriptivas, derivadas de documentación, sin credenciales ni capacidad de acción.
- `InfraMapRunner` (`backend/agentos/runner/infra_map.py`, patrón análogo a `KnowledgeRunner`): agente vía CLI `claude` con `cwd` en `settings.infra_map_work_path` (escribible), lee `settings.infra_map_docs_path` (montado `:ro`) con Read/Glob/Grep y escribe `extraction.json`. El backend valida el JSON (pydantic) y reemplaza el contenido completo de las 4 tablas en una transacción — sin diff ni caché incremental, porque son una cache derivada del markdown, no la fuente de verdad.
- `POST /api/infra-map/refresh` (agent_id sentinel `__infra_map__`, encolado en ARQ igual que el modo async de `/api/execute`) y `GET /api/infra-map`. `settings.infra_map_docs_path` vacío (default) = feature inactiva, `refresh` devuelve 400 en vez de fallar en silencio.
- Mount `${HOME}/docu/homelab:/data/homelab-docs:ro` en `docker-compose.dev.yml` (solo `worker`, que es donde corre el ARQ job). `~/docu/homelab` **no es un repo git** — por eso esta fase es explícitamente solo lectura, sin ninguna escritura de vuelta hacia esos ficheros.
- Sin frontend todavía: `/api/infra-map` ya es consumible, pero el dashboard (#249) y el diagrama de topología (#250) son issues separadas sin implementar.
