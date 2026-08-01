#!/usr/bin/env bash
# Sincroniza scripts/infra-dev/authorized_keys con la clave pública que
# AgentOS genera automáticamente para el InfraTarget "infra-dev-target" al
# crearlo (POST /api/infra-targets). El contenedor infra-dev-target monta ese
# fichero de solo lectura, así que no puede actualizarse desde dentro — hay
# que escribirlo aquí, en el host.
#
# Uso: crea primero el target "infra-dev-target" desde la UI o la API, luego:
#   ./scripts/infra-dev/sync-dev-target-key.sh

set -euo pipefail
cd "$(dirname "$0")/../.."

PUBKEY=$(docker compose -f docker-compose.dev.yml exec -T backend \
    cat /data/infra_keys/infra-dev-target/id_ed25519.pub)

printf 'command="/config/allowed-commands.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty %s\n' \
    "$PUBKEY" > scripts/infra-dev/authorized_keys

echo "scripts/infra-dev/authorized_keys actualizado."
