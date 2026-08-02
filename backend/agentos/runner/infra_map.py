"""
InfraMapRunner — extrae InfraNetwork/InfraNode/InfraService/InfraLink desde
un directorio de documentación de infraestructura montado read-only.

Usa el CLI `claude` (Claude Pro, sin coste extra de API — ver AGENTS.md), no
el SDK `anthropic`. El agente lee los markdown con Read/Glob/Grep y escribe
el resultado estructurado en un fichero JSON dentro de su propio directorio
de trabajo (nunca dentro del mount `:ro` de documentación).
"""
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

from pydantic import BaseModel, ValidationError
from sqlmodel import Session, delete

from ..config import settings
from ..database import engine
from ..models import InfraLink, InfraNetwork, InfraNode, InfraService, Run
from .claude_code import ClaudeCodeRunner

logger = logging.getLogger(__name__)

INFRA_MAP_AGENT_ID = "__infra_map__"
_EXTRACTION_FILENAME = "extraction.json"


class _ExtractionNetwork(BaseModel):
    id: str
    name: str
    vlan_tag: int | None = None
    subnet: str = ""
    gateway: str = ""
    location: str = ""


class _ExtractionNode(BaseModel):
    id: str
    name: str
    node_type: str = ""
    location: str = ""
    parent_id: str | None = None
    network_id: str | None = None
    ip_local: str = ""
    ip_tailscale: str = ""
    role: str = ""
    status: str = ""
    source_files: list[str] = []


class _ExtractionService(BaseModel):
    id: str
    name: str
    node_id: str | None = None
    category: str = ""
    description: str = ""
    domain: str = ""
    source_files: list[str] = []


class _ExtractionLink(BaseModel):
    source_node_id: str
    target_node_id: str
    kind: str = ""
    label: str = ""


class ExtractionResult(BaseModel):
    networks: list[_ExtractionNetwork] = []
    nodes: list[_ExtractionNode] = []
    services: list[_ExtractionService] = []
    links: list[_ExtractionLink] = []


@dataclass
class _InfraMapAgentProxy:
    id: str = INFRA_MAP_AGENT_ID
    system_prompt: str = ""
    model: str = "claude-sonnet-4-6"
    tools: list[str] = field(default_factory=lambda: ["Read", "Glob", "Grep", "Write"])


def _build_system_prompt(docs_path: str, extraction_path: str) -> str:
    schema = {
        "networks": [{"id": "local-id", "name": "str", "vlan_tag": "int|null", "subnet": "str", "gateway": "str", "location": "str"}],
        "nodes": [{"id": "local-id", "name": "str", "node_type": "host|vm|lxc|device", "location": "str", "parent_id": "local-id|null", "network_id": "local-id|null", "ip_local": "str", "ip_tailscale": "str", "role": "str", "status": "str", "source_files": ["ruta relativa al fichero origen"]}],
        "services": [{"id": "local-id", "name": "str", "node_id": "local-id|null", "category": "str", "description": "str", "domain": "str", "source_files": ["ruta relativa"]}],
        "links": [{"source_node_id": "local-id", "target_node_id": "local-id", "kind": "proxies_to|tailscale|firewall_allow|firewall_block|...", "label": "str"}],
    }
    return (
        "Eres un extractor de datos estructurados de infraestructura. "
        f"La documentación está en `{docs_path}` (montado solo lectura — no la modifiques). "
        "Lee todos los ficheros markdown relevantes con Read/Glob/Grep: hosts físicos, "
        "VMs/LXCs, VLANs/redes, servicios y relaciones de red (proxy inverso, túneles, "
        "reglas de firewall entre redes, flujo de tráfico). "
        "Los ids de este JSON son locales al documento (inventa slugs legibles, ej. "
        "'node-madrid-proxmox') — no son UUIDs reales, el sistema los resuelve después. "
        "Cuando termines, escribe ÚNICAMENTE el JSON final (sin explicación adicional) "
        f"con la herramienta Write en la ruta absoluta EXACTA `{extraction_path}` — "
        "usa esa ruta absoluta literal, no una relativa ni ninguna otra ubicación "
        "(ej. tu directorio home) — con exactamente este shape:\n\n"
        f"{json.dumps(schema, ensure_ascii=False, indent=2)}\n\n"
        "Si un documento no menciona algún campo, usa el valor por defecto (string vacío, "
        "null o lista vacía) — no inventes datos que no estén en la documentación."
    )


@dataclass
class InfraMapExtractionResult:
    network_count: int
    node_count: int
    service_count: int
    link_count: int


class InfraMapRunner:
    def __init__(self, redis_url: str | None = None):
        self._redis_url = redis_url or settings.redis_url

    async def run(self, run: Run) -> InfraMapExtractionResult:
        if not settings.infra_map_docs_path:
            raise ValueError("settings.infra_map_docs_path is not configured")

        work_dir = Path(settings.infra_map_work_path)
        work_dir.mkdir(parents=True, exist_ok=True)
        extraction_path = work_dir / _EXTRACTION_FILENAME
        extraction_path.unlink(missing_ok=True)

        agent = _InfraMapAgentProxy(
            system_prompt=_build_system_prompt(settings.infra_map_docs_path, str(extraction_path))
        )
        runner = ClaudeCodeRunner(redis_url=self._redis_url)
        await runner.run(run, agent, cwd=str(work_dir))

        if not extraction_path.exists():
            raise RuntimeError("El agente no generó extraction.json")

        raw = extraction_path.read_text(encoding="utf-8")
        try:
            data = ExtractionResult.model_validate_json(raw)
        except ValidationError as e:
            raise ValueError(f"JSON de extracción inválido: {e}") from e

        return _apply_extraction(data)


def _apply_extraction(data: ExtractionResult) -> InfraMapExtractionResult:
    with Session(engine) as session:
        # Reemplazo completo: estas tablas son una cache derivada del
        # markdown, no la fuente de verdad — no hace falta reconciliar
        # entidades renombradas/movidas entre refreshes (ver
        # docs/infra-platform-design.md §2).
        session.exec(delete(InfraLink))
        session.exec(delete(InfraService))
        session.exec(delete(InfraNode))
        session.exec(delete(InfraNetwork))
        session.flush()

        network_id_map: dict[str, str] = {}
        for net in data.networks:
            row = InfraNetwork(
                name=net.name,
                vlan_tag=net.vlan_tag,
                subnet=net.subnet,
                gateway=net.gateway,
                location=net.location,
            )
            session.add(row)
            session.flush()
            network_id_map[net.id] = row.id

        node_id_map: dict[str, str] = {}
        node_rows: dict[str, InfraNode] = {}
        for node in data.nodes:
            row = InfraNode(
                name=node.name,
                node_type=node.node_type,
                location=node.location,
                ip_local=node.ip_local,
                ip_tailscale=node.ip_tailscale,
                role=node.role,
                status=node.status,
                source_files=node.source_files,
                network_id=network_id_map.get(node.network_id) if node.network_id else None,
            )
            session.add(row)
            session.flush()
            node_id_map[node.id] = row.id
            node_rows[node.id] = row

        for node in data.nodes:
            if node.parent_id:
                node_rows[node.id].parent_id = node_id_map.get(node.parent_id)
                session.add(node_rows[node.id])

        service_count = 0
        for svc in data.services:
            session.add(InfraService(
                name=svc.name,
                node_id=node_id_map.get(svc.node_id) if svc.node_id else None,
                category=svc.category,
                description=svc.description,
                domain=svc.domain,
                source_files=svc.source_files,
            ))
            service_count += 1

        link_count = 0
        for link in data.links:
            source_id = node_id_map.get(link.source_node_id)
            target_id = node_id_map.get(link.target_node_id)
            if not source_id or not target_id:
                logger.warning("Skipping infra link with unknown node id: %s -> %s", link.source_node_id, link.target_node_id)
                continue
            session.add(InfraLink(
                source_node_id=source_id,
                target_node_id=target_id,
                kind=link.kind,
                label=link.label,
            ))
            link_count += 1

        session.commit()

        return InfraMapExtractionResult(
            network_count=len(network_id_map),
            node_count=len(node_id_map),
            service_count=service_count,
            link_count=link_count,
        )
