"""JWT verification + tenant context.

Two modes, selected by ``AUTH_MODE``:

  * ``dev`` (default) — accept HS256 tokens signed with a shared secret (the
    demo/dev-token flow). Required claim: ``org_id`` (+ optional ``roles``).
  * ``production`` — verify RS256 access tokens against the JWKS of the two
    Entra tenants: the provider **workforce** tenant (admins) and the customer
    **Entra External ID (CIAM)** tenant (end users). Admins are recognised by an
    app-role claim; customers carry their ``org_id`` as a custom claim.

Either way the rest of the app only depends on the resulting ``Principal``
(``org_id`` + ``roles``), so middleware, isolation and routers are unchanged.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List, Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from .config import Settings, get_settings
from . import jwks as jwks_mod
from .models import SYSTEM_ORG

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


def _roles_from_claim(payload: dict) -> List[str]:
    roles = payload.get("roles") or []
    if isinstance(roles, str):
        roles = [roles]
    return list(roles)


def _resolve_customer_org(payload: dict, settings: Settings) -> Optional[str]:
    """Determine a customer's org_id from their token.

    Two supported models (the first that yields a value wins):
      1. ``org_id`` claim — emitted directly (claims-mapping of a user attribute).
      2. ``groups`` claim — Entra emits group object ids; map the one that
         matches a tenant's ``group_id`` (per-customer security group model).
    """
    direct = payload.get(settings.org_id_claim)
    if direct:
        return str(direct)

    groups = payload.get(settings.groups_claim) or []
    if isinstance(groups, str):
        groups = [groups]
    # Import here to avoid any import-time cycle.
    from .services import cosmos

    for gid in groups:
        tenant = cosmos.get_tenant_by_group(str(gid))
        if tenant:
            return tenant.get("org_id")
    return None


def _verify_production(token: str, settings: Settings) -> Principal:
    """Verify an Entra access token (workforce admin OR CIAM customer)."""
    iss = jwks_mod.unverified_issuer(token)
    if not iss:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing issuer")

    wf_iss = settings.workforce_oidc_issuer
    ciam_iss = settings.ciam_oidc_issuer

    try:
        if settings.workforce_tenant_id and iss == wf_iss:
            payload = jwks_mod.verify_rs256(
                token,
                jwks_uri=settings.workforce_oidc_jwks,
                issuer=wf_iss,
                audience=settings.workforce_audience,
            )
            roles = _roles_from_claim(payload)
            if settings.admin_role_value not in roles:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "admin app role required")
            # Provider admins operate on the partner-global partition.
            return Principal(
                sub=str(payload.get("sub", "admin")),
                org_id=SYSTEM_ORG,
                roles=["admin"],
                email=payload.get("preferred_username") or payload.get("email"),
            )

        if settings.ciam_tenant_id and iss == ciam_iss:
            payload = jwks_mod.verify_rs256(
                token,
                jwks_uri=settings.ciam_oidc_jwks,
                issuer=ciam_iss,
                audience=settings.ciam_audience,
            )
            org_id = _resolve_customer_org(payload, settings)
            if not org_id:
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED,
                    "customer token is not mapped to any tenant",
                )
            return Principal(
                sub=str(payload.get("sub", "user")),
                org_id=str(org_id),
                roles=[],
                email=payload.get("preferred_username") or payload.get("email"),
            )
    except JWTError as exc:
        log.warning("RS256 validation failed: %s", exc)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token") from exc

    log.warning("Token issuer not recognised: %s", iss)
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unrecognised token issuer")


def _verify_dev(token: str, settings: Settings) -> Principal:
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

    return Principal(
        sub=str(payload["sub"]),
        org_id=str(org_id),
        roles=_roles_from_claim(payload),
        email=payload.get("email"),
    )


def verify_token(token: str, settings: Settings) -> Principal:
    if settings.is_production_auth:
        return _verify_production(token, settings)
    return _verify_dev(token, settings)



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
