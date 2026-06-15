"""Demo-only discovery endpoints. Disabled unless ``ALLOW_DEV_TOKENS=true``.

These power the customer-webapp's demo customer switcher. They expose ONLY the
minimal, non-sensitive data needed to pick a customer + instance to chat with.
In production the customer-webapp has no switcher: the org_id arrives from the
Entra External ID token, so this endpoint returns 404.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from ..config import get_settings
from ..services import cosmos

router = APIRouter(prefix="/v1/demo", tags=["demo"])


def _dev_enabled() -> bool:
    # The demo customer switcher is dev-only; off in production auth mode.
    if get_settings().is_production_auth:
        return False
    return os.environ.get("ALLOW_DEV_TOKENS", "false").lower() == "true"


@router.get("/customers")
def list_demo_customers() -> List[Dict[str, Any]]:
    """Real customers (from Cosmos) that have at least one instance, with their
    instances. Used to populate the demo switcher dynamically."""
    if not _dev_enabled():
        raise HTTPException(404, "not found")

    out: List[Dict[str, Any]] = []
    for tenant in cosmos.list_tenants():
        org_id = tenant.get("org_id")
        if not org_id:
            continue
        if not tenant.get("enabled", True):
            continue  # customer disabled by the partner admin
        instances = cosmos.list_instances(org_id)
        usable = [
            {
                "id": i["id"],
                "display_name": i.get("display_name", i["id"]),
                "suggested_questions": i.get("suggested_questions") or [],
            }
            for i in instances
            if i.get("foundry_agent_id")
        ]
        if not usable:
            continue  # no agent to chat with yet
        out.append({
            "org_id": org_id,
            "name": tenant.get("name", org_id),
            "instances": usable,
        })
    return out
