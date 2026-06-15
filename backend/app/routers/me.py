"""Self-service endpoints for the *signed-in customer*.

Unlike ``/v1/demo`` (which is dev-only and lists every customer for the demo
switcher), these are scoped to the caller's own ``org_id`` taken from the
verified token — so they work in BOTH dev and production auth modes.

The customer-webapp uses ``/v1/me/instances`` in production to discover which
chat instance(s) the signed-in user can talk to (there is no switcher: the
org_id comes from the Entra External ID token).
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends

from ..security import Principal, get_principal
from ..services import cosmos

router = APIRouter(prefix="/v1/me", tags=["me"])


@router.get("/instances")
def my_instances(p: Principal = Depends(get_principal)) -> List[Dict[str, Any]]:
    """The caller's own chat-ready instances (those bound to a Foundry agent)."""
    out: List[Dict[str, Any]] = []
    for i in cosmos.list_instances(p.org_id):
        if not i.get("foundry_agent_id"):
            continue
        out.append(
            {
                "id": i["id"],
                "display_name": i.get("display_name", i["id"]),
                "suggested_questions": i.get("suggested_questions") or [],
            }
        )
    return out
