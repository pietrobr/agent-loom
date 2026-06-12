"""Public branding endpoint — read by the customer-webapp on load."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..config import Settings, get_settings
from ..security import Principal, get_principal
from ..services import cosmos

router = APIRouter(prefix="/v1", tags=["branding"])


@router.get("/branding")
def branding_for_principal(
    settings: Settings = Depends(get_settings),
    p: Principal = Depends(get_principal),
) -> dict:
    tenant = cosmos.get_tenant(p.org_id)
    if not tenant:
        raise HTTPException(404, "tenant not provisioned")
    base = {
        "product_name": settings.product_name,
        "primary_color": settings.primary_color,
        "logo_url": settings.logo_url,
        "tagline": settings.product_tagline,
        "partner_name": settings.partner_name,
    }
    base.update(tenant.get("branding") or {})
    base["org_id"] = p.org_id
    base["org_name"] = tenant.get("name")
    return base
