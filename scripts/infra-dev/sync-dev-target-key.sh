#!/usr/bin/env bash
# Prepara el InfraTarget "infra-dev-target" para pruebas locales de
# infra-architect: sincroniza su authorized_keys estático (bind mount de
# solo lectura, no se puede actualizar desde dentro del contenedor backend)
# con la clave pública que AgentOS genera dinámicamente, e instala en el
# contenedor el sudoers.d que decide qué comandos puede ejecutar el agente
# (mismo mecanismo que se documenta para hosts reales en setup-commands).
#
# Uso: crea primero el target "infra-dev-target" desde la UI o la API, luego:
#   ./scripts/infra-dev/sync-dev-target-key.sh

set -euo pipefail
cd "$(dirname "$0")/../.."

PUBKEY=$(docker compose -f docker-compose.dev.yml exec -T backend \
    cat /data/infra_keys/infra-dev-target/id_ed25519.pub)

printf 'command="sudo -n -- $SSH_ORIGINAL_COMMAND",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty %s\n' \
    "$PUBKEY" > scripts/infra-dev/authorized_keys

echo "scripts/infra-dev/authorized_keys actualizado."

# Alpine (imagen linuxserver/openssh-server) no trae docker/systemd/journald,
# así que el allowlist aquí es un subconjunto del de producción.
docker compose -f docker-compose.dev.yml exec -T -u root infra-dev-target sh -c '
cat > /tmp/agentos-infra-sudoers <<EOF
Cmnd_Alias AGENTOS_DIAG = /usr/bin/uptime, /bin/uname -a, /bin/df -h, /usr/bin/free -h, /sbin/ip a
agentos ALL=(root) NOPASSWD: AGENTOS_DIAG
EOF
visudo -cf /tmp/agentos-infra-sudoers
install -o root -g root -m 440 /tmp/agentos-infra-sudoers /etc/sudoers.d/agentos-infra
rm /tmp/agentos-infra-sudoers
'

echo "sudoers instalado en infra-dev-target."
