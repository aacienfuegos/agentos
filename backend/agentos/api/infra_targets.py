from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..database import get_session
from ..models import InfraTarget

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]


class InfraTargetCreate(BaseModel):
    id: str
    name: str
    host: str
    ssh_user: str
    ssh_port: int = 22
    notes: str = ""


class InfraTargetUpdate(BaseModel):
    name: str | None = None
    host: str | None = None
    ssh_user: str | None = None
    ssh_port: int | None = None
    notes: str | None = None


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
