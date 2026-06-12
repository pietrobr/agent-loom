"""Public catalog: published templates available to all authenticated users."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..security import Principal, get_principal
from ..services import cosmos

router = APIRouter(prefix="/v1/catalog", tags=["catalog"])


@router.get("")
def list_catalog(_: Principal = Depends(get_principal)) -> list[dict]:
    return cosmos.list_published_templates()
