"""JWT verification + tenant context.

For the MVP we accept HS256 tokens signed with a shared secret pulled from Key
Vault (falling back to env). The required claim is `org_id`, plus optional
`roles` (e.g. ["admin"]). When External ID is wired in later, swap the
verification path for JWKS-based RS256 — the rest of the app stays the same.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List, Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from .config import Settings, get_settings

log = logging.getLogger(__name__)

bearer = HTTPBearer(auto_error=False)


@dataclass
class Principal:
    sub: str
    org_id: str
    roles: List[str]
    email: Optional[str] = None

    @property
    def is_admin(self) -> bool:
        return "admin" in self.roles


def verify_token(token: str, settings: Settings) -> Principal:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "iat", "sub"]},
        )
    except JWTError as exc:
        log.warning("JWT validation failed: %s", exc)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token") from exc

    org_id = payload.get("org_id")
    if not org_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing org_id claim")

    roles = payload.get("roles") or []
    if isinstance(roles, str):
        roles = [roles]

    return Principal(
        sub=str(payload["sub"]),
        org_id=str(org_id),
        roles=list(roles),
        email=payload.get("email"),
    )


def get_principal(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> Principal:
    # Middleware has already verified and stashed the principal.
    cached = getattr(request.state, "principal", None)
    if cached is not None:
        return cached
    if creds is None or not creds.credentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    principal = verify_token(creds.credentials, settings)
    request.state.principal = principal
    return principal


def require_admin(p: Principal = Depends(get_principal)) -> Principal:
    if not p.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin role required")
    return p
