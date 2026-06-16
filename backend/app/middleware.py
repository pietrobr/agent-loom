"""Tenant context middleware. Enforces the *invariant* that ``org_id`` comes
ONLY from a verified token claim — never from a path or a client payload.

Path parameters that look like an org_id (``/customers/{org_id}/...``) are
allowed only for admins; for non-admins they must match the token's org_id.
"""
from __future__ import annotations

import logging
import re
from typing import Callable

from fastapi import HTTPException, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from .security import Principal, verify_token, UnassignedCustomerError
from .config import get_settings
from .services import cosmos

log = logging.getLogger(__name__)

_ORG_PATH_RE = re.compile(r"/customers/([^/]+)(?:/|$)")
_ADMIN_PATH = "/v1/admin"


class TenantContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Response]) -> Response:
        path = request.url.path
        # Let CORS preflight requests through untouched (they never carry auth);
        # the CORSMiddleware handles them.
        if request.method == "OPTIONS":
            return await call_next(request)
        # Public/dev endpoints — no enforcement.
        public = (
            path in ("/", "/healthz", "/v1/healthz", "/openapi.json", "/docs", "/redoc")
            or path.startswith("/v1/auth/")
            or path.startswith("/v1/demo/")
        )
        if public:
            return await call_next(request)

        auth = request.headers.get("authorization", "")
        principal: Principal | None = None
        if auth.lower().startswith("bearer "):
            try:
                principal = verify_token(auth.split(" ", 1)[1].strip(), get_settings())
            except UnassignedCustomerError:
                # Valid token, but the user isn't linked to any organization yet
                # (no cust-<org_id> group). Give a clear, actionable 403 instead
                # of a confusing "missing or invalid token".
                return _forbidden(
                    "your account is not linked to any organization",
                    code="account_unassigned",
                )
            except HTTPException:
                principal = None

        if principal is None:
            return _unauth("missing or invalid token")

        request.state.principal = principal

        # Revoke access for customers whose tenant was disabled or deleted in
        # the Admin Console: even with a still-valid token, a disabled/removed
        # customer must be locked out immediately (the SPA signs them out on 403).
        if not principal.is_admin:
            tenant = cosmos.get_tenant(principal.org_id)
            if not tenant:
                log.warning("Access by unknown/removed tenant: org=%s", principal.org_id)
                return _forbidden("account no longer exists", code="account_removed")
            if not tenant.get("enabled", True):
                log.warning("Access by disabled tenant: org=%s", principal.org_id)
                return _forbidden("account disabled", code="account_disabled")

        # Cross-tenant guard for org-scoped paths.
        m = _ORG_PATH_RE.search(path)
        if m:
            path_org = m.group(1)
            if path_org != principal.org_id and not principal.is_admin:
                log.warning(
                    "Cross-tenant attempt: token_org=%s path_org=%s path=%s",
                    principal.org_id, path_org, path,
                )
                return _forbidden("cross-tenant access denied")

        # Admin path requires admin role.
        if path.startswith(_ADMIN_PATH) and not principal.is_admin:
            return _forbidden("admin role required")

        return await call_next(request)


def _unauth(msg: str) -> Response:
    from fastapi.responses import JSONResponse
    return JSONResponse({"detail": msg}, status_code=401)


def _forbidden(msg: str, code: str | None = None) -> Response:
    from fastapi.responses import JSONResponse
    body = {"detail": msg}
    if code:
        body["code"] = code
    return JSONResponse(body, status_code=403)
