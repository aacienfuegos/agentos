from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Response, Cookie
from jose import jwt, JWTError
from passlib.context import CryptContext
from pydantic import BaseModel

from ..config import settings

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 7

# Cached hash computed once at startup
_PASSWORD_HASH: str | None = None


def _get_password_hash() -> str:
    global _PASSWORD_HASH
    if _PASSWORD_HASH is None:
        _PASSWORD_HASH = pwd_context.hash(settings.admin_password)
    return _PASSWORD_HASH


def _create_token() -> str:
    expire = datetime.utcnow() + timedelta(days=JWT_EXPIRE_DAYS)
    return jwt.encode({"sub": "admin", "exp": expire}, settings.secret_key, algorithm=JWT_ALGORITHM)


def verify_token(token: str | None) -> bool:
    if not token:
        return False
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[JWT_ALGORITHM])
        return payload.get("sub") == "admin"
    except JWTError:
        return False


class LoginRequest(BaseModel):
    password: str


@router.post("/login")
def login(request: LoginRequest, response: Response):
    if not pwd_context.verify(request.password, _get_password_hash()):
        # fallback: plain comparison for dev convenience
        if request.password != settings.admin_password:
            raise HTTPException(401, "Invalid password")
    token = _create_token()
    response.set_cookie(
        key="agentos_token",
        value=token,
        httponly=True,
        samesite="strict",
        max_age=JWT_EXPIRE_DAYS * 86400,
    )
    return {"ok": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("agentos_token")
    return {"ok": True}


@router.get("/me")
def me(agentos_token: str | None = Cookie(default=None)):
    if not verify_token(agentos_token):
        raise HTTPException(401, "Not authenticated")
    return {"user": "admin"}
