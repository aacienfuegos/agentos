import asyncio
import shlex
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..config import settings
from ..database import get_session
from ..models import InfraTarget

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]

# Comandos que suelen necesitar privilegio en un host recién provisionado —
# semilla por defecto de InfraTarget.sudo_commands, editable después por
# target. "docker ps" es el caso canónico: la alternativa sería meter al
# usuario en el grupo docker, que equivale a darle root (el grupo puede
# montar el filesystem del host vía un contenedor). Todo lo demás (uptime,
# df -h, free -h, ip a, uname -a...) corre en el scope normal del usuario,
# sin necesitar estar aquí ni en sudoers.
_DEFAULT_SUDO_COMMANDS = [
    "/usr/bin/docker ps",
    "/usr/bin/docker ps -a",
    "/usr/bin/journalctl --no-pager -n 100",
]


def _key_dir(target_id: str) -> Path:
    return Path(settings.infra_keys_path) / target_id


def _generate_keypair(target_id: str) -> str:
    """Genera un keypair ed25519 dedicado para este target y devuelve la
    pública. Nunca se reutiliza entre targets — así comprometer un host no
    da acceso al resto de la flota (ver comentario en models.InfraTarget)."""
    key_dir = _key_dir(target_id)
    key_dir.mkdir(parents=True, exist_ok=True)
    priv_path = key_dir / "id_ed25519"
    pub_path = key_dir / "id_ed25519.pub"
    priv_path.unlink(missing_ok=True)
    pub_path.unlink(missing_ok=True)
    try:
        subprocess.run(
            ["ssh-keygen", "-t", "ed25519", "-N", "", "-C", f"agentos-infra-{target_id}", "-f", str(priv_path)],
            check=True, capture_output=True,
        )
    except (subprocess.CalledProcessError, OSError) as e:
        raise HTTPException(500, f"No se pudo generar el keypair SSH: {e}")
    priv_path.chmod(0o600)
    return pub_path.read_text().strip()


def _build_setup_commands(target: InfraTarget) -> str:
    """Bloque de comandos para ejecutar A MANO en el host de destino — AgentOS
    nunca hace SSH a sus propios contenedores para esto (ver CLAUDE.md:
    provisión de usuario/clave en el host nuevo queda fuera del alcance
    automatizable, solo la parte del lado AgentOS se automatiza).

    Sin forced-command: el usuario SSH dedicado corre en su scope normal sin
    privilegios, sin restricción de qué comandos puede pedir por SSH — el
    límite real es lo que ese usuario Linux puede hacer. sudo solo entra
    para el subconjunto de sudo_commands que de verdad necesita privilegio."""
    user = shlex.quote(target.ssh_user)
    home = f"/home/{target.ssh_user}"
    sudo_block = ""
    if target.sudo_commands:
        cmnd_alias = ", ".join(target.sudo_commands)
        sudo_block = f"""
# 3. Autorizar SOLO estos comandos concretos vía sudo — todo lo demás el
#    agente lo ejecuta directamente en el scope normal de {target.ssh_user},
#    sin privilegios. Validado con visudo antes de instalar, para no dejar
#    sudoers roto. Ajusta rutas si tu distro las tiene en otro sitio
#    (`which docker`).
cat <<'EOF' > /tmp/agentos-infra-sudoers
Cmnd_Alias AGENTOS_SUDO = {cmnd_alias}
{target.ssh_user} ALL=(root) NOPASSWD: AGENTOS_SUDO
EOF
sudo visudo -cf /tmp/agentos-infra-sudoers
sudo install -o root -g root -m 440 /tmp/agentos-infra-sudoers /etc/sudoers.d/agentos-infra
rm /tmp/agentos-infra-sudoers
"""
    return f"""# Ejecutar en el host de destino ({target.host}), no en AgentOS.

# 1. Crear el usuario dedicado (si no existe)
sudo useradd -m -s /bin/bash {user} 2>/dev/null || true

# 2. Preparar ~/.ssh
sudo -u {user} mkdir -p {home}/.ssh
sudo chmod 700 {home}/.ssh
{sudo_block}
# {"4" if sudo_block else "3"}. Instalar la clave pública — sin forced-command,
#    el agente opera en el scope normal de {user} (sin privilegios); solo se
#    restringen capacidades de canal SSH que no necesita.
echo 'no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty {target.ssh_public_key}' | sudo tee -a {home}/.ssh/authorized_keys > /dev/null
sudo chmod 600 {home}/.ssh/authorized_keys
sudo chown {user}:{user} {home}/.ssh/authorized_keys
"""


class InfraTargetCreate(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$")
    name: str = Field(min_length=1, max_length=200)
    host: str = Field(min_length=1, max_length=255)
    ssh_user: str = Field(min_length=1, max_length=64)
    ssh_port: int = Field(default=22, ge=1, le=65535)
    notes: str = Field(default="", max_length=2000)
    sudo_commands: list[str] | None = None


class InfraTargetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    host: str | None = Field(default=None, min_length=1, max_length=255)
    ssh_user: str | None = Field(default=None, min_length=1, max_length=64)
    ssh_port: int | None = Field(default=None, ge=1, le=65535)
    notes: str | None = Field(default=None, max_length=2000)
    sudo_commands: list[str] | None = None


@router.get("")
def list_infra_targets(session: SessionDep) -> list[InfraTarget]:
    return session.exec(select(InfraTarget)).all()


@router.post("", status_code=201)
def create_infra_target(data: InfraTargetCreate, session: SessionDep) -> InfraTarget:
    if session.get(InfraTarget, data.id):
        raise HTTPException(400, f"Infra target '{data.id}' already exists")
    target = InfraTarget(**data.model_dump(exclude={"sudo_commands"}))
    target.sudo_commands = data.sudo_commands if data.sudo_commands is not None else list(_DEFAULT_SUDO_COMMANDS)
    target.ssh_public_key = _generate_keypair(target.id)
    session.add(target)
    session.commit()
    session.refresh(target)
    return target


@router.get("/{target_id}")
def get_infra_target(target_id: str, session: SessionDep) -> InfraTarget:
    target = session.get(InfraTarget, target_id)
    if not target:
        raise HTTPException(404, "Infra target not found")
    return target


@router.put("/{target_id}")
def update_infra_target(target_id: str, data: InfraTargetUpdate, session: SessionDep) -> InfraTarget:
    target = session.get(InfraTarget, target_id)
    if not target:
        raise HTTPException(404, "Infra target not found")
    for field_name, value in data.model_dump(exclude_none=True).items():
        setattr(target, field_name, value)
    target.updated_at = datetime.utcnow()
    session.add(target)
    session.commit()
    session.refresh(target)
    return target


@router.delete("/{target_id}", status_code=204)
def delete_infra_target(target_id: str, session: SessionDep) -> None:
    target = session.get(InfraTarget, target_id)
    if not target:
        raise HTTPException(404, "Infra target not found")
    session.delete(target)
    session.commit()
    shutil.rmtree(_key_dir(target_id), ignore_errors=True)


@router.get("/{target_id}/setup-commands")
def get_infra_target_setup_commands(target_id: str, session: SessionDep) -> dict[str, str]:
    """Comandos para provisionar el lado del host — la única parte que sigue
    siendo manual por diseño (ver CLAUDE.md, decisión del propietario)."""
    target = session.get(InfraTarget, target_id)
    if not target:
        raise HTTPException(404, "Infra target not found")
    if not target.ssh_public_key:
        raise HTTPException(400, "El target no tiene una clave SSH generada")
    return {"commands": _build_setup_commands(target)}


@router.post("/{target_id}/verify-host")
async def verify_infra_target_host(target_id: str, session: SessionDep) -> InfraTarget:
    """Fija (TOFU) la host key del target vía ssh-keyscan. Se guarda en la DB
    para materializarse como UserKnownHostsFile en cada run — así añadir un
    host nuevo no requiere editar ssh_config ni entrar por SSH a los
    contenedores de AgentOS, solo pegar host/puerto/usuario y verificar aquí."""
    target = session.get(InfraTarget, target_id)
    if not target:
        raise HTTPException(404, "Infra target not found")

    try:
        proc = await asyncio.create_subprocess_exec(
            "ssh-keyscan", "-T", "5", "-p", str(target.ssh_port), target.host,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
    except asyncio.TimeoutError:
        raise HTTPException(504, "Timeout esperando la host key del target")

    known_hosts_entry = stdout.decode().strip()
    if not known_hosts_entry:
        detail = stderr.decode().strip() or "sin respuesta del host"
        raise HTTPException(502, f"No se pudo obtener la host key: {detail}")

    fp_proc = await asyncio.create_subprocess_exec(
        "ssh-keygen", "-lf", "-",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    fp_stdout, _ = await fp_proc.communicate(input=stdout)

    target.known_hosts_entry = known_hosts_entry
    target.host_key_fingerprint = fp_stdout.decode().strip()
    target.updated_at = datetime.utcnow()
    session.add(target)
    session.commit()
    session.refresh(target)
    return target
