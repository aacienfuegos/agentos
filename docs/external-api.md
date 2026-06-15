# AgentOS — API de integración externa

Guía para que aplicaciones externas (scripts, servicios, otros agentes) puedan ejecutar Claude a través de AgentOS sin intervención manual.

## Concepto

AgentOS actúa como motor de ejecución genérico: la app cliente construye el prompt completo, lo envía a AgentOS, y recibe el output crudo de Claude. Toda lógica de negocio (parsear JSON, validar esquemas, manejar flujos de UI) queda en la app cliente.

**Base URL:** `http://agentos:8000` (o el host donde esté desplegado AgentOS)

---

## 1. Obtener una API key

Las API keys se gestionan desde el panel de AgentOS en **Configuración → API Keys** (`/settings`).

1. Ir a `/settings`
2. Escribir un nombre descriptivo (ej: `mi-app-prod`)
3. Pulsar **Crear**
4. Copiar la key en ese momento — **solo se muestra una vez**

Las keys tienen el formato `sk-agentos-<32 chars base64url>`.

### Endpoints de gestión (requieren sesión de admin)

```
POST   /api/api-keys          Crear key
GET    /api/api-keys          Listar keys (sin exponer el valor)
DELETE /api/api-keys/{id}     Revocar key
```

```bash
# Crear key vía curl (con sesión de browser en cookie)
curl -s -X POST http://agentos:8000/api/api-keys \
  -H "Content-Type: application/json" \
  -b "agentos_token=<jwt>" \
  -d '{"name": "mi-app"}'
```

Respuesta de creación (201):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "mi-app",
  "raw_key": "sk-agentos-abc123...",
  "created_at": "2026-06-15T10:00:00",
  "last_used_at": null,
  "enabled": true
}
```

---

## 2. Autenticación

Todas las llamadas a `/api/execute` y `/api/runs/*` requieren:

```
Authorization: Bearer sk-agentos-<tu-key>
```

Las API keys **no pueden** acceder a endpoints de administración (`/api/agents`, `/api/schedules`, `/api/api-keys`, etc.) — devuelven `403`.

---

## 3. Ejecutar un prompt — `POST /api/execute`

### Modos de ejecución

| Modo | Cuándo usar |
|------|-------------|
| **Síncrono** (defecto) | El cliente espera y recibe el resultado en la misma llamada HTTP. Adecuado para timeouts ≤120s. |
| **Asíncrono** (`"async": true`) | La llamada devuelve inmediatamente un `run_id`. El cliente hace polling a `GET /api/runs/{id}`. Adecuado para tareas largas o cuando no se quiere bloquear. |

### Request body

```json
{
  "prompt": "string (requerido)",
  "system_prompt": "string (opcional)",
  "model": "string (opcional)",
  "timeout_seconds": 120,
  "async": false
}
```

| Campo | Tipo | Defecto | Descripción |
|-------|------|---------|-------------|
| `prompt` | string | — | Prompt completo a enviar a Claude |
| `system_prompt` | string | Asistente genérico | System prompt a prepender. Si el cliente tiene instrucciones específicas, aquí es donde van. |
| `model` | string | `claude-sonnet-4-6` | Modelo de Claude. Opciones: `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, `claude-opus-4-8` |
| `timeout_seconds` | int | `120` | Tiempo máximo de espera. Rango: 5–600. En modo síncrono, expirar devuelve 408. |
| `async` | bool | `false` | Si `true`, no espera la ejecución y devuelve solo el `run_id`. |

### Respuesta síncrona (200)

```json
{
  "output": "Aquí el output completo de Claude...",
  "tokens_input": 342,
  "tokens_output": 891,
  "cost_usd": null,
  "run_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

`cost_usd` es siempre `null` (AgentOS usa Claude Pro — sin coste por token).

### Respuesta asíncrona (200)

```json
{
  "run_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending"
}
```

### Ejemplos curl

**Síncrono:**
```bash
curl -s -X POST http://agentos:8000/api/execute \
  -H "Authorization: Bearer sk-agentos-abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Analiza este texto y devuelve un JSON con las fechas mencionadas: El viaje es del 10 al 20 de julio.",
    "timeout_seconds": 60
  }'
```

**Asíncrono con polling:**
```bash
# Lanzar
RUN_ID=$(curl -s -X POST http://agentos:8000/api/execute \
  -H "Authorization: Bearer sk-agentos-abc123..." \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Tarea larga...", "async": true}' | jq -r .run_id)

# Polling hasta completar
while true; do
  STATUS=$(curl -s http://agentos:8000/api/runs/$RUN_ID \
    -H "Authorization: Bearer sk-agentos-abc123..." | jq -r .status)
  echo "Status: $STATUS"
  [[ "$STATUS" == "success" || "$STATUS" == "failed" ]] && break
  sleep 2
done

# Obtener output
curl -s http://agentos:8000/api/runs/$RUN_ID \
  -H "Authorization: Bearer sk-agentos-abc123..."
```

---

## 4. Consultar el estado de una ejecución — `GET /api/runs/{id}`

Útil en modo asíncrono, o para recuperar el output más tarde.

```bash
curl http://agentos:8000/api/runs/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer sk-agentos-abc123..."
```

Respuesta:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "agent_id": "__execute__",
  "triggered_by": "api",
  "status": "success",
  "output": "...",
  "tokens_input": 342,
  "tokens_output": 891,
  "created_at": "2026-06-15T10:00:00",
  "started_at": "2026-06-15T10:00:01",
  "finished_at": "2026-06-15T10:00:15"
}
```

### Estados posibles

| Status | Descripción |
|--------|-------------|
| `pending` | En cola, esperando un worker |
| `running` | Claude está ejecutando |
| `success` | Completado — el output está en `output` |
| `failed` | Error — el mensaje está en `error` |

### Listar todas las ejecuciones API

```bash
curl "http://agentos:8000/api/runs?triggered_by=api" \
  -H "Authorization: Bearer sk-agentos-abc123..."
```

Las ejecuciones con `agent_id = "__execute__"` y `triggered_by = "api"` son las originadas desde la API externa. Aparecen en el dashboard de AgentOS para auditoría.

---

## 5. Códigos de error

| HTTP | Causa | Body de error |
|------|-------|---------------|
| `401` | Sin credenciales o API key inválida/revocada | `{"detail": "Unauthorized"}` |
| `402` | Presupuesto mensual superado | `{"detail": "Monthly budget of $X exceeded"}` |
| `403` | API key intentando acceder a endpoint de admin | `{"detail": "Forbidden: API keys cannot access this endpoint"}` |
| `408` | Timeout superado (modo síncrono) | `{"detail": {"error": "Timeout after Xs", "run_id": "..."}}` |
| `422` | Validación del body (ej: timeout_seconds fuera de rango) | Detalle Pydantic estándar |
| `429` | Demasiadas ejecuciones API concurrentes (máx 3) | `{"detail": "Too many concurrent API runs (max 3)"}` |
| `500` | Error interno del runner | `{"detail": {"error": "...", "run_id": "..."}}` |

Cuando el error incluye `run_id`, la ejecución quedó registrada en AgentOS con `status=failed` y se puede consultar para diagnóstico.

---

## 6. Límites y consideraciones

- **Concurrencia:** máximo 3 ejecuciones API simultáneas. Si se supera, devuelve `429`.
- **Timeout:** 5–600 segundos. En modo síncrono, el cliente HTTP debe tener un timeout mayor que `timeout_seconds`.
- **Presupuesto:** si `MONTHLY_BUDGET_USD` está configurado en AgentOS, se comprueba antes de ejecutar.
- **Sin herramientas:** `/api/execute` no da acceso a herramientas del sistema (filesystem, GitHub, etc.). Solo Claude puro. Si necesitas herramientas, usa agentes built-in desde la UI o el webhook.
- **Output crudo:** el `output` es el texto que Claude devuelve sin procesar. Si esperas JSON, el cliente debe hacer `JSON.parse(output)` y validar.

---

## 7. Integración desde TypeScript/Next.js

Ejemplo de cliente para llamar a AgentOS desde una app Next.js:

```typescript
const AGENTOS_URL = process.env.AGENTOS_URL ?? "http://agentos:8000";
const AGENTOS_KEY = process.env.AGENTOS_API_KEY!;

async function runWithAgentOS(prompt: string): Promise<string> {
  const res = await fetch(`${AGENTOS_URL}/api/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AGENTOS_KEY}`,
    },
    body: JSON.stringify({ prompt, timeout_seconds: 120 }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`AgentOS error ${res.status}: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  return data.output; // string crudo — parsear si se espera JSON
}
```

Variables de entorno a añadir en `.env.local` de la app cliente:
```
AGENTOS_URL=http://localhost:8000
AGENTOS_API_KEY=sk-agentos-...
```

---

## 8. Auditoría

Todas las ejecuciones via API son visibles en el dashboard de AgentOS (`/runs`) con:
- `triggered_by: "api"` en la UI
- `agent_id: "__execute__"`
- Tokens, tiempos, output completo y logs detallados del runner

Esto permite depurar problemas sin acceder al servidor de la app cliente.
