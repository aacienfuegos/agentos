#!/usr/bin/env bash
# Prepara el InfraTarget "infra-dev-target" para pruebas locales de
# infra-architect:
#   1. Sincroniza scripts/infra-dev/authorized_keys (bind mount de solo
#      lectura, no se puede actualizar desde dentro del contenedor backend)
#      con la clave pública que AgentOS genera dinámicamente al crear el
#      target, y con el forced-command wrapper como en producción.
#   2. Instala ese wrapper (auditoría + denylist best-effort, NO un
#      allowlist — ver docs/infra-agents-design.md) dentro del contenedor,
#      reutilizando el generador real (api/infra_targets.py::_build_wrapper_script)
#      en vez de duplicar el script bash en dos sitios.
#
# Este fixture Alpine no trae docker/systemd/journald, así que
# InfraTarget.sudo_commands para este target suele quedar vacío — no hace
# falta instalar sudoers para probar el flujo de scope normal + auditoría.
#
# Uso: crea primero el target "infra-dev-target" desde la UI o la API, luego:
#   ./scripts/infra-dev/sync-dev-target-key.sh

set -euo pipefail
cd "$(dirname "$0")/../.."

WRAPPER_PATH="/usr/local/bin/agentos-audit-wrapper.sh"

PUBKEY=$(docker compose -f docker-compose.dev.yml exec -T backend \
    cat /data/infra_keys/infra-dev-target/id_ed25519.pub)

printf 'restrict,command="%s" %s\n' "$WRAPPER_PATH" "$PUBKEY" \
    > scripts/infra-dev/authorized_keys

echo "scripts/infra-dev/authorized_keys actualizado."

docker compose -f docker-compose.dev.yml exec -T backend \
    uv run python3 -c "from agentos.api.infra_targets import _build_wrapper_script; print(_build_wrapper_script(), end='')" \
    | docker compose -f docker-compose.dev.yml exec -T -u root infra-dev-target \
        sh -c "cat > ${WRAPPER_PATH} && chmod 755 ${WRAPPER_PATH}"

echo "Wrapper de auditoría instalado en infra-dev-target (${WRAPPER_PATH})."
