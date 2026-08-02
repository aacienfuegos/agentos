"""Tests for InfraMapRunner: extraction validation and DB replace-on-refresh."""
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError
from sqlmodel import Session, select

from agentos.config import settings
from agentos.models import InfraLink, InfraNetwork, InfraNode, InfraService, Run
from agentos.runner.infra_map import ExtractionResult, InfraMapRunner, _apply_extraction


_SAMPLE = {
    "networks": [{"id": "net-servers", "name": "Servers", "vlan_tag": 20, "subnet": "192.0.2.0/24"}],
    "nodes": [
        {"id": "node-host", "name": "proxmox-host", "node_type": "host", "network_id": "net-servers"},
        {"id": "node-vm", "name": "home-assistant", "node_type": "vm", "parent_id": "node-host", "network_id": "net-servers"},
    ],
    "services": [{"id": "svc-traefik", "name": "traefik", "node_id": "node-host", "category": "network"}],
    "links": [{"source_node_id": "node-host", "target_node_id": "node-vm", "kind": "hosts", "label": ""}],
}


def test_extraction_result_rejects_invalid_json():
    with pytest.raises(ValidationError):
        ExtractionResult.model_validate({"networks": "not-a-list"})


def test_extraction_result_defaults_to_empty():
    result = ExtractionResult.model_validate({})
    assert result.networks == []
    assert result.nodes == []
    assert result.services == []
    assert result.links == []


def test_apply_extraction_resolves_relationships(test_session: Session):
    result = ExtractionResult.model_validate(_SAMPLE)
    counts = _apply_extraction(result)

    assert counts.network_count == 1
    assert counts.node_count == 2
    assert counts.service_count == 1
    assert counts.link_count == 1

    nodes = {n.name: n for n in test_session.exec(select(InfraNode)).all()}
    assert nodes["home-assistant"].parent_id == nodes["proxmox-host"].id
    network = test_session.exec(select(InfraNetwork)).first()
    assert nodes["proxmox-host"].network_id == network.id


def test_apply_extraction_skips_link_with_unknown_node():
    data = {
        "networks": [],
        "nodes": [{"id": "node-a", "name": "a"}],
        "services": [],
        "links": [{"source_node_id": "node-a", "target_node_id": "node-missing", "kind": "x"}],
    }
    counts = _apply_extraction(ExtractionResult.model_validate(data))
    assert counts.link_count == 0


def test_apply_extraction_replaces_previous_data(test_session: Session):
    _apply_extraction(ExtractionResult.model_validate(_SAMPLE))
    assert len(test_session.exec(select(InfraNode)).all()) == 2

    smaller = {"networks": [], "nodes": [{"id": "node-only", "name": "solo"}], "services": [], "links": []}
    _apply_extraction(ExtractionResult.model_validate(smaller))

    remaining = test_session.exec(select(InfraNode)).all()
    assert len(remaining) == 1
    assert remaining[0].name == "solo"
    assert test_session.exec(select(InfraNetwork)).all() == []
    assert test_session.exec(select(InfraService)).all() == []
    assert test_session.exec(select(InfraLink)).all() == []


@pytest.mark.asyncio
async def test_runner_raises_without_docs_path_configured(monkeypatch):
    monkeypatch.setattr(settings, "infra_map_docs_path", "")
    run = Run(agent_id="__infra_map__", run_type="infra_map")
    with pytest.raises(ValueError):
        await InfraMapRunner().run(run)


@pytest.mark.asyncio
async def test_runner_fails_when_agent_writes_no_file(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "infra_map_docs_path", "/data/homelab-docs")
    monkeypatch.setattr(settings, "infra_map_work_path", str(tmp_path))

    with patch("agentos.runner.infra_map.ClaudeCodeRunner") as MockRunner:
        MockRunner.return_value.run = AsyncMock(return_value=None)
        run = Run(agent_id="__infra_map__", run_type="infra_map")
        with pytest.raises(RuntimeError):
            await InfraMapRunner().run(run)


@pytest.mark.asyncio
async def test_runner_applies_extraction_written_by_agent(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "infra_map_docs_path", "/data/homelab-docs")
    monkeypatch.setattr(settings, "infra_map_work_path", str(tmp_path))

    async def _fake_run(_run, _agent, cwd=None, **_kwargs):
        (Path(cwd) / "extraction.json").write_text(json.dumps(_SAMPLE))
        return None

    with patch("agentos.runner.infra_map.ClaudeCodeRunner") as MockRunner:
        MockRunner.return_value.run = AsyncMock(side_effect=_fake_run)
        run = Run(agent_id="__infra_map__", run_type="infra_map")
        result = await InfraMapRunner().run(run)

    assert result.node_count == 2
    assert result.link_count == 1
