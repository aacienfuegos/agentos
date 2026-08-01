# Agentes de infraestructura multi-repo (#219)

> Diseño conceptual para agentes de AgentOS capaces de operar sobre múltiples
> repos y sobre infraestructura real (SSH, Docker), respondiendo a las 4
> preguntas planteadas en el issue #219 antes de implementar.
>
> **Nota de seguridad sobre este documento**: todo lo aquí descrito usa
> nombres genéricos (`infra-dev-target`, `homelab-dev`) y no contiene IPs,
> hostnames, topología real ni credenciales de la infraestructura de
> producción del autor. El entorno real (`~/docu/homelab`) se usó solo como
> referencia local para fundamentar el diseño, nunca como contenido a commitear.

## Resumen ejecutivo

- **No** se modela como una extensión de `KnowledgeAgent`/`Project`. Se
  introduce una entidad nueva y deliberadamente pequeña, `InfraTarget`, y los
  roles (arquitecto/deployer/scrum-master) siguen siendo `AgentDefinition`
  normales — mismo patrón que ya existe, sin inventar un subsistema paralelo.
- **Credenciales propias, no las del usuario.** Un keypair SSH dedicado
  (`agentos_infra`) distinto de `~/.ssh/id_ed25519`, autorizado solo en hosts
  dev-tier, con `command=` forzado en `authorized_keys` que restringe qué se
  puede ejecutar remotamente. El socket de Docker sigue reservado a `vuln_scan`.
- **El deployer nunca ejecuta un cambio irreversible sin un `plan` humano
  aprobado primero.** Se adopta el patrón plan/apply de Terraform: un run
  produce un plan (modo `advisory`, solo lectura), un humano lo aprueba desde
  el frontend, y solo entonces un segundo run (modo `deploy`) puede ejecutar
  comandos mutantes — y solo los que el allowlist del target permite.
- **Single-tenant por ahora, explícitamente.** `InfraTarget` y los agentes de
  infraestructura quedan detrás de un flag (`INFRA_AGENTS_ENABLED`) y sin
  columna de propietario; cuando llegue `phase:multi-tenant` se añade
  `owner_user_id` nullable y las credenciales SSH pasan a ser secretos por
  usuario, igual que ya está previsto para las API keys de Anthropic/GitHub.

---

## 1. ¿Extensión de "Proyectos" o entidad distinta?

**Entidad distinta, deliberadamente pequeña.** Un `KnowledgeAgent`/`Project`
modela "conocimiento + capacidad de acción sobre un directorio local" (el repo
clonado en el contenedor). Un agente de infraestructura necesita algo distinto:
"conocimiento sobre uno o más repos/docs" + "capacidad de acción sobre un host
remoto por SSH". Forzar esto dentro del modelo de `Project` significaría que
un `Project` tendría que representar tanto un path local como un host SSH,
mezclando dos conceptos con modelos de permiso completamente distintos.

En su lugar:

```
InfraTarget (nuevo, pequeño)
  id, name, host, ssh_user, ssh_port, ssh_key_name, notes, mode_allowed (advisory|deploy)

AgentDefinition (ya existe, sin cambios de esquema)
  infra-architect  → tools=[Bash, Read], solo lectura
  infra-deployer   → tools=[Bash, Read], plan/apply (ver §3)
  scrum-master     → tools=[Bash, Read, Write], multi-repo (fase futura)
```

El contexto "multi-repo" (p. ej. el arquitecto necesita saber qué hay en
`~/docu/homelab` **y** en los repos de `TripPlanner`/`AgentOS` a la vez) se
resuelve reutilizando lo que ya existe: montar varias `KnowledgeBase`/rutas
como contexto de lectura (igual que ya hace `KnowledgeRunner` con
`knowledge_path`), no inventando un nuevo tipo de "proyecto compuesto". Un
`InfraTarget` es solo el destino de las acciones; el conocimiento sigue
viviendo en `KnowledgeBase` como ya está diseñado.

Esto responde también a por qué no reutilizar `Project` (#218): `Project`
resuelve "un repo de desarrollo con contexto"; `InfraTarget` resuelve "un host
con el que se puede hablar por SSH". Son ortogonales — un `infra-architect`
puede usar ambos a la vez (leer `KnowledgeBase("homelab-docs")` +
actuar sobre `InfraTarget("homelab-dev")`).

## 2. Modelo de permisos

**No se reutilizan las credenciales del usuario.** Tres razones:

1. La clave SSH personal del usuario normalmente tiene acceso a *toda* la
   infraestructura (Madrid, Cartagena, todos los servicios). Un agente que la
   usara heredaría ese alcance completo aunque solo necesite tocar un host de
   desarrollo.
2. `--dangerously-skip-permissions` (ya usado por `ClaudeCodeRunner`, ver
   `runner/claude_code.py:56`) desactiva las confirmaciones interactivas del
   CLI. Sin una clave con alcance reducido, cualquier error de prompt o
   alucinación del modelo tendría alcance total sobre la infra real.
3. Ya existe precedente en el propio proyecto para esto: los subagentes de
   Claude Code `homelab-architect` y `network-troubleshooter`
   (`~/.claude/agents/`) son **solo lectura** (`tools: [Read, Bash]`, sin
   `Write`/`Edit`) y documentan explícitamente guardrails ("no aplicar cambios
   de routing/VLAN en caliente", "tener consola física de backup"). AgentOS
   debe llevar esa misma disciplina al nivel de infraestructura del propio
   AgentOS, no debilitarla.

Diseño concreto:

- **Un keypair ed25519 dedicado por `InfraTarget`**, no uno compartido entre
  toda la flota. AgentOS lo genera automáticamente al crear el target
  (`POST /api/infra-targets` → `api/infra_targets.py::_generate_keypair`,
  `ssh-keygen` local e instantáneo) y guarda la privada en
  `settings.infra_keys_path/{id}/id_ed25519` (por defecto `/data/infra_keys`,
  dentro del volumen que ya comparten `backend` y `worker` — sin volumen
  nuevo). La privada nunca toca la DB ni el repo; la pública sí se guarda
  (`InfraTarget.ssh_public_key`) para poder mostrarla y regenerar los
  comandos de instalación en cualquier momento.
- Una clave por host acota el blast radius: comprometer un target no da
  acceso al resto de la flota, y revocar el acceso a un host no obliga a
  rotar y redistribuir en todos los demás — solo se borra su directorio de
  claves (`DELETE /api/infra-targets/{id}` lo hace automáticamente).
- `GET /api/infra-targets/{id}/setup-commands` genera el bloque de comandos
  a pegar en el host de destino (crear usuario, `.ssh`, script de allowlist,
  línea de `authorized_keys` con forced command) — la única parte que sigue
  siendo manual por diseño explícito del propietario: AgentOS nunca hace SSH
  a sus propios contenedores para provisionar el lado del host.
- En cada host gestionado (`InfraTarget`), la clave pública se instala con un
  **forced command** en `authorized_keys`:
  ```
  command="/opt/agentos-guard/allowlist.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding ssh-ed25519 AAAA... agentos-infra
  ```
  `allowlist.sh` ignora el comando que pide el cliente SSH
  (`$SSH_ORIGINAL_COMMAND`) salvo que matchee una lista explícita de comandos
  permitidos para ese target y ese modo. Así el control de qué se puede
  ejecutar vive en el host de destino, no solo en el system prompt del
  agente — un jailbreak del modelo no puede escapar del allowlist.
- Dos listas de allowlist por target: `advisory` (solo lectura: `docker ps`,
  `docker compose ps`, `df -h`, `uptime`, `journalctl --no-pager -n 200`,
  `cat` sobre una lista fija de ficheros de estado) y `deploy` (añade
  operaciones mutantes explícitas y acotadas: `docker compose pull`,
  `docker compose up -d`, nunca `rm -rf`, nunca edición de ficheros de sistema
  arbitraria).
- El socket de Docker (`/var/run/docker.sock`) sigue montado solo para
  `vuln_scan`, sin cambios — los agentes de infraestructura no lo tocan, todo
  su alcance sobre Docker remoto pasa por SSH + el allowlist del host de
  destino, no por acceso directo al socket del propio AgentOS.

## 3. ¿El deployer actúa solo o siempre pide confirmación?

**Siempre pide confirmación humana antes de un cambio irreversible.** Esto ya
es un principio general del proyecto (`~/.claude/CLAUDE.md`: "Deploy vía
Dockhand, no scripts directos"); se traduce al modelo de runs así:

- Un run de `infra-deployer` se lanza siempre en modo **`plan`**: el
  `allowlist.sh` del target en ese modo solo admite subcomandos de solo
  lectura/dry-run (`docker compose config`, `docker compose pull --dry-run`
  si el motor lo soporta, diffs de ficheros). El agente produce un plan en
  markdown (qué cambiaría y por qué) que se guarda como `Run.output`.
- El frontend muestra el plan con un botón **"Aprobar despliegue"**. Aprobar
  crea un segundo `Run`, con `mode=apply` y un nuevo campo
  `Run.approved_from_run_id` apuntando al run de plan. Solo en este segundo
  run el `allowlist.sh` del target admite los comandos mutantes.
- Sin aprobación explícita, el plan expira (p. ej. 30 min) y no hay forma de
  ejecutar el apply — no existe un "auto-apply" ni siquiera como opción de
  configuración, para no reproducir el error de exponer un botón que parezca
  seguro pero no lo sea.
- Esto requiere un cambio de esquema pequeño y aislado: `Run.mode: str |
  None` y `Run.approved_from_run_id: str | None`, sin tocar el resto del
  modelo de `Run` (ver fase 2 más abajo).

Esto es deliberadamente más estricto que el resto de AgentOS (donde runs de
`code-review` o `vuln-scan` se disparan y ejecutan sin intervención humana)
porque la clase de daño es distinta: un `code-review` que se equivoca publica
un comentario incorrecto en un PR; un `deployer` que se equivoca puede tirar
un servicio real. El coste de pedir confirmación es bajo comparado con el
coste de un despliegue erróneo autónomo.

## 4. Relación con `phase:multi-tenant`

**Single-tenant explícito, no diseño para un futuro hipotético.** Por ahora:

- `InfraTarget` no tiene `owner_user_id`; solo existe el propietario único de
  la instancia AgentOS.
- El registro de builtin agents (`infra-architect`, `infra-deployer`) queda
  detrás de un flag `INFRA_AGENTS_ENABLED=false` por defecto en
  `Settings` — así una instancia de AgentOS que no lo necesite ni siquiera ve
  estos agentes ni necesita generar el keypair dedicado.
- Cuando `phase:multi-tenant` se implemente (ya en el roadmap del proyecto:
  tabla de usuarios, API keys cifradas por usuario), la extensión natural es:
  `InfraTarget.owner_user_id` nullable + las claves privadas por-target (ya
  aisladas por host, ver sección de diseño de arriba) pasan de vivir en el
  volumen `/data` compartido del `worker` a ser un secreto cifrado por
  usuario, igual que ya está previsto para las claves de Anthropic/GitHub. No
  se diseña esa capa ahora (YAGNI) pero el modelo de permisos de la sección 2
  ya es compatible: cada `InfraTarget` apunta a *su propio* keypair con *su
  propio* alcance, así que añadir un propietario no rompe el modelo, solo lo
  acota más.

---

## Arquitectura de la prueba de concepto (esta rama)

Para que esta propuesta no se quede en diagrama, esta rama incluye un
entorno **dev-tier** real y aislado — no la infraestructura de producción del
autor:

```
docker-compose.dev.yml
  worker  ──SSH (keypair por-target, forced command)──►  infra-dev-target
  (contenedor openssh-server genérico, red interna de docker compose)
```

- `infra-dev-target`: contenedor `linuxserver/openssh-server` en la red
  interna de `docker-compose.dev.yml`, sin exposición de puertos al host.
  Simula "un nodo del homelab" de forma genérica.
- El `authorized_keys` de este contenedor (`scripts/infra-dev/authorized_keys`)
  es un bind mount de solo lectura estático — no puede recibir la clave
  dinámica que AgentOS genera al crear el `InfraTarget` directamente. Por eso
  `scripts/infra-dev/sync-dev-target-key.sh` copia la pública generada para
  el target `infra-dev-target` (leída desde `/data/infra_keys/` dentro del
  contenedor `backend`) a ese fichero — solo hace falta tras crear el target
  la primera vez.
- `infra-architect` (builtin agent): puede ejecutarse contra
  `infra-dev-target` de verdad una vez sincronizada la clave, y el resultado
  se puede verificar en el log del run.

## Descomposición en issues

| Fase | Contenido |
|------|-----------|
| **phase:infra-agents-1** | `InfraTarget` (modelo + CRUD), keypair dedicado + forced command, target dev-tier, agente `infra-architect` (solo lectura) — lo que esta rama ya implementa como prueba de concepto |
| **phase:infra-agents-2** | Modo `plan`/`apply` para `infra-deployer`: campos `Run.mode`/`approved_from_run_id`, endpoint de aprobación, botón en frontend |
| **phase:infra-agents-3** | `scrum-master`: propina cambios de `CLAUDE.md`/workflow a través de varios repos de desarrollo (reutiliza `KnowledgeBase` multi-repo, no requiere SSH) |

## Riesgos y guardrails (resumen)

- Sin allowlist en el host de destino, el system prompt es la única barrera —
  insuficiente. El allowlist vive en el target, no solo en el prompt.
- Sin split plan/apply, un "modo dry-run" basado solo en instrucciones de
  prompt es tan confiable como pedirle educadamente al modelo que no se
  equivoque — no es una barrera real. El split plan/apply mueve la barrera a
  la infraestructura (el allowlist del modo `apply` es distinto y solo se
  activa tras aprobación humana explícita).
- `INFRA_AGENTS_ENABLED=false` por defecto: esta capacidad no debe activarse
  implícitamente en una instalación existente.
