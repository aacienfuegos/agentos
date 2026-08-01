"""Tests for /api/infra-targets CRUD endpoints."""
import asyncio
from unittest.mock import patch

from fastapi.testclient import TestClient


TARGET_PAYLOAD = {
    "id": "test-target",
    "name": "Test Target",
    "host": "test-target.internal",
    "ssh_user": "agentos",
    "ssh_port": 2222,
    "notes": "Dev target for testing",
}


def test_list_infra_targets_empty(app_client: TestClient):
    response = app_client.get("/api/infra-targets")
    assert response.status_code == 200
    assert response.json() == []


def test_create_infra_target(app_client: TestClient):
    response = app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    assert response.status_code == 201
    data = response.json()
    assert data["id"] == "test-target"
    assert data["name"] == "Test Target"
    assert data["host"] == "test-target.internal"
    assert data["ssh_port"] == 2222


def test_create_infra_target_generates_dedicated_ssh_keypair(app_client: TestClient):
    """Cada target debe recibir su propio keypair — nunca uno compartido —
    para acotar el blast radius si un host se ve comprometido."""
    response = app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    pubkey = response.json()["ssh_public_key"]
    assert pubkey is not None
    assert pubkey.startswith("ssh-ed25519 ")
    assert "agentos-infra-test-target" in pubkey


def test_regenerate_infra_target_key(app_client: TestClient):
    """La clave vieja deja de ser la vigente tras regenerar — el target debe
    apuntar a un keypair distinto, no al mismo."""
    created = app_client.post("/api/infra-targets", json=TARGET_PAYLOAD).json()
    old_pubkey = created["ssh_public_key"]

    response = app_client.post("/api/infra-targets/test-target/regenerate-key")
    assert response.status_code == 200
    new_pubkey = response.json()["ssh_public_key"]
    assert new_pubkey != old_pubkey
    assert new_pubkey.startswith("ssh-ed25519 ")

    # Persistido, no solo devuelto en la respuesta
    get_resp = app_client.get("/api/infra-targets/test-target")
    assert get_resp.json()["ssh_public_key"] == new_pubkey


def test_regenerate_infra_target_key_not_found(app_client: TestClient):
    response = app_client.post("/api/infra-targets/nonexistent/regenerate-key")
    assert response.status_code == 404


def test_delete_infra_target_removes_ssh_keys(app_client: TestClient):
    from pathlib import Path
    from agentos.config import settings

    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    key_dir = Path(settings.infra_keys_path) / "test-target"
    assert key_dir.exists()

    app_client.delete("/api/infra-targets/test-target")
    assert not key_dir.exists()


def test_create_infra_target_seeds_default_sudo_commands(app_client: TestClient):
    """Sin especificar sudo_commands, el target debe recibir una lista por
    defecto útil (editable después por-host), no quedarse vacío."""
    response = app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    commands = response.json()["sudo_commands"]
    assert len(commands) > 0
    assert "/usr/bin/docker ps" in commands


def test_create_infra_target_custom_sudo_commands(app_client: TestClient):
    """Cada host puede necesitar un subconjunto distinto de comandos con sudo."""
    payload = {**TARGET_PAYLOAD, "sudo_commands": ["/usr/bin/docker ps"]}
    response = app_client.post("/api/infra-targets", json=payload)
    assert response.json()["sudo_commands"] == ["/usr/bin/docker ps"]


def test_get_infra_target_setup_commands(app_client: TestClient):
    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    response = app_client.get("/api/infra-targets/test-target/setup-commands")
    assert response.status_code == 200
    commands = response.json()["commands"]
    assert "useradd" in commands
    assert "authorized_keys" in commands
    assert "ssh-ed25519 " in commands
    # Permisos vía sudoers (validado con visudo antes de instalar) solo para
    # el subconjunto que necesita privilegio — el resto corre en el scope
    # normal del usuario, filtrado solo por el wrapper de auditoría+denylist.
    assert "Cmnd_Alias AGENTOS_SUDO" in commands
    assert "visudo -cf" in commands
    assert "/etc/sudoers.d/agentos-infra" in commands
    assert "/usr/bin/docker ps" in commands
    # Wrapper: forced-command con restrict, NO un allowlist — audita
    # (logger/syslog, nunca un fichero propio) y bloquea una denylist.
    assert 'restrict,command="/usr/local/bin/agentos-audit-wrapper.sh"' in commands
    assert "logger -t agentos-ssh" in commands
    assert "BLOCKED: patron destructivo detectado" in commands
    assert "from=" not in commands  # sin AGENTOS_SOURCE_IP configurado
    # ~/.ssh y authorized_keys deben ser root:root, NUNCA del propio usuario
    # SSH — si no, el usuario puede borrar/recrear su propia authorized_keys
    # en una sesión normal y anular restrict/command= para conexiones
    # futuras (el permiso de borrar/crear depende del directorio, no del
    # fichero, así que ambos tienen que quedar fuera de su propiedad).
    assert "chown root:root" in commands
    assert "chown agentos" not in commands
    assert f"chown {TARGET_PAYLOAD['ssh_user']}:{TARGET_PAYLOAD['ssh_user']}" not in commands


def test_get_infra_target_setup_commands_with_source_ip(app_client: TestClient):
    """Con AGENTOS_SOURCE_IP configurado, la línea de authorized_keys
    restringe también desde qué IP puede usarse la clave."""
    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    with patch("agentos.api.infra_targets.settings.agentos_source_ip", "10.0.0.5"):
        response = app_client.get("/api/infra-targets/test-target/setup-commands")
    commands = response.json()["commands"]
    assert 'from="10.0.0.5",restrict,command=' in commands


def test_get_infra_target_setup_commands_no_sudo_commands(app_client: TestClient):
    """Sin sudo_commands configurados no se instala sudoers en absoluto — el
    usuario simplemente corre en su scope normal, con el wrapper de
    auditoría+denylist como única capa (no un allowlist)."""
    payload = {**TARGET_PAYLOAD, "sudo_commands": []}
    app_client.post("/api/infra-targets", json=payload)
    response = app_client.get("/api/infra-targets/test-target/setup-commands")
    assert response.status_code == 200
    commands = response.json()["commands"]
    assert "sudoers" not in commands
    assert "authorized_keys" in commands
    assert "agentos-audit-wrapper.sh" in commands


def test_get_infra_target_setup_commands_not_found(app_client: TestClient):
    response = app_client.get("/api/infra-targets/nonexistent/setup-commands")
    assert response.status_code == 404


def test_create_infra_target_default_port(app_client: TestClient):
    payload = {k: v for k, v in TARGET_PAYLOAD.items() if k != "ssh_port"}
    response = app_client.post("/api/infra-targets", json=payload)
    assert response.status_code == 201
    assert response.json()["ssh_port"] == 22


def test_create_infra_target_duplicate(app_client: TestClient):
    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    response = app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    assert response.status_code == 400
    assert "already exists" in response.json()["detail"]


def test_list_infra_targets(app_client: TestClient):
    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    response = app_client.get("/api/infra-targets")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["id"] == "test-target"


def test_get_infra_target(app_client: TestClient):
    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    response = app_client.get("/api/infra-targets/test-target")
    assert response.status_code == 200
    assert response.json()["id"] == "test-target"


def test_get_infra_target_not_found(app_client: TestClient):
    response = app_client.get("/api/infra-targets/nonexistent")
    assert response.status_code == 404


def test_update_infra_target(app_client: TestClient):
    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    response = app_client.put(
        "/api/infra-targets/test-target",
        json={"notes": "Updated notes"},
    )
    assert response.status_code == 200
    assert response.json()["notes"] == "Updated notes"
    # Other fields unchanged
    assert response.json()["host"] == TARGET_PAYLOAD["host"]


def test_update_infra_target_not_found(app_client: TestClient):
    response = app_client.put("/api/infra-targets/nonexistent", json={"notes": "x"})
    assert response.status_code == 404


def test_delete_infra_target(app_client: TestClient):
    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    response = app_client.delete("/api/infra-targets/test-target")
    assert response.status_code == 204
    assert app_client.get("/api/infra-targets/test-target").status_code == 404


def test_delete_infra_target_not_found(app_client: TestClient):
    response = app_client.delete("/api/infra-targets/nonexistent")
    assert response.status_code == 404


def test_create_infra_target_invalid_port(app_client: TestClient):
    payload = {**TARGET_PAYLOAD, "ssh_port": 70000}
    response = app_client.post("/api/infra-targets", json=payload)
    assert response.status_code == 422


def test_create_infra_target_invalid_id(app_client: TestClient):
    payload = {**TARGET_PAYLOAD, "id": "Not A Valid Slug!"}
    response = app_client.post("/api/infra-targets", json=payload)
    assert response.status_code == 422


def test_create_infra_target_empty_host(app_client: TestClient):
    payload = {**TARGET_PAYLOAD, "host": ""}
    response = app_client.post("/api/infra-targets", json=payload)
    assert response.status_code == 422


def test_update_infra_target_invalid_port(app_client: TestClient):
    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)
    response = app_client.put("/api/infra-targets/test-target", json={"ssh_port": 0})
    assert response.status_code == 422


class _FakeProc:
    def __init__(self, stdout: bytes, stderr: bytes = b""):
        self._stdout = stdout
        self._stderr = stderr

    async def communicate(self, input: bytes | None = None):
        return self._stdout, self._stderr


def _fake_subprocess_exec(keyscan_stdout: bytes, keyscan_stderr: bytes = b""):
    async def _run(*args, **kwargs):
        if args[0] == "ssh-keyscan":
            return _FakeProc(keyscan_stdout, keyscan_stderr)
        if args[0] == "ssh-keygen":
            return _FakeProc(b"256 SHA256:testfingerprint test-target.internal (ED25519)\n")
        raise AssertionError(f"unexpected subprocess exec: {args}")
    return _run


def test_verify_host_not_found(app_client: TestClient):
    response = app_client.post("/api/infra-targets/nonexistent/verify-host")
    assert response.status_code == 404


def test_verify_host_success(app_client: TestClient):
    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)

    keyscan_line = b"test-target.internal ssh-ed25519 AAAAtest\n"
    with patch(
        "agentos.api.infra_targets.asyncio.create_subprocess_exec",
        side_effect=_fake_subprocess_exec(keyscan_line),
    ):
        response = app_client.post("/api/infra-targets/test-target/verify-host")

    assert response.status_code == 200
    data = response.json()
    assert data["known_hosts_entry"] == keyscan_line.decode().strip()
    assert data["host_key_fingerprint"] == "256 SHA256:testfingerprint test-target.internal (ED25519)"

    # Persisted, not just returned in the response
    get_resp = app_client.get("/api/infra-targets/test-target")
    assert get_resp.json()["host_key_fingerprint"] == data["host_key_fingerprint"]


def test_verify_host_no_response(app_client: TestClient):
    """ssh-keyscan returning nothing (host unreachable/closed port) must 502, not
    silently store an empty known_hosts entry."""
    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)

    with patch(
        "agentos.api.infra_targets.asyncio.create_subprocess_exec",
        side_effect=_fake_subprocess_exec(b"", b"connection refused"),
    ):
        response = app_client.post("/api/infra-targets/test-target/verify-host")

    assert response.status_code == 502
    get_resp = app_client.get("/api/infra-targets/test-target")
    assert get_resp.json()["known_hosts_entry"] is None


def test_verify_host_timeout(app_client: TestClient):
    app_client.post("/api/infra-targets", json=TARGET_PAYLOAD)

    async def _hang(*args, **kwargs):
        raise asyncio.TimeoutError

    with (
        patch("agentos.api.infra_targets.asyncio.create_subprocess_exec", side_effect=_fake_subprocess_exec(b"x")),
        patch("agentos.api.infra_targets.asyncio.wait_for", side_effect=_hang),
    ):
        response = app_client.post("/api/infra-targets/test-target/verify-host")

    assert response.status_code == 504
