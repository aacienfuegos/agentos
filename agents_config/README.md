# agents_config/

Directorio para definiciones YAML de agentes custom. Los ficheros aquí se montan en el contenedor del backend/worker y pueden cargarse como `AgentDefinition` adicionales al arranque.

> **Nota:** La carga automática de YAML está en el roadmap (issue pendiente). Por ahora, crea agentes custom desde la API: `POST /api/agents`.

## Ejemplo de definición

```yaml
# agents_config/my-agent.yaml
id: my-daily-summary
name: "Resumen diario"
description: "Genera un resumen de los PRs y issues del día"
model: claude-sonnet-4-6
max_tokens: 4096
timeout_seconds: 300
tools:
  - github_list_prs
  - github_list_issues
  - send_notification
system_prompt: |
  Eres un asistente que genera resúmenes diarios de actividad en GitHub.
  Para el repositorio indicado, lista los PRs y issues del día y genera
  un resumen conciso en markdown. Envía una notificación al terminar.
```

## Cómo crear un agente via API

```bash
curl -X POST http://localhost:8000/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-daily-summary",
    "name": "Resumen diario",
    "description": "Genera un resumen de los PRs y issues del día",
    "system_prompt": "Eres un asistente que...",
    "tools": ["github_list_prs", "github_list_issues"],
    "model": "claude-sonnet-4-6",
    "timeout_seconds": 300
  }'
```
