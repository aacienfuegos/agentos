import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..database import get_session
from ..models import ApiKey

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]

_DEBOUNCE_MINUTES = 5


def _generate_key() -> tuple[str, str]:
    raw = "sk-agentos-" + secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    return raw, key_hash


def verify_api_key(raw_key: str, session: Session) -> ApiKey | None:
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    key = session.exec(select(ApiKey).where(ApiKey.key_hash == key_hash, ApiKey.enabled == True)).first()
    if not key:
        return None
    now = datetime.utcnow()
    if key.last_used_at is None or now - key.last_used_at > timedelta(minutes=_DEBOUNCE_MINUTES):
        key.last_used_at = now
        session.add(key)
        session.commit()
    return key


class ApiKeyCreate(BaseModel):
    name: str


class ApiKeyPublic(BaseModel):
    id: str
    name: str
    created_at: datetime
    last_used_at: datetime | None
    enabled: bool

    model_config = {"from_attributes": True}


class ApiKeyCreated(ApiKeyPublic):
    raw_key: str  # shown only once at creation


@router.post("", status_code=201)
def create_api_key(data: ApiKeyCreate, session: SessionDep) -> ApiKeyCreated:
    raw, key_hash = _generate_key()
    key = ApiKey(name=data.name, key_hash=key_hash)
    session.add(key)
    session.commit()
    session.refresh(key)
    return ApiKeyCreated(
        id=key.id,
        name=key.name,
        created_at=key.created_at,
        last_used_at=key.last_used_at,
        enabled=key.enabled,
        raw_key=raw,
    )


@router.get("")
def list_api_keys(session: SessionDep) -> list[ApiKeyPublic]:
    keys = session.exec(select(ApiKey).order_by(ApiKey.created_at.desc())).all()
    return [ApiKeyPublic.model_validate(k) for k in keys]


@router.delete("/{key_id}", status_code=204)
def delete_api_key(key_id: str, session: SessionDep) -> None:
    key = session.get(ApiKey, key_id)
    if not key:
        raise HTTPException(404, "API key not found")
    session.delete(key)
    session.commit()
