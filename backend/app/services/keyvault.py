"""Read secrets from Key Vault using the backend's managed identity."""
from __future__ import annotations

from functools import lru_cache
from typing import Optional

from azure.keyvault.secrets import SecretClient

from ..config import get_settings
from ..credentials import get_credential


@lru_cache(maxsize=1)
def _client() -> Optional[SecretClient]:
    uri = get_settings().keyvault_uri
    if not uri:
        return None
    return SecretClient(vault_url=uri, credential=get_credential())


def get_secret(name: str) -> Optional[str]:
    """Return the secret value, or None if Key Vault/secret is unavailable."""
    client = _client()
    if client is None or not name:
        return None
    try:
        return client.get_secret(name).value
    except Exception:  # noqa: BLE001 - secret may not exist yet
        return None
