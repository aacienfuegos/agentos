#!/usr/bin/env bash
# Genera un par de claves SSH dedicado para el agente infra-architect,
# separado de las claves personales del usuario. Nunca reutilizar ~/.ssh/id_*.
#
# Uso: ./gen-infra-keypair.sh
# Salida: scripts/infra-dev/keys/agentos_infra{,.pub} (gitignored)
#         scripts/infra-dev/authorized_keys (para el contenedor infra-dev-target)

set -euo pipefail

cd "$(dirname "$0")"

mkdir -p keys

if [ -f keys/agentos_infra ]; then
    echo "Ya existe scripts/infra-dev/keys/agentos_infra — no se sobreescribe."
    exit 0
fi

ssh-keygen -t ed25519 -N "" -C "agentos-infra-dev" -f keys/agentos_infra

printf 'command="/config/allowed-commands.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty %s\n' \
    "$(cat keys/agentos_infra.pub)" > authorized_keys

echo "Keypair generado en scripts/infra-dev/keys/"
echo "authorized_keys (con forced-command) escrito en scripts/infra-dev/authorized_keys"
