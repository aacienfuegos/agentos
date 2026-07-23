#!/bin/sh
# Forced-command wrapper instalado en /config/allowed-commands.sh dentro de
# infra-dev-target. Se referencia desde authorized_keys con command="...",
# así que SSH ignora lo que el cliente pida ejecutar y siempre corre esto,
# que decide si $SSH_ORIGINAL_COMMAND está en el allowlist de solo lectura.

set -eu

cmd="${SSH_ORIGINAL_COMMAND:-}"

case "$cmd" in
    "uptime"|\
    "uname -a"|\
    "df -h"|\
    "free -h"|\
    "ip a"|\
    "docker ps"|\
    "docker ps -a"|\
    "systemctl status"|\
    "journalctl --no-pager -n 100")
        exec $cmd
        ;;
    *)
        echo "agentos-infra: comando no permitido: $cmd" >&2
        exit 1
        ;;
esac
