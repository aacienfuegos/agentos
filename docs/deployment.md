# AgentOS — Guía de despliegue

Documento de referencia para que un agente de despliegue (o persona) pueda instalar, actualizar y operar AgentOS en producción sin conocimiento previo del proyecto.

---

## Visión general de la arquitectura

AgentOS es una plataforma self-hosted que orquesta agentes de Claude. Tiene 5 servicios:

```
Tailscale / red interna
        │
    [Caddy :80]              ← reverse proxy HTTP
     ┌──────┴──────┐
[Frontend :3000]  [Backend :8000]
   Next.js 16       FastAPI + APScheduler
                        │
                   [Worker ARQ]      ← tareas asíncronas (mismo Dockerfile que backend)
                        │
                   [Redis :6379]     ← broker de mensajes + SSE pub/sub
                        │
                   [SQLite /data/agentos.db]   ← persistencia (volumen Docker)
```

**Principio clave:** todos los agentes ejecutan mediante el CLI `claude` (NPM package `@anthropic-ai/claude-code`) instalado dentro de las imágenes del backend/worker. Nunca se llama al SDK `anthropic` directamente — el coste lo cubre Claude Pro, no la API de pago por token.

---

## Imágenes Docker publicadas

CI/CD publica automáticamente a GitHub Container Registry tras cada push:

| Branch | Tag | Cuándo |
|--------|-----|--------|
| `main` | `:latest` | Push a main (tras CI verde + Trivy scan) |
| `develop` | `:staging` | Push a develop (tras CI verde + Trivy scan) |

```
ghcr.io/aacienfuegos/agentos-backend:latest
ghcr.io/aacienfuegos/agentos-frontend:latest
ghcr.io/aacienfuegos/agentos-backend:staging
ghcr.io/aacienfuegos/agentos-frontend:staging
```

Las imágenes son públicas — no requieren `docker login` para pull.

---

## Prerrequisitos del servidor

- Docker Engine 24+ y Docker Compose V2 (`docker compose`, no `docker-compose`)
- Puerto 80 accesible en la red interna (Tailscale u otra VPN)
- Volumen con ~1 GB libre para la base de datos SQLite y logs

> El aislamiento de red (que solo sea accesible desde Tailscale) se gestiona a nivel de firewall (`ufw`) o ACLs de Tailscale — no en Caddy. Caddy escucha en `:80` en todas las interfaces.

---

## Primer despliegue

### 1. Clonar el repositorio

```bash
git clone https://github.com/aacienfuegos/agentos
cd agentos
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar `.env` con los valores reales:

| Variable | Cómo obtenerla | Requerida |
|----------|---------------|-----------|
| `ANTHROPIC_API_KEY` | console.anthropic.com | ✅ |
| `SECRET_KEY` | `openssl rand -hex 32` | ✅ |
| `ADMIN_PASSWORD` | Contraseña libre (min. 12 chars recomendado) | ✅ |
| `GITHUB_TOKEN` | GitHub → Settings → Developer settings → PAT (permisos: `repo`, `read:org`) | ✅ para agentes GitHub |
| `TAILSCALE_IP` | `tailscale ip -4` en el servidor | ✅ para HTTPS |
| `BACKEND_URL` | `http://backend:8000` (interno Docker) | ✅ en prod |
| `NTFY_URL` | URL del topic ntfy (ej: `https://ntfy.sh/mi-topic-secreto`) | Opcional |
| `GITHUB_WEBHOOK_SECRET` | `openssl rand -hex 20` | Opcional |
| `MONTHLY_BUDGET_USD` | Número (default: 50) | Opcional |

Ejemplo de `.env` mínimo para producción:
```dotenv
ANTHROPIC_API_KEY=sk-ant-...
SECRET_KEY=a1b2c3d4e5f6...  # 64 chars hex
ADMIN_PASSWORD=MiPasswordSeguro123
GITHUB_TOKEN=ghp_...
TAILSCALE_IP=100.x.x.x
BACKEND_URL=http://backend:8000
```

### 3. Autenticar el CLI de Claude

El backend y el worker ejecutan el CLI `claude` como subproceso. El CLI necesita estar autenticado con una sesión de Claude Pro.

**Problema pendiente (issue #121):** en producción aún no hay un volumen named para la sesión de Claude. Por ahora, la autenticación se gestiona montando `~/.claude` y `~/.claude.json` desde el host (igual que en dev). Pasos:

```bash
# En el servidor, autenticar claude una vez de forma interactiva
# (requiere que claude CLI esté instalado en el host o usar un contenedor temporal)
npx @anthropic-ai/claude-code /login
# Seguir el flujo OAuth en el browser
```

Esto crea `~/.claude/` y `~/.claude.json` en el home del usuario del host.

Luego añadir al `docker-compose.yml` (en los servicios `backend` y `worker`):
```yaml
volumes:
  - ${HOME}/.claude:/home/worker/.claude
  - ${HOME}/.claude.json:/home/worker/.claude.json
```

> Nota: el archivo `docker-compose.dev.yml` ya tiene estos mounts — úsalo como referencia exacta.

### 4. Levantar los servicios

```bash
docker compose up -d
```

Esto levanta: Redis → Backend → Worker → Frontend → Caddy (en ese orden, por `depends_on`).

Verificar que todo está sano:
```bash
docker compose ps
docker compose logs -f
```

El backend tiene healthcheck en `GET /api/health`. El worker espera a que el backend esté healthy antes de arrancar.

### 5. Verificar el acceso

- Panel web: `https://<TAILSCALE_IP>` o `http://localhost:80`
- Login: usuario `admin` + `ADMIN_PASSWORD`
- API docs: `https://<TAILSCALE_IP>/api/docs`
- Health: `curl http://localhost:8000/api/health`

---

## Actualizar a una nueva versión

```bash
# Descargar las imágenes más recientes
docker compose pull

# Reiniciar con zero-downtime (one service at a time)
docker compose up -d --no-build

# O forzar recreación completa
docker compose down && docker compose up -d
```

La base de datos SQLite persiste en el volumen `backend_data` — las actualizaciones no borran datos.

---

## Estructura de volúmenes Docker

```
backend_data    → /data/agentos.db  (SQLite)
                  /data/knowledge/  (Knowledge agents)
caddy_data      → /data/            (certificados TLS de Caddy)
caddy_config    → /config/          (configuración Caddy auto-generada)
redis_data      → /data/            (persistencia Redis)
```

Los volúmenes son gestionados por Docker. Para hacer backup de la base de datos:
```bash
docker run --rm -v agentos_backend_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/agentos-db-backup.tar.gz /data/agentos.db
```

---

## Networking interno

Caddy enruta el tráfico según el path:

```
/api/*   → backend:8000   (FastAPI)
/*       → frontend:3000  (Next.js)
```

Los servicios se comunican por nombre de servicio Docker (red interna). El frontend recibe `NEXT_PUBLIC_BACKEND_URL=http://backend:8000` como build arg — este valor queda hardcodeado en el bundle Next.js.

Puertos expuestos al host (producción):
- `80` → Caddy HTTP (redirect a 443 o fallback)
- `443` → Caddy HTTPS (Tailscale)

En producción NO exponer directamente `8000` (backend) ni `3000` (frontend) al exterior — todo el tráfico debe pasar por Caddy.

---

## Configuración de Caddy

Archivo: `caddy/Caddyfile`

```caddyfile
{$TAILSCALE_IP:localhost}:443 {
    reverse_proxy /api/* backend:8000
    reverse_proxy frontend:3000
}

:80 {
    reverse_proxy /api/* backend:8000
    reverse_proxy frontend:3000
}
```

Caddy gestiona automáticamente los certificados TLS para la IP de Tailscale (usando el CA de Let's Encrypt interno de Tailscale o el propio de Caddy). No se necesita configuración adicional de TLS.

---

## Autenticación del panel web

El panel usa JWT en cookie httpOnly (`agentos_token`). Un único usuario `admin` con contraseña configurada en `ADMIN_PASSWORD`. No hay registro de usuarios.

- `POST /api/auth/login` → devuelve cookie JWT
- La cookie tiene `SameSite=Strict` — EventSource (SSE) requiere `withCredentials: true` en el frontend

---

## Agentes built-in disponibles

| ID | Descripción | Input params necesarios |
|----|-------------|------------------------|
| `code-review` | Revisa PRs de GitHub y publica comentarios inline | `repo` (owner/name), `pr_number` (opcional), `focus` |
| `portfolio-updater` | Actualiza portfolio desde repos públicos de GitHub | `github_username`, `portfolio_repo`, `content_path` |
| `vuln-scan` | Escanea vulnerabilidades con semgrep/gitleaks | `repo`, `scan_type` |
| `custom` | Agente genérico para tareas ad-hoc | `user_message` |

Los agentes custom se configuran via YAML en `agents_config/` (montado en ambos contenedores).

---

## Webhook GitHub (code review automático)

Para que `code-review` se dispare automáticamente en cada PR:

1. Configurar `GITHUB_WEBHOOK_SECRET` en `.env`
2. En el repo de GitHub: Settings → Webhooks → Add webhook
   - Payload URL: `https://<tu-servidor>/api/webhooks/github`
   - Content type: `application/json`
   - Secret: el valor de `GITHUB_WEBHOOK_SECRET`
   - Events: `Pull requests`

---

## API de integración externa

Apps externas (TripPlanner, scripts, otros agentes) pueden ejecutar Claude via REST:

```bash
# 1. Crear API key desde el panel: /settings → API Keys
# 2. Ejecutar un prompt
curl -X POST https://<servidor>/api/execute \
  -H "Authorization: Bearer sk-agentos-<key>" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "tu prompt aquí", "timeout_seconds": 60}'
```

Las API keys solo tienen acceso a `/api/execute` y `/api/runs/*`. Ver `docs/external-api.md` para la guía completa.

---

## CI/CD y pipeline de imágenes

```
PR → develop    → CI (tests + pip-audit + tsc + npm audit)
push → develop  → CI + build + Trivy scan → push :staging a ghcr.io
push → main     → CI + build + Trivy scan → push :latest a ghcr.io
```

El scan Trivy usa la versión pinned `v0.71.0` (instalada directamente, no via action) y falla en HIGH/CRITICAL con fix disponible. Las imágenes solo se publican si el scan pasa.

---

## Seguridad operacional

- El socket Docker (`/var/run/docker.sock`) está montado en backend y worker — necesario para el agente `vuln-scan`. Uso personal únicamente.
- El usuario dentro del contenedor es `worker` (no root) — el CLI `claude` requiere no-root con `--dangerously-skip-permissions`.
- El `UID` del usuario `worker` se puede ajustar via build arg (`ARG UID=1001`) para coincidir con el UID del host en entornos de dev.
- Tailscale limita el acceso a la red privada — no exponer los puertos al exterior en producción.

---

## Diagnóstico rápido

```bash
# Ver logs de todos los servicios
docker compose logs -f

# Solo backend o worker
docker compose logs -f backend
docker compose logs -f worker

# Estado de los contenedores
docker compose ps

# Health check manual
curl http://localhost:8000/api/health

# Redis OK
docker compose exec redis redis-cli ping   # → PONG

# Ver runs recientes vía API
curl http://localhost:8000/api/runs \
  -b "agentos_token=<jwt>"

# Reiniciar un servicio sin bajar los demás
docker compose restart worker
```

---

## Entorno de desarrollo local

Para desarrollo (no producción):

```bash
cp .env.example .env   # ajustar al menos SECRET_KEY y ADMIN_PASSWORD
./dev.sh               # levanta Redis+Backend+Worker en Docker + Frontend nativo
```

- Backend con hot reload: `http://localhost:8000`
- Frontend con hot reload: `http://localhost:3000`
- Redis expuesto en `localhost:6379`
- Los mounts `~/.claude` y `~/.claude.json` están en `docker-compose.dev.yml`

El script `dev.sh` exporta el UID del host para que el usuario `worker` en el contenedor coincida y evite problemas de permisos con los archivos montados.
