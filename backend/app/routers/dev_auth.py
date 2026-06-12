"""Dev-only token issuer. Disabled unless ``ALLOW_DEV_TOKENS=true``.

Production deployments should rely on Microsoft Entra External ID and verify
JWTs against its JWKS endpoint.
"""
from __future__ import annotations

import os
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from jose import jwt
from pydantic import BaseModel

from ..config import Settings, get_settings

router = APIRouter(prefix="/v1/auth", tags=["auth"])


class TokenRequest(BaseModel):
    org_id: str
    sub: str = "demo-user"
    roles: List[str] = []
    email: Optional[str] = None
    ttl_seconds: int = 3600


def _dev_enabled() -> bool:
    return os.environ.get("ALLOW_DEV_TOKENS", "false").lower() == "true"


@router.post("/dev-token")
def issue_dev_token(req: TokenRequest, settings: Settings = Depends(get_settings)) -> dict:
    if not _dev_enabled():
        raise HTTPException(404, "not found")
    now = int(time.time())
    claims = {
        "sub": req.sub,
        "org_id": req.org_id,
        "roles": req.roles,
        "email": req.email,
        "iat": now,
        "exp": now + max(60, req.ttl_seconds),
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    token = jwt.encode(claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return {"access_token": token, "token_type": "Bearer", "expires_in": req.ttl_seconds}
