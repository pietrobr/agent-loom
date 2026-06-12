"""Shared Azure credential factory (managed identity in Azure, AzureCLI locally)."""
from __future__ import annotations

from functools import lru_cache

from azure.identity import DefaultAzureCredential, ManagedIdentityCredential

from .config import get_settings


@lru_cache(maxsize=1)
def get_credential():
    settings = get_settings()
    if settings.azure_client_id:
        # User-assigned managed identity inside Container Apps.
        return ManagedIdentityCredential(client_id=settings.azure_client_id)
    return DefaultAzureCredential(exclude_interactive_browser_credential=True)
