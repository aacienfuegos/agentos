from fastapi import Depends, HTTPException, Cookie
from .auth import verify_token


def require_auth(agentos_token: str | None = Cookie(default=None)) -> None:
    if not verify_token(agentos_token):
        raise HTTPException(401, "Not authenticated")


AuthDep = Depends(require_auth)
