from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..database import get_session
from ..models import InfraTarget

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]


class InfraTargetCreate(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$")
    name: str = Field(min_length=1, max_length=200)
    host: str = Field(min_length=1, max_length=255)
    ssh_user: str = Field(min_length=1, max_length=64)
    ssh_port: int = Field(default=22, ge=1, le=65535)
    notes: str = Field(default="", max_length=2000)


class InfraTargetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    host: str | None = Field(default=None, min_length=1, max_length=255)
    ssh_user: str | None = Field(default=None, min_length=1, max_length=64)
    ssh_port: int | None = Field(default=None, ge=1, le=65535)
    notes: str | None = Field(default=None, max_length=2000)


@router.get("")
def list_infra_targets(session: SessionDep) -> list[InfraTarget]:
    return session.exec(select(InfraTarget)).all()


@router.post("", status_code=201)
def create_infra_target(data: InfraTargetCreate, session: SessionDep) -> InfraTarget:
    if session.get(InfraTarget, data.id):
        raise HTTPException(400, f"Infra target '{data.id}' already exists")
    target = InfraTarget(**data.model_dump())
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
