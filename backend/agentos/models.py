from datetime import datetime
from enum import Enum
from typing import Any
import uuid

from sqlmodel import SQLModel, Field, Column
from sqlalchemy import JSON


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
    triggered_by: str = "manual"  # "manual" | "schedule" | "api" | "webhook"
    input_params: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    output: str | None = None
    error: str | None = None
    tokens_input: int | None = None
    tokens_output: int | None = None
    cost_usd: float | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class LogEntry(SQLModel, table=True):
    __tablename__ = "log_entries"

    id: int | None = Field(default=None, primary_key=True)
    run_id: str = Field(foreign_key="runs.id", index=True)
    level: str  # "info" | "tool_use" | "tool_result" | "error" | "done"
    message: str
    extra: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)
