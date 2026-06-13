"""Pydantic models for catalog/tenants/instances/chat."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


SYSTEM_ORG = "_system"  # partition for partner-global catalog rows


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- #
# Catalog                                                                     #
# --------------------------------------------------------------------------- #
class TemplateParam(BaseModel):
    key: str
    label: str
    type: Literal["string", "number", "boolean"] = "string"
    default: Optional[Any] = None
    required: bool = False


class Template(BaseModel):
    id: str
    org_id: str = SYSTEM_ORG
    name: str
    description: str
    category: str = "general"
    foundry_agent_id: Optional[str] = None
    model: str = "gpt-4o-mini"
    instructions: str = ""
    parameters: List[TemplateParam] = Field(default_factory=list)
    status: Literal["draft", "published"] = "draft"
    created_at: str = Field(default_factory=_now)
    updated_at: str = Field(default_factory=_now)


# --------------------------------------------------------------------------- #
# Tenants                                                                     #
# --------------------------------------------------------------------------- #
class Branding(BaseModel):
    product_name: str = "AgentLoom"
    primary_color: str = "#5B5FC7"
    logo_url: str = "/logo.svg"
    tagline: str = ""


class Tenant(BaseModel):
    id: str  # equal to org_id
    org_id: str
    name: str
    tier: Literal["free", "starter", "pro"] = "starter"
    enabled: bool = True  # disabled customers are hidden from the customer app
    monthly_token_quota: int = 1_000_000
    branding: Branding = Field(default_factory=Branding)
    search_index: str = ""
    created_at: str = Field(default_factory=_now)


# --------------------------------------------------------------------------- #
# Instances (per-customer)                                                    #
# --------------------------------------------------------------------------- #
class Instance(BaseModel):
    id: str
    org_id: str
    template_id: str
    display_name: str
    overrides: Dict[str, Any] = Field(default_factory=dict)
    branding: Optional[Branding] = None
    # Starter prompts shown as clickable chips in the customer chat.
    suggested_questions: List[str] = Field(default_factory=list)
    foundry_agent_id: Optional[str] = None  # real per-customer Foundry agent
    created_at: str = Field(default_factory=_now)


# --------------------------------------------------------------------------- #
# Chat                                                                        #
# --------------------------------------------------------------------------- #
class ChatRequest(BaseModel):
    message: str
    instance_id: str
    conversation_id: Optional[str] = None


class MeteringEvent(BaseModel):
    id: str
    org_id: str
    instance_id: str
    template_id: str
    ts: str = Field(default_factory=_now)
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
