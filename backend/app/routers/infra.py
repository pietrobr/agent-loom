"""Admin infra endpoints: runtime toggles for infrastructure-backed features.

Currently exposes the Application Insights write toggle, which gates mirroring
request traces to App Insights (cost control). Admin role required (provider
operators only).
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from ..config import get_settings
from ..security import Principal, require_admin
from ..services import cosmos, tracing

router = APIRouter(prefix="/v1/admin", tags=["infra"])


@router.get("/infra/config")
def get_infra_config(_: Principal = Depends(require_admin)) -> Dict[str, Any]:
    """Current infra toggles + whether the App Insights connection is actually
    wired (so the UI can explain that the toggle only has effect when it is)."""
    cfg = cosmos.get_infra_config()
    wired = bool(get_settings().applicationinsights_connection_string)
    return {
        "app_insights_enabled": bool(cfg.get("app_insights_enabled", False)),
        "gen_ai_content_recording": bool(cfg.get("gen_ai_content_recording", False)),
        "app_insights_wired": wired,
    }


@router.put("/infra/config")
def set_infra_config(
    payload: Dict[str, Any], _: Principal = Depends(require_admin)
) -> Dict[str, Any]:
    """Update infra toggles. Accepts either/both keys; unset keys are preserved.

    - ``app_insights_enabled``: mirror request traces to Application Insights.
    - ``gen_ai_content_recording``: also record prompt/response text on GenAI
      spans (privacy/cost sensitive).
    """
    if "app_insights_enabled" not in payload and "gen_ai_content_recording" not in payload:
        raise HTTPException(400, "app_insights_enabled or gen_ai_content_recording is required")
    current = cosmos.get_infra_config()
    app_insights = bool(
        payload.get("app_insights_enabled", current.get("app_insights_enabled", False))
    )
    content = bool(
        payload.get("gen_ai_content_recording", current.get("gen_ai_content_recording", False))
    )
    cosmos.set_infra_config(app_insights, content)
    tracing.invalidate_infra_cache()
    wired = bool(get_settings().applicationinsights_connection_string)
    return {
        "app_insights_enabled": app_insights,
        "gen_ai_content_recording": content,
        "app_insights_wired": wired,
    }
