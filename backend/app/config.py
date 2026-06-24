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
    # Subscription + resource group of this deployment (injected by infra). Used
    # to list Foundry account model deployments via the ARM control plane.
    azure_subscription_id: str = ""
    azure_resource_group: str = ""
    # Foundry (Cognitive Services) account name; derived from the project
    # endpoint host when left empty.
    foundry_account_name: str = ""

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

    # Observability — Application Insights connection string (injected by infra).
    # Empty disables OpenTelemetry export (local dev / when App Insights is off).
    applicationinsights_connection_string: str = ""

    # Foundry
    foundry_project_endpoint: str = ""
    foundry_model_deployment: str = "gpt-4o-mini"
    # Embedding model deployment used for the RAG vector search.
    embedding_deployment: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    # Azure OpenAI endpoint + chat deployment of the Foundry account, used by
    # Azure AI Search agentic retrieval (knowledge base query planning).
    foundry_account_endpoint: str = ""
    foundry_chat_deployment: str = "gpt-4o-mini"
    foundry_chat_model: str = "gpt-4o-mini"
    # Azure AI Foundry portal deep link for the project (agents-list URL, wsid only).
    foundry_portal_url: str = ""
    # Tenant id appended to portal deep links (kept separate to avoid '&' in env vars).
    foundry_tenant_id: str = ""

    # Auth (fallback). In prod, switch to External ID JWKS.
    jwt_secret: str = "local-dev-secret-change-me"
    jwt_issuer: str = "agentloom-local"
    jwt_audience: str = "agentloom"
    jwt_algorithm: str = "HS256"

    # --- Production identity (Entra ID workforce + Entra External ID/CIAM) ----
    # auth_mode = "dev" keeps the HS256 dev-token flow (demo). auth_mode =
    # "production" verifies RS256 access tokens against the two tenants' JWKS
    # and DISABLES the dev-token + demo endpoints.
    auth_mode: str = "dev"

    # Provider workforce tenant (admins sign in here). Audience is the admin
    # SPA/API app registration's client id (or App ID URI).
    workforce_tenant_id: str = ""
    workforce_audience: str = ""
    # Optional explicit issuer/jwks overrides (otherwise derived from tenant id).
    workforce_issuer: str = ""
    workforce_jwks_uri: str = ""

    # Customer Entra External ID (CIAM) tenant. Audience is the customer SPA/API
    # app registration's client id. subdomain = the tenant's initial domain
    # label (e.g. "agentloomcustomers" for agentloomcustomers.onmicrosoft.com).
    ciam_tenant_id: str = ""
    ciam_subdomain: str = ""
    ciam_audience: str = ""
    ciam_issuer: str = ""
    ciam_jwks_uri: str = ""

    # Claim names. Admins are recognised by an app role / roles claim value.
    # (org_id_claim is retained for the dev HS256 flow / back-compat; production
    # customers are mapped via security groups below.)
    org_id_claim: str = "org_id"
    admin_role_value: str = "admin"
    # Customers are mapped to tenants via security groups: their token carries the
    # group object ids in this claim (Entra emits GUIDs). The backend resolves the
    # org_id from the tenant whose group_id matches.
    groups_claim: str = "groups"

    # CIAM provisioning app (client-credentials) used by the backend to create /
    # delete the per-customer security group in the External ID tenant when a
    # customer is added/removed from the Admin Console. The client id is a plain
    # env var; the secret is read from Key Vault at runtime via the backend's
    # managed identity (secret name below). This is required for the groups model
    # in production (empty → the backend cannot provision customer groups).
    provisioning_client_id: str = ""
    provisioning_secret_name: str = "ciam-provisioning-secret"
    # Group naming: cust-<org_id> by default.
    group_name_prefix: str = "cust-"

    @property
    def is_production_auth(self) -> bool:
        return self.auth_mode.strip().lower() in ("production", "prod")

    @property
    def group_provisioning_enabled(self) -> bool:
        return bool(
            self.is_production_auth
            and self.provisioning_client_id
            and self.ciam_tenant_id
            and self.keyvault_uri
        )

    @property
    def workforce_oidc_issuer(self) -> str:
        if self.workforce_issuer:
            return self.workforce_issuer
        return f"https://login.microsoftonline.com/{self.workforce_tenant_id}/v2.0"

    @property
    def workforce_oidc_jwks(self) -> str:
        if self.workforce_jwks_uri:
            return self.workforce_jwks_uri
        return f"https://login.microsoftonline.com/{self.workforce_tenant_id}/discovery/v2.0/keys"

    @property
    def ciam_oidc_issuer(self) -> str:
        if self.ciam_issuer:
            return self.ciam_issuer
        # Entra External ID (CIAM) tokens carry an issuer whose subdomain is the
        # tenant GUID (not the friendly subdomain label):
        #   https://<tenantId>.ciamlogin.com/<tenantId>/v2.0
        return f"https://{self.ciam_tenant_id}.ciamlogin.com/{self.ciam_tenant_id}/v2.0"

    @property
    def ciam_oidc_jwks(self) -> str:
        if self.ciam_jwks_uri:
            return self.ciam_jwks_uri
        return f"https://{self.ciam_tenant_id}.ciamlogin.com/{self.ciam_tenant_id}/discovery/v2.0/keys"

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
