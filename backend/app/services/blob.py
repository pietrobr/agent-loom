"""Private blob uploads for knowledge files. Managed-identity auth only."""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import IO, Optional

from azure.storage.blob import BlobServiceClient, ContentSettings

from ..config import get_settings
from ..credentials import get_credential

log = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _service() -> BlobServiceClient:
    s = get_settings()
    return BlobServiceClient(account_url=f"https://{s.storage_account}.blob.core.windows.net", credential=get_credential())


def _container():
    s = get_settings()
    return _service().get_container_client(s.storage_container)


def _instance_prefix(org_id: str, instance_id: str) -> str:
    """The blob 'folder' that holds an instance's knowledge files. Deleting the
    instance removes everything under this prefix."""
    return f"{org_id}/{instance_id}/"


def upload(
    org_id: str,
    instance_id: str,
    filename: str,
    data: IO[bytes] | bytes,
    content_type: Optional[str] = None,
) -> str:
    blob_path = f"{_instance_prefix(org_id, instance_id)}{filename}"
    _container().upload_blob(
        name=blob_path,
        data=data,
        overwrite=True,
        content_settings=ContentSettings(content_type=content_type) if content_type else None,
    )
    return blob_path


def download_text(org_id: str, instance_id: str, filename: str) -> str:
    blob = _container().get_blob_client(f"{_instance_prefix(org_id, instance_id)}{filename}")
    return blob.download_blob().readall().decode("utf-8", errors="ignore")


def delete_instance_kb(org_id: str, instance_id: str) -> int:
    """Delete the whole knowledge 'folder' for an instance. Returns the count
    of blobs removed (best-effort, idempotent)."""
    container = _container()
    prefix = _instance_prefix(org_id, instance_id)
    removed = 0
    try:
        for b in container.list_blobs(name_starts_with=prefix):
            try:
                container.delete_blob(b.name)
                removed += 1
            except Exception as exc:  # pragma: no cover
                log.info("delete_blob(%s) ignored: %s", b.name, exc)
    except Exception as exc:  # pragma: no cover
        log.info("delete_instance_kb(%s/%s) ignored: %s", org_id, instance_id, exc)
    return removed
