from datetime import datetime
from enum import Enum
from typing import Any
import uuid

from sqlmodel import SQLModel, Field, Column
from sqlalchemy import JSON, Text


class RunStatus(str, Enum):
    pending = "pending"
    running = "running"
    success = "success"
    failed = "failed"
    cancelled = "cancelled"


class AgentDefinition(SQLModel, table=True):
    __tablename__ = "agent_definitions"

    id: str = Field(primary_key=True)  # slug, e.g. "code-review"
    name: str
    description: str
    system_prompt: str
    tools: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    model: str = "claude-sonnet-4-6"
    max_tokens: int = 4096
    timeout_seconds: int = 300
    is_builtin: bool = False
    knowledge_base_id: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Schedule(SQLModel, table=True):
    __tablename__ = "schedules"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    agent_id: str = Field(foreign_key="agent_definitions.id")
    name: str
    cron_expression: str
    input_params: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    enabled: bool = True
    last_run_at: datetime | None = None
    next_run_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Run(SQLModel, table=True):
    __tablename__ = "runs"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    agent_id: str = Field(foreign_key="agent_definitions.id")
    schedule_id: str | None = None
    status: RunStatus = RunStatus.pending
    triggered_by: str = "manual"  # "manual" | "schedule" | "api"
    run_type: str = "agent"       # "agent" | "chat" | "knowledge" | "execute"
    input_params: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    output: str | None = None
    error: str | None = None
    tokens_input: int | None = None
    tokens_output: int | None = None
    tokens_cache_read: int | None = None
    tokens_cache_write: int | None = None
    cost_usd: float | None = None
    session_id: str | None = None  # Claude CLI session id, para --resume en knowledge agents
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class KnowledgeBase(SQLModel, table=True):
    __tablename__ = "knowledge_bases"

    id: str = Field(primary_key=True)  # slug, e.g. "homelab"
    name: str
    description: str = ""
    knowledge_path: str = ""
    instructions: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ApiKey(SQLModel, table=True):
    __tablename__ = "api_keys"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    name: str
    key_hash: str = Field(index=True)  # SHA-256 hex — never store raw key
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_used_at: datetime | None = None
    enabled: bool = True


class InfraTarget(SQLModel, table=True):
    __tablename__ = "infra_targets"

    id: str = Field(primary_key=True)  # slug, e.g. "homelab-dev"
    name: str
    host: str
    ssh_user: str
    ssh_port: int = 22
    notes: str = ""
    # TOFU: rellenos por POST /api/infra-targets/{id}/verify-host (ssh-keyscan),
    # nunca por el CRUD directo. known_hosts_entry es la línea literal que se
    # materializa como UserKnownHostsFile en tiempo de ejecución del run.
    known_hosts_entry: str | None = Field(default=None, sa_column=Column(Text))
    host_key_fingerprint: str | None = None
    # Keypair ed25519 dedicado por target, generado automáticamente en
    # POST /api/infra-targets (ver api/infra_targets.py::_generate_keypair).
    # La privada nunca toca la DB ni el repo — vive en
    # settings.infra_keys_path/{id}/id_ed25519, en el volumen /data que ya
    # comparten backend y worker. Una clave por host (no una compartida)
    # acota el blast radius: comprometer un host no compromete el resto de
    # la flota, y se puede revocar uno solo sin rotar en los demás.
    ssh_public_key: str | None = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class LogEntry(SQLModel, table=True):
    __tablename__ = "log_entries"

    id: int | None = Field(default=None, primary_key=True)
    run_id: str = Field(foreign_key="runs.id", index=True)
    level: str  # "info" | "tool_use" | "tool_result" | "error" | "done"
    message: str
    extra: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)
