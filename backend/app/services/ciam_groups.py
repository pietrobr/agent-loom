"""Per-customer security groups in the Entra External ID (CIAM) tenant.

Used in production (``AUTH_MODE=production``) when customers are mapped to
tenants by **group membership** instead of an ``org_id`` user attribute. When a
customer is created/removed in the Admin Console, the backend creates/deletes a
``cust-<org_id>`` security group in the CIAM tenant and stores its object id on
the tenant record (``group_id``). Customer access tokens then carry that group
id in the ``groups`` claim, which the backend resolves back to the org_id.

The backend authenticates to the CIAM tenant with a dedicated **provisioning
app** (client-credentials). Its client id is an env var; its secret is read from
Key Vault. All operations are best-effort and gated on
``settings.group_provisioning_enabled`` — in dev / org_id-claim mode this module
is inert.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Optional

import httpx
import msal

from ..config import get_settings
from . import keyvault

log = logging.getLogger(__name__)

_GRAPH = "https://graph.microsoft.com/v1.0"
_SCOPE = ["https://graph.microsoft.com/.default"]

_token: dict = {"value": None, "exp": 0.0}
_lock = threading.Lock()


def _access_token() -> Optional[str]:
    """App-only Graph token for the CIAM tenant (cached until ~expiry)."""
    s = get_settings()
    now = time.time()
    if _token["value"] and now < _token["exp"] - 60:
        return _token["value"]
    with _lock:
        if _token["value"] and now < _token["exp"] - 60:
            return _token["value"]
        secret = keyvault.get_secret(s.provisioning_secret_name)
        if not secret:
            log.warning("CIAM provisioning secret '%s' not available", s.provisioning_secret_name)
            return None
        app = msal.ConfidentialClientApplication(
            client_id=s.provisioning_client_id,
            authority=f"https://login.microsoftonline.com/{s.ciam_tenant_id}",
            client_credential=secret,
        )
        result = app.acquire_token_for_client(scopes=_SCOPE)
        if "access_token" not in result:
            log.warning("CIAM provisioning token failed: %s", result.get("error_description"))
            return None
        _token["value"] = result["access_token"]
        _token["exp"] = now + int(result.get("expires_in", 3600))
        return _token["value"]


def _headers() -> Optional[dict]:
    tok = _access_token()
    if not tok:
        return None
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def group_name_for(org_id: str) -> str:
    return f"{get_settings().group_name_prefix}{org_id}"


def ensure_group(org_id: str, display_name: str) -> Optional[str]:
    """Create (or find) the customer's security group; return its object id.

    Returns None if provisioning is disabled or Graph is unavailable. The
    mailNickname is the group name; description carries the friendly name.
    """
    s = get_settings()
    if not s.group_provisioning_enabled:
        return None
    h = _headers()
    if not h:
        return None
    name = group_name_for(org_id)
    try:
        # Reuse an existing group with the same mailNickname (idempotent).
        r = httpx.get(
            f"{_GRAPH}/groups",
            params={"$filter": f"mailNickname eq '{name}'", "$select": "id"},
            headers=h,
            timeout=20.0,
        )
        if r.status_code == 200 and r.json().get("value"):
            return r.json()["value"][0]["id"]
        body = {
            "displayName": f"{display_name} ({org_id})",
            "mailEnabled": False,
            "mailNickname": name,
            "securityEnabled": True,
            "description": f"AgentLoom customer group for org_id={org_id}",
        }
        r = httpx.post(f"{_GRAPH}/groups", json=body, headers=h, timeout=20.0)
        if r.status_code in (200, 201):
            gid = r.json()["id"]
            log.info("Created CIAM group %s (%s) for org=%s", name, gid, org_id)
            return gid
        log.warning("Create group failed for %s: %s %s", org_id, r.status_code, r.text)
    except Exception as exc:  # noqa: BLE001
        log.warning("ensure_group error for %s: %s", org_id, exc)
    return None


def delete_group(group_id: str) -> None:
    """Best-effort delete of a customer's security group."""
    s = get_settings()
    if not s.group_provisioning_enabled or not group_id:
        return
    h = _headers()
    if not h:
        return
    try:
        r = httpx.delete(f"{_GRAPH}/groups/{group_id}", headers=h, timeout=20.0)
        if r.status_code not in (204, 404):
            log.warning("Delete group %s failed: %s %s", group_id, r.status_code, r.text)
    except Exception as exc:  # noqa: BLE001
        log.warning("delete_group error for %s: %s", group_id, exc)
