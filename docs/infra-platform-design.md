# Mapa visual de infraestructura (#248, #249, #250)

> Diseño para que AgentOS deje de tratar `~/docu/homelab` como texto libre
> (consumido solo por chat vía `KnowledgeBase`) y lo convierta también en
> datos estructurados: nodos, redes, servicios y enlaces, consultables por API
> y visualizables (dashboard + diagrama de topología), y disponibles como
> contexto para agentes como `infra-architect`.
>
> **Nota de seguridad sobre este documento**: igual que `docs/infra-agents-design.md`,
> aquí no aparecen IPs, hostnames ni topología real — solo la forma de los
> datos. El contenido real de `~/docu/homelab` se usó como referencia local
> para fundamentar el diseño, nunca como contenido a commitear.

## Resumen ejecutivo

- **Solo lectura en esta fase.** `~/docu/homelab` no es hoy un repositorio
  git — escribir de vuelta sobre él sin ese historial arriesga la
  documentación existente sin red de seguridad. La fase 1 monta el
  directorio `:ro` y nunca lo modifica. Sync bidireccional (edición desde
  AgentOS → commit) queda para una fase 2 explícita, condicionada a que el
  propietario convierta primero el directorio en repo git.
- **Extracción vía agente, no parser determinista.** Los markdown de
  `~/docu/homelab` son prosa libre con tablas ad-hoc (no tienen frontmatter
  ni un schema fijo), y no se les va a imponer uno solo para facilitar el
  parseo — igual que el resto de AgentOS, la extracción la hace el CLI
  `claude` (nunca el SDK `anthropic`, ver `AGENTS.md`), que lee los `.md` y
  escribe un JSON estructurado a un fichero de trabajo. El backend valida
  ese JSON y reemplaza el contenido de las tablas — sin caché incremental ni
  diffing en v1: cada refresh es un reemplazo completo.
- **Cuatro entidades, deliberadamente pequeñas**: `InfraNode` (hosts, VMs,
  LXCs, dispositivos), `InfraNetwork` (VLANs/subredes), `InfraService`
  (servicios lógicos, asociados o no a un nodo) e `InfraLink` (enlaces entre
  nodos, para el diagrama de topología). Nada de un modelo genérico
  "documento estructurado" — se modela lo que ya existe en los documentos
  reales (nodos, VLANs, servicios, flujo de tráfico), no un formato
  hipotético más amplio.
- **Sin relación de esquema con `InfraTarget`.** `InfraTarget`
  (`docs/infra-agents-design.md`) es un destino accionable por SSH con
  credenciales propias; `InfraNode`/`InfraService`/etc. son descriptivos,
  derivados de documentación, sin credenciales ni capacidad de acción. Se
  mantienen desacoplados a propósito — cuando en el futuro tenga sentido
  cruzarlos (p. ej. "este `InfraNode` tiene un `InfraTarget` para SSH"), se
  añade un campo opcional entonces, no ahora (YAGNI).
- **Despliegue explícitamente fuera de alcance.** Esta fase no añade ninguna
  capacidad de escritura sobre infraestructura real — eso sigue siendo
  `infra-deployer` (#230), sin relación con este trabajo.

---

## 1. Entidades

```
InfraNetwork
  id, name, vlan_tag, subnet, gateway, location

InfraNode
  id, name, node_type (host|vm|lxc|device), location,
  parent_id (→ InfraNode, nullable — p.ej. una VM cuelga de su host físico),
  network_id (→ InfraNetwork, nullable),
  ip_local, ip_tailscale, role, status, source_files (list[str])

InfraService
  id, name, node_id (→ InfraNode, nullable), category, description, domain,
  source_files (list[str])

InfraLink
  id, source_node_id (→ InfraNode), target_node_id (→ InfraNode),
  kind (p.ej. "proxies_to", "tailscale", "firewall_allow", "firewall_block"),
  label
```

`source_files` (en `InfraNode`/`InfraService`) guarda qué ficheros markdown
originaron cada entidad — no para trazabilidad de auditoría fina, sino para
que el dashboard pueda enlazar "ver documentación" sin tener que releer todo
el árbol para encontrarla.

No se modela `InfraNetwork` como parte de `InfraNode` (aunque cada nodo
pertenece como mucho a una red) porque los documentos reales tratan las
VLANs como entidad propia con sus propios atributos (subred, gateway,
firewall entre VLANs) — colapsarlo en un campo de texto en `InfraNode`
perdería esa estructura sin ganar nada a cambio.

## 2. Extracción

- `InfraMapRunner` (`backend/agentos/runner/infra_map.py`), mismo patrón que
  `KnowledgeRunner`: construye un `AgentDefinition` en memoria (no se
  persiste como builtin agent — no tiene sentido como algo invocable desde
  el selector de agentes, solo desde `POST /api/infra-map/refresh`).
- `cwd` del run es un directorio de trabajo propio
  (`/data/infra_map/work`, en el volumen que ya comparten backend/worker),
  **no** el propio `settings.infra_map_docs_path`: el agente necesita
  escribir su resultado (`extraction.json`) en algún sitio, y el mount de
  documentación es `:ro`. El system prompt le da la ruta absoluta de
  `settings.infra_map_docs_path` para leer con `Read`/`Glob`/`Grep`, y le
  pide escribir el resultado con `Write` en `./extraction.json` (relativo a
  su `cwd`, que sí es escribible).
- El JSON de salida sigue exactamente el shape de las 4 entidades de arriba
  (listas `networks`, `nodes`, `services`, `links`, con ids locales al
  documento — p. ej. `"node-madrid-proxmox"` — que el backend resuelve a
  UUIDs reales al insertar, para que el agente no tenga que inventar UUIDs).
- El backend valida el JSON (pydantic) antes de tocar la base de datos. Si
  la validación falla, el `Run` termina en `failed` con el error de
  validación como mensaje — no se aplica un reemplazo parcial.
- Reemplazo completo, no diff: en una transacción se borran las filas
  existentes de las 4 tablas y se insertan las nuevas. Es la opción más
  simple que evita reconciliar entidades renombradas/movidas entre
  refreshes — aceptable porque estas tablas son una **cache derivada**, no
  la fuente de verdad (que sigue siendo el markdown).
- Sin programación automática en v1 (sin APScheduler): refresh es manual,
  vía el botón del dashboard. Si en el futuro hace falta refresco periódico,
  es una tarea de scheduler trivial de añadir sobre el mismo endpoint — no
  se diseña ahora (YAGNI).

## 3. API

- `POST /api/infra-map/refresh` — crea un `Run` (`agent_id="__infra_map__"`,
  `run_type="infra_map"`, `triggered_by="manual"`) y lo encola en ARQ, igual
  que el modo async de `/api/execute`. 400 si `settings.infra_map_docs_path`
  está vacío (feature no configurada) — se decide no fallar en silencio ni
  devolver una lista vacía como si fuera un estado válido.
- `GET /api/infra-map` — devuelve `{networks, nodes, services, links,
  last_refresh: {run_id, status, finished_at} | null}`. `last_refresh` sale
  de la última fila de `Run` con `agent_id="__infra_map__"`, sin tabla de
  snapshots propia — evita una entidad extra solo para guardar un timestamp
  que `Run` ya tiene.
- Reutiliza el stream SSE existente (`GET /api/runs/{id}/stream`) para que
  el frontend siga el progreso del refresh igual que cualquier otro run.

## 4. Frontend (issues #249, #250)

- Página `/infra-map`: dashboard de tarjetas (#249) por defecto, con
  toggle/tab a diagrama de topología (#250) — ambas vistas leen el mismo
  `GET /api/infra-map`, sin endpoints separados.
- Dashboard: tarjetas agrupadas por `location`/`InfraNetwork`, cada una con
  sus `InfraService` asociados.
- Topología: grafo de `InfraNode` + `InfraLink` (librería `@xyflow/react` u
  otra ya evaluada en la issue), coloreado/agrupado por `InfraNetwork`.
- Botón "Actualizar" dispara `POST /api/infra-map/refresh` y sigue el run
  vía SSE, igual que el resto de agentes en la UI actual.

## 5. Explícitamente fuera de alcance

- **Sync bidireccional** (edición desde AgentOS → escritura en
  `~/docu/homelab`): requiere convertir primero ese directorio en repo git
  (hoy no lo es) para que git sea la autoridad en conflictos, como se
  decidió explícitamente. Fase 2, sin issue abierta todavía.
- **Escaneo activo de red / detección de drift** (nmap, ARP): decisión
  pendiente sobre desde qué host se ejecutaría y con qué alcance
  (`InfraTarget` existente vs. contenedor dedicado por sede). No se diseña
  aquí.
- **`infra-deployer`** (#230): sin relación con este trabajo. Esta fase no
  añade ninguna capacidad de escritura sobre infraestructura real, solo
  sobre las 4 tablas derivadas de documentación.

## Descomposición en issues

| Issue | Contenido |
|-------|-----------|
| #248 | Modelos + migración, `InfraMapRunner`, endpoints, mount `:ro` en dev compose |
| #249 | Dashboard de inventario (tarjetas) |
| #250 | Diagrama de topología de red |
