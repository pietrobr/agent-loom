"""Runtime configuration: env-driven, with branding overlay from config/branding.json."""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


_BRANDING_PATH_CANDIDATES = [
    Path(__file__).resolve().parents[2] / "config" / "branding.json",
    Path("/app/config/branding.json"),
    Path("config/branding.json"),
]


def _load_branding_file() -> dict:
    for p in _BRANDING_PATH_CANDIDATES:
        if p.is_file():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
    return {}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # Branding
    product_name: str = "AgentLoom"
    product_tagline: str = "Weave agents for every customer"
    primary_color: str = "#138DDE"
    logo_url: str = "/logo.svg"
    support_email: str = "support@example.com"
    partner_name: str = "Acme Partner"

    # Azure
    azure_resource_prefix: str = "agentloom"
    azure_client_id: str | None = None

    # Cosmos
    cosmos_endpoint: str = ""
    cosmos_database: str = "agentloom"

    # Search
    search_endpoint: str = ""

    # Storage
    storage_account: str = ""
    storage_container: str = "knowledge"

    # Key Vault
    keyvault_uri: str = ""

    # Foundry
    foundry_project_endpoint: str = ""
    foundry_model_deployment: str = "gpt-4o-mini"
    # Azure AI Foundry portal deep link for the project (agents-list URL, wsid only).
    foundry_portal_url: str = ""
    # Tenant id appended to portal deep links (kept separate to avoid '&' in env vars).
    foundry_tenant_id: str = ""

    # Auth (fallback). In prod, switch to External ID JWKS.
    jwt_secret: str = "local-dev-secret-change-me"
    jwt_issuer: str = "agentloom-local"
    jwt_audience: str = "agentloom"
    jwt_algorithm: str = "HS256"

    # CORS
    allowed_origins: str = "*"

    @property
    def allowed_origins_list(self) -> List[str]:
        if not self.allowed_origins or self.allowed_origins == "*":
            return ["*"]
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    branding = _load_branding_file()
    # File values are defaults; env always wins.
    for k, v in branding.items():
        os.environ.setdefault(k, str(v))
    return Settings()
