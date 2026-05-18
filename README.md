# AgentOS

Plataforma personal self-hosted para orquestar agentes de Claude. Lanza tareas a la API de Anthropic desde una interfaz web, programa automatizaciones nocturnas y ve los resultados con logs en tiempo real.

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Python 3.12 + FastAPI + ARQ + Redis + SQLite |
| Frontend | Next.js 16 + TypeScript + Tailwind + shadcn/ui |
| Real-time | SSE (Server-Sent Events) via Redis pub/sub |
| Scheduler | APScheduler (cron integrado en el backend) |
| Reverse proxy | Caddy (HTTPS automático) |
| Acceso remoto | Tailscale (opcional) |

## Desarrollo local (recomendado)

```bash
# 1. Clonar y configurar
git clone https://github.com/aacienfuegos/agentos
cd agentos
cp .env.example .env
# Editar .env con ANTHROPIC_API_KEY, GITHUB_TOKEN, SECRET_KEY, ADMIN_PASSWORD

# 2. Arrancar todo con un comando
./dev.sh
```

Esto levanta en Docker: **Redis + Backend + Worker** (con hot reload de Python).
El **frontend** corre nativo con `npm run dev` — hot reload instantáneo sin rebuilds de Docker.

- Frontend: http://localhost:3000
- Backend API docs: http://localhost:8000/docs

## Configuración

Copia `.env.example` a `.env` y rellena:

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `ANTHROPIC_API_KEY` | API key de Anthropic | ✅ |
| `GITHUB_TOKEN` | Token con permisos `repo` | ✅ para agentes GitHub |
| `SECRET_KEY` | Secreto JWT (`openssl rand -hex 32`) | ✅ |
| `ADMIN_PASSWORD` | Password del panel web | ✅ |
| `NTFY_URL` | URL de ntfy para notificaciones push | Opcional |
| `GITHUB_WEBHOOK_SECRET` | Secreto HMAC para webhooks GitHub | Opcional |
| `MONTHLY_BUDGET_USD` | Presupuesto mensual en $ (default: 50) | Opcional |

## Producción con Tailscale

```bash
# En el servidor:
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# Añadir al .env:
TAILSCALE_IP=$(tailscale ip -4)

# Arrancar con Caddy:
docker compose up -d
# Accesible en https://{machine}.tail1234.ts.net
```

## Agentes built-in

| Agente | Descripción | Input params |
|--------|-------------|--------------|
| **code-review** | Revisa PRs de GitHub y publica comentarios | `repo`, `pr_number` (opcional), `focus` |
| **portfolio-updater** | Actualiza proyectos del portfolio desde repos públicos | `github_username`, `portfolio_repo`, `content_path` |
| **vuln-scan** | Escanea vulnerabilidades con semgrep/gitleaks | `repo`, `scan_type` |
| **custom** | Agente genérico para tareas ad-hoc | `user_message` |

## Webhook GitHub (code review automático)

Configura un webhook en tu repo de GitHub:
- URL: `https://tu-servidor/api/webhooks/github`
- Content type: `application/json`
- Secret: el valor de `GITHUB_WEBHOOK_SECRET`
- Events: `Pull requests`

El agente `code-review` se lanzará automáticamente cuando abras o actualices un PR.

## Producción

```bash
cp .env.example .env  # configurar variables
docker compose up -d
```

## Tests

```bash
cd backend
uv run pytest -v
```

## Estructura del proyecto

```
agentos/
├── docker-compose.yml          # Producción (con Caddy)
├── docker-compose.dev.yml      # Desarrollo (hot reload)
├── .env.example
├── caddy/Caddyfile
├── agents_config/              # Configs YAML de agentes custom
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   └── agentos/
│       ├── main.py             # FastAPI app
│       ├── models.py           # SQLModel models
│       ├── api/                # Routers REST
│       ├── worker/             # ARQ + APScheduler
│       ├── runner/             # AnthropicRunner (loop agéntico)
│       ├── tools/              # Tool registry
│       └── agents/             # Agentes built-in
└── frontend/
    ├── Dockerfile
    └── app/                    # Next.js App Router
        ├── page.tsx            # Dashboard
        ├── runs/               # Lista y detalle de ejecuciones
        ├── agents/             # Biblioteca de agentes
        └── schedules/          # Gestión de automatizaciones
```

## Roadmap

Ver [GitHub Issues](https://github.com/aacienfuegos/agentos/issues) y el [kanban](https://github.com/users/aacienfuegos/projects/2).
