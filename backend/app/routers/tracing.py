"""Admin tracing endpoints: list/inspect request traces and tune the capture
level. Admin role required (provider operators only).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..security import Principal, require_admin
from ..services import cosmos, tracing

router = APIRouter(prefix="/v1/admin", tags=["tracing"])


@router.get("/tracing/config")
def get_tracing_config(_: Principal = Depends(require_admin)) -> Dict[str, Any]:
    """Current capture level + the available levels (for the UI selector)."""
    cfg = cosmos.get_tracing_config()
    return {
        "level": tracing.normalize_level(cfg.get("level", "INFO")),
        "levels": list(tracing.LEVELS.keys()),
    }


@router.put("/tracing/config")
def set_tracing_config(
    payload: Dict[str, Any], _: Principal = Depends(require_admin)
) -> Dict[str, Any]:
    """Set the capture level. Accepts DEBUG/INFO/WARNING/ERROR (or 'verbose')."""
    requested = str(payload.get("level", "")).strip()
    if not requested:
        raise HTTPException(400, "level is required")
    if requested.upper() not in ("VERBOSE", *tracing.LEVELS.keys()):
        raise HTTPException(400, f"invalid level: {requested}")
    level = tracing.normalize_level(requested)
    cosmos.set_tracing_config(level)
    tracing.invalidate_config_cache()
    return {"level": level, "levels": list(tracing.LEVELS.keys())}


@router.get("/traces")
def list_traces(
    _: Principal = Depends(require_admin),
    org_id: Optional[str] = Query(None, description="Filter to one customer"),
    frm: Optional[str] = Query(None, alias="from", description="ISO lower bound (inclusive)"),
    to: Optional[str] = Query(None, description="ISO upper bound (exclusive)"),
    level: Optional[str] = Query(None, description="Minimum severity"),
    limit: int = Query(100, ge=1, le=500),
) -> List[Dict[str, Any]]:
    return cosmos.query_traces(org_id=org_id, frm=frm, to=to, level=level, limit=limit)


@router.get("/traces/{org_id}/{trace_id}")
def get_trace(
    org_id: str, trace_id: str, _: Principal = Depends(require_admin)
) -> Dict[str, Any]:
    doc = cosmos.get_trace(org_id, trace_id)
    if not doc:
        raise HTTPException(404, "trace not found")
    return doc
