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
import secrets
import string
import threading
import time
from typing import Optional
from urllib.parse import parse_qs, urlparse

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


# --------------------------------------------------------------------------- #
# Directory users + group membership (Admin Console "Users" tab)               #
# --------------------------------------------------------------------------- #
_USER_SELECT = "id,displayName,givenName,surname,userPrincipalName,mail"


def _user_dto(u: dict) -> dict:
    return {
        "id": u.get("id"),
        "display_name": u.get("displayName"),
        "given_name": u.get("givenName"),
        "surname": u.get("surname"),
        "upn": u.get("userPrincipalName"),
        "mail": u.get("mail"),
    }


def _extract_skiptoken(next_link: Optional[str]) -> Optional[str]:
    if not next_link:
        return None
    try:
        q = parse_qs(urlparse(next_link).query)
        v = q.get("$skiptoken") or q.get("%24skiptoken")
        return v[0] if v else None
    except Exception:  # noqa: BLE001
        return None


def list_users(
    search: Optional[str] = None, top: int = 25, skip_token: Optional[str] = None
) -> dict:
    """List users in the CIAM tenant, paged. Returns
    ``{"users": [...], "next_skip_token": <token|None>, "error": <str?>}``.

    ``search`` does a prefix match across display name / UPN / mail. Paging uses
    Graph's ``$skiptoken`` (pass the returned ``next_skip_token`` back to fetch
    the next page). Requires the provisioning app to hold ``User.Read.All``
    (Application) with admin consent in the CIAM tenant.
    """
    if not get_settings().group_provisioning_enabled:
        return {"users": [], "next_skip_token": None}
    h = _headers()
    if not h:
        return {"users": [], "next_skip_token": None}
    params: dict = {"$select": _USER_SELECT, "$top": str(max(1, min(top, 100)))}
    if search:
        term = search.replace("'", "''")
        params["$filter"] = (
            f"startswith(displayName,'{term}') or "
            f"startswith(userPrincipalName,'{term}') or "
            f"startswith(mail,'{term}')"
        )
    else:
        params["$orderby"] = "displayName"
    if skip_token:
        params["$skiptoken"] = skip_token
    try:
        r = httpx.get(f"{_GRAPH}/users", params=params, headers=h, timeout=20.0)
        if r.status_code != 200:
            log.warning("list_users failed: %s %s", r.status_code, r.text)
            return {"users": [], "next_skip_token": None, "error": r.text[:300]}
        data = r.json()
        users = [_user_dto(u) for u in data.get("value", [])]
        return {
            "users": users,
            "next_skip_token": _extract_skiptoken(data.get("@odata.nextLink")),
        }
    except Exception as exc:  # noqa: BLE001
        log.warning("list_users error: %s", exc)
        return {"users": [], "next_skip_token": None, "error": str(exc)}


def list_group_members(group_id: str) -> list[dict]:
    """All user members of a security group (follows paging)."""
    if not get_settings().group_provisioning_enabled or not group_id:
        return []
    h = _headers()
    if not h:
        return []
    out: list[dict] = []
    url: Optional[str] = f"{_GRAPH}/groups/{group_id}/members/microsoft.graph.user"
    params: Optional[dict] = {"$select": _USER_SELECT, "$top": "100"}
    try:
        while url:
            r = httpx.get(url, params=params, headers=h, timeout=20.0)
            params = None  # subsequent nextLink already carries the query
            if r.status_code != 200:
                log.warning("list_group_members failed: %s %s", r.status_code, r.text)
                break
            data = r.json()
            out.extend(_user_dto(u) for u in data.get("value", []))
            url = data.get("@odata.nextLink")
    except Exception as exc:  # noqa: BLE001
        log.warning("list_group_members error for %s: %s", group_id, exc)
    return out


def add_group_member(group_id: str, user_id: str) -> bool:
    """Add a user to a security group. Idempotent (already-member counts ok)."""
    if not get_settings().group_provisioning_enabled or not (group_id and user_id):
        return False
    h = _headers()
    if not h:
        return False
    try:
        r = httpx.post(
            f"{_GRAPH}/groups/{group_id}/members/$ref",
            json={"@odata.id": f"{_GRAPH}/directoryObjects/{user_id}"},
            headers=h,
            timeout=20.0,
        )
        if r.status_code in (204, 201):
            return True
        # 400 with "already exist" → treat as success (idempotent add).
        if r.status_code == 400 and "already exist" in r.text.lower():
            return True
        log.warning("add_group_member failed: %s %s", r.status_code, r.text)
    except Exception as exc:  # noqa: BLE001
        log.warning("add_group_member error: %s", exc)
    return False


def remove_group_member(group_id: str, user_id: str) -> bool:
    """Remove a user from a security group. Idempotent (404 counts ok)."""
    if not get_settings().group_provisioning_enabled or not (group_id and user_id):
        return False
    h = _headers()
    if not h:
        return False
    try:
        r = httpx.delete(
            f"{_GRAPH}/groups/{group_id}/members/{user_id}/$ref",
            headers=h,
            timeout=20.0,
        )
        if r.status_code in (204, 404):
            return True
        log.warning("remove_group_member failed: %s %s", r.status_code, r.text)
    except Exception as exc:  # noqa: BLE001
        log.warning("remove_group_member error: %s", exc)
    return False


def _gen_password(length: int = 16) -> str:
    """A random password meeting Entra complexity (upper/lower/digit/symbol)."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(length))
        if (
            any(c.islower() for c in pw)
            and any(c.isupper() for c in pw)
            and any(c.isdigit() for c in pw)
            and any(c in "!@#$%^&*" for c in pw)
        ):
            return pw


def create_user(
    given_name: str,
    surname: str,
    upn: str,
    company: Optional[str] = None,
) -> dict:
    """Create a member user in the CIAM tenant with a generated temporary
    password (force-change at next sign-in). Returns
    ``{"user": <dto>, "temp_password": <pw>}`` or ``{"error": <msg>}``.

    Requires the provisioning app to hold ``User.ReadWrite.All`` (Application).
    """
    if not get_settings().group_provisioning_enabled:
        return {"error": "group management disabled"}
    h = _headers()
    if not h:
        return {"error": "Graph unavailable"}
    upn = (upn or "").strip()
    if not upn or "@" not in upn:
        return {"error": "a valid userPrincipalName (e.g. user@tenant.onmicrosoft.com) is required"}
    pw = _gen_password()
    display = f"{given_name} {surname}".strip() or upn.split("@")[0]
    body: dict = {
        "accountEnabled": True,
        "displayName": display,
        "userPrincipalName": upn,
        "mailNickname": upn.split("@")[0],
        "passwordProfile": {"password": pw, "forceChangePasswordNextSignIn": True},
    }
    if given_name:
        body["givenName"] = given_name
    if surname:
        body["surname"] = surname
    if company:
        body["companyName"] = company
    try:
        r = httpx.post(f"{_GRAPH}/users", json=body, headers=h, timeout=20.0)
        if r.status_code in (200, 201):
            return {"user": _user_dto(r.json()), "temp_password": pw}
        log.warning("create_user failed: %s %s", r.status_code, r.text)
        return {"error": r.text[:400]}
    except Exception as exc:  # noqa: BLE001
        log.warning("create_user error: %s", exc)
        return {"error": str(exc)}
